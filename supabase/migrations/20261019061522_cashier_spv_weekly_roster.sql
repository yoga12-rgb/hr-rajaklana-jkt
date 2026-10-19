-- Admin HR controls for cashier staffing, weekly roster batches, and SPV follow-up.
-- All writes stay behind narrow authenticated RPCs and commit atomically.

create table public.staffing_requirements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  weekday smallint not null check (weekday between 0 and 6),
  shift text not null check (shift in ('morning','afternoon','middle')),
  minimum integer not null check (minimum between 0 and 100),
  effective_from date not null check (isfinite(effective_from)),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id,weekday,shift,effective_from)
);
create index staffing_requirements_lookup on public.staffing_requirements(outlet_id,weekday,shift,effective_from desc);
alter table public.staffing_requirements enable row level security;
revoke all on public.staffing_requirements from public,anon,authenticated;
grant select on public.staffing_requirements to authenticated;
create policy staffing_requirements_read_admin on public.staffing_requirements for select to authenticated
  using ((select private.has_role('admin_hr')));

create table public.cashier_roster_batches (
  id uuid primary key default gen_random_uuid(),
  actor_employee_id uuid not null references public.employees(id),
  idempotency_key uuid not null,
  request_hash text not null check (length(request_hash)=32),
  week_start date not null check (isfinite(week_start)),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(actor_employee_id,idempotency_key)
);
alter table public.cashier_roster_batches enable row level security;
revoke all on public.cashier_roster_batches from public,anon,authenticated;

create table public.spv_followups (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique check (length(case_key) between 8 and 220),
  issue_type text not null check (issue_type in ('missing_clockin','unassigned','open_session','unexcused_lateness','correction_pending','leave_conflict','short_duration')),
  source_type text not null check (source_type in ('assignment','attendance','correction','roster')),
  source_id uuid,
  work_date date not null check (isfinite(work_date)),
  outlet_id uuid not null references public.outlets(id),
  employee_id uuid references public.employees(id),
  shift text check (shift in ('morning','afternoon','middle')),
  owner_id uuid references public.employees(id),
  status text not null default 'new' check (status in ('new','in_progress','completed')),
  note text not null default '',
  resolution_note text not null default '',
  created_by uuid not null references public.employees(id),
  updated_by uuid not null references public.employees(id),
  reopened_count integer not null default 0 check (reopened_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_type='roster' and source_id is null and issue_type='unassigned') or (source_type<>'roster' and source_id is not null)),
  check ((issue_type='unassigned' and shift is null) or (issue_type<>'unassigned' and shift is not null))
);
create index spv_followups_date_status on public.spv_followups(work_date,status,outlet_id);
create index spv_followups_owner_status on public.spv_followups(owner_id,status,updated_at desc);
alter table public.spv_followups enable row level security;
revoke all on public.spv_followups from public,anon,authenticated;
grant select on public.spv_followups to authenticated;
create policy spv_followups_read_admin on public.spv_followups for select to authenticated
  using ((select private.has_role('admin_hr')));

alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('leave','attendance_correction','assignment','assignment_week','attendance_reminder'));
alter table public.notifications add constraint notifications_href_check check(
  (entity_type='leave' and href='/leave?request='||entity_id::text)
  or (entity_type='attendance_correction' and href in ('/attendance?request='||entity_id::text,'/reports?tab=corrections&request='||entity_id::text))
  or (entity_type='assignment' and href ~ '^/assignments\?date=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='assignment_week' and href ~ '^/assignments\?week=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='attendance_reminder' and href='/attendance?record='||entity_id::text));

create function public.staffing_requirement_save(p_outlet_id uuid,p_weekday integer,p_shift text,p_minimum integer,p_effective_from date)
returns public.staffing_requirements language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.staffing_requirements; v_row public.staffing_requirements;
begin
  if p_weekday is null or p_weekday not between 0 and 6 then raise exception 'Hari dalam minggu tidak valid'; end if;
  if p_shift is null or p_shift not in ('morning','afternoon','middle') then raise exception 'Shift kebutuhan tidak valid'; end if;
  if p_minimum is null or p_minimum not between 0 and 100 then raise exception 'Kebutuhan minimum harus antara 0 dan 100'; end if;
  if p_effective_from is null or not isfinite(p_effective_from) or p_effective_from<(now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal berlaku harus hari ini atau mendatang'; end if;
  if not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet aktif tidak ditemukan'; end if;
  select * into v_before from public.staffing_requirements where outlet_id=p_outlet_id and weekday=p_weekday
    and shift=p_shift and effective_from=p_effective_from for update;
  if found then
    update public.staffing_requirements set minimum=p_minimum,updated_at=clock_timestamp() where id=v_before.id returning * into v_row;
  else
    insert into public.staffing_requirements(outlet_id,weekday,shift,minimum,effective_from,created_by)
      values(p_outlet_id,p_weekday,p_shift,p_minimum,p_effective_from,v_actor) returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('staffing_requirement',v_row.id,v_actor,case when v_before.id is null then 'created' else 'updated' end,
      'Minimum kasir diperbarui · berlaku '||v_row.effective_from::text,
      case when v_before.id is null then null else to_jsonb(v_before) end,to_jsonb(v_row));
  return v_row;
end;
$$;

create function public.cashier_roster_batch_save(p_week_start date,p_idempotency_key uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_hr(); v_hash text; v_batch public.cashier_roster_batches; v_change jsonb;
  v_employee_id uuid; v_employee public.employees; v_work_date date; v_outlet_id uuid; v_shift text;
  v_reason text; v_id uuid; v_expected_updated_at timestamptz; v_cancel boolean; v_old public.cashier_assignments;
  v_row public.cashier_assignments; v_rows jsonb:='[]'::jsonb; v_result jsonb; v_today date:=(now() at time zone 'Asia/Jakarta')::date;
  v_outlet public.outlets;
begin
  if p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1 then raise exception 'Minggu kerja harus dimulai pada hari Senin'; end if;
  if p_idempotency_key is null then raise exception 'Kunci penyimpanan jadwal wajib diisi'; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'Batch harus berisi 1 sampai 500 perubahan jadwal'; end if;
  v_hash:=md5(p_week_start::text||':'||p_changes::text);
  insert into public.cashier_roster_batches(actor_employee_id,idempotency_key,request_hash,week_start)
    values(v_actor,p_idempotency_key,v_hash,p_week_start) on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_batch;
  if not found then
    select * into strict v_batch from public.cashier_roster_batches where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_batch.request_hash<>v_hash then raise exception 'Kunci batch sudah dipakai untuk perubahan jadwal lain'; end if;
    if v_batch.result is null then raise exception 'Batch jadwal sebelumnya belum selesai'; end if;
    return v_batch.result;
  end if;
  if exists(
    select 1 from (select (value->>'employee_id')::uuid as employee_id,(value->>'work_date')::date as work_date,count(*) n
      from jsonb_array_elements(p_changes) group by 1,2) duplicates where n>1
  ) then raise exception 'Kasir hanya boleh memiliki satu perubahan per tanggal dalam satu batch'; end if;

  -- Match the existing single-row workflow's employee-first mutex and acquire
  -- locks in a stable order so simultaneous SPV batches do not deadlock.
  for v_employee_id in select distinct (value->>'employee_id')::uuid from jsonb_array_elements(p_changes) order by 1 loop
    if v_employee_id=v_actor then raise exception 'Penugasan sendiri harus diatur Admin HR lain'; end if;
    select * into strict v_employee from public.employees where id=v_employee_id and status='active' and can_clock for no key update;
  end loop;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_employee_id:=nullif(v_change->>'employee_id','')::uuid;
    v_work_date:=nullif(v_change->>'work_date','')::date;
    v_outlet_id:=nullif(v_change->>'outlet_id','')::uuid;
    v_shift:=v_change->>'shift';
    v_reason:=trim(coalesce(v_change->>'reason',''));
    v_id:=nullif(v_change->>'id','')::uuid;
    v_expected_updated_at:=nullif(v_change->>'expected_updated_at','')::timestamptz;
    v_cancel:=coalesce((v_change->>'cancel')::boolean,false);
    if v_employee_id is null or v_work_date is null or not isfinite(v_work_date) or v_outlet_id is null then raise exception 'Isi kasir, tanggal, dan outlet untuk setiap perubahan'; end if;
    if v_work_date<p_week_start or v_work_date>p_week_start+6 or v_work_date<v_today then raise exception 'Jadwal batch hanya berlaku hari ini atau mendatang dalam minggu yang dipilih'; end if;
    select * into strict v_employee from public.employees where id=v_employee_id and status='active' and can_clock;
    if v_work_date<v_employee.starts_on then raise exception 'Tanggal penugasan sebelum karyawan mulai bekerja'; end if;
    if length(v_reason) not between 5 and 2000 then raise exception 'Alasan setiap perubahan minimal 5 karakter'; end if;
    if v_shift is null or v_shift not in ('morning','afternoon','middle','off') then raise exception 'Shift batch tidak valid'; end if;
    if not v_cancel and v_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan untuk kasir ini'; end if;
    select * into strict v_outlet from public.outlets where id=v_outlet_id and active;
    select * into v_old from public.cashier_assignments where employee_id=v_employee_id and work_date=v_work_date for update;
    if found then
      if v_old.id is distinct from v_id or v_old.updated_at is distinct from v_expected_updated_at then
        raise exception 'Jadwal berubah sejak pratinjau. Muat ulang dan periksa konflik'; end if;
    elsif v_id is not null or v_expected_updated_at is not null then
      raise exception 'Jadwal berubah sejak pratinjau. Muat ulang dan periksa konflik';
    end if;
    if v_cancel and (v_old.id is null or v_old.status<>'active') then raise exception 'Penugasan aktif yang akan dibatalkan tidak ditemukan'; end if;
    if exists(select 1 from public.attendance a where a.employee_id=v_employee_id and a.work_date=v_work_date) then
      raise exception 'Jadwal tidak dapat diubah setelah absensi tercatat'; end if;
    if not v_cancel and v_shift<>'off' and exists(select 1 from public.leave_requests l where l.employee_id=v_employee_id and l.status='approved'
      and coalesce(l.extent,'full_day')='full_day' and l.starts_on<=v_work_date and l.ends_on>=v_work_date) then
      raise exception 'Penugasan kerja berbenturan dengan cuti sehari penuh yang disetujui'; end if;

    if v_cancel then
      update public.cashier_assignments set status='cancelled',reason=v_reason,updated_at=clock_timestamp() where id=v_old.id returning * into v_row;
    elsif v_old.id is null then
      insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by)
        values(v_employee_id,v_work_date,v_outlet_id,v_shift,v_reason,v_actor) returning * into v_row;
    else
      update public.cashier_assignments set outlet_id=v_outlet_id,shift=v_shift,status='active',reason=v_reason,updated_at=clock_timestamp()
        where id=v_old.id returning * into v_row;
    end if;
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
      values('assignment',v_row.id,v_actor,'weekly_batch_saved',v_reason,
        case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_row));
    v_rows:=v_rows||jsonb_build_array(to_jsonb(v_row));
  end loop;

  insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
    select distinct e.id,'assignment_week',v_batch.id,'Jadwal mingguan diperbarui',
      'Ada jadwal kasir baru atau perubahan jadwal. Buka aplikasi untuk melihat rincian.',
      '/assignments?week='||p_week_start::text
    from jsonb_array_elements(p_changes) c
    join public.employees e on e.id=(c->>'employee_id')::uuid
    where e.status='active' and e.account_status='active' and e.id<>v_actor;
  v_result:=jsonb_build_object('batch_id',v_batch.id,'week_start',p_week_start,'saved_count',jsonb_array_length(v_rows),'assignments',v_rows);
  update public.cashier_roster_batches set result=v_result where id=v_batch.id;
  return v_result;
end;
$$;

create function public.spv_followup_start(p_issue_type text,p_work_date date,p_outlet_id uuid,p_employee_id uuid,
  p_shift text,p_source_type text,p_source_id uuid)
returns public.spv_followups language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_hr(); v_row public.spv_followups; v_before public.spv_followups; v_case_key text; v_assignment public.cashier_assignments;
  v_attendance public.attendance; v_correction public.attendance_correction_requests; v_employee public.employees;
  v_outlet public.outlets; v_day date:=(now() at time zone 'Asia/Jakarta')::date; v_due timestamptz; v_arrival time;
begin
  if p_work_date is null or not isfinite(p_work_date) or not exists(select 1 from public.outlets where id=p_outlet_id) then raise exception 'Sumber tindak lanjut tidak valid'; end if;
  if p_issue_type is null or p_issue_type not in ('missing_clockin','unassigned','open_session','unexcused_lateness','correction_pending','leave_conflict','short_duration') then raise exception 'Jenis tindak lanjut tidak dikenal'; end if;
  select e.* into strict v_employee from public.employees e join public.positions p on p.id=e.position_id
    where e.id=p_employee_id and e.status='active' and p.is_cashier;
  if p_source_type='assignment' then
    select * into strict v_assignment from public.cashier_assignments where id=p_source_id for share;
    if v_assignment.employee_id<>p_employee_id or v_assignment.work_date<>p_work_date or v_assignment.outlet_id<>p_outlet_id
      or v_assignment.shift<>p_shift or v_assignment.status<>'active' then raise exception 'Penugasan sumber sudah berubah'; end if;
    if p_issue_type in ('missing_clockin','leave_conflict') then
      if p_issue_type='missing_clockin' and (v_assignment.shift not in ('morning','afternoon') or p_work_date>v_day
        or exists(select 1 from public.attendance a where a.employee_id=p_employee_id and a.work_date=p_work_date)
        or exists(select 1 from public.leave_requests l where l.employee_id=p_employee_id and l.status='approved'
          and coalesce(l.extent,'full_day')='full_day' and l.starts_on<=p_work_date and l.ends_on>=p_work_date)) then
        raise exception 'Kondisi jadwal tidak lagi memerlukan konfirmasi clock in'; end if;
      if p_issue_type='missing_clockin' and p_work_date=v_day then
        select * into strict v_outlet from public.outlets where id=p_outlet_id;
        v_due:=(p_work_date+case v_assignment.shift when 'morning' then v_outlet.morning_starts_at else v_outlet.afternoon_starts_at end)
          at time zone 'Asia/Jakarta' + make_interval(mins=>v_outlet.late_tolerance_minutes);
        select max(coalesce(l.starts_at,l.ends_at)) into v_arrival from public.leave_requests l where l.employee_id=p_employee_id
          and l.status='approved' and l.extent='late_arrival' and l.starts_on=p_work_date and l.ends_on=p_work_date;
        if v_arrival is not null then v_due:=greatest(v_due,(p_work_date+v_arrival) at time zone 'Asia/Jakarta'); end if;
        if clock_timestamp()<v_due then raise exception 'Waktu masuk atau izin terlambat belum berakhir'; end if;
      end if;
      if p_issue_type='leave_conflict' and not exists(select 1 from public.leave_requests l where l.employee_id=p_employee_id and l.status='approved'
        and coalesce(l.extent,'full_day')='full_day' and l.starts_on<=p_work_date and l.ends_on>=p_work_date) then
        raise exception 'Tidak ada cuti penuh disetujui yang berbenturan dengan jadwal'; end if;
    else raise exception 'Jenis tindak lanjut tidak cocok dengan sumber penugasan'; end if;
  elsif p_source_type='attendance' then
    select * into strict v_attendance from public.attendance where id=p_source_id for share;
    if v_attendance.employee_id<>p_employee_id or v_attendance.work_date<>p_work_date or v_attendance.outlet_id<>p_outlet_id
      or v_attendance.shift<>p_shift then raise exception 'Sumber kehadiran sudah berubah'; end if;
    if p_issue_type='open_session' then
      if v_attendance.clock_out is not null or v_attendance.clock_in>clock_timestamp()-interval '8 hours' then raise exception 'Sesi belum mencapai waktu pemeriksaan'; end if;
    elsif p_issue_type='unexcused_lateness' then
      if v_attendance.late_minutes<=0 then raise exception 'Tidak ada keterlambatan pada sumber ini'; end if;
      select max(coalesce(l.starts_at,l.ends_at)) into v_arrival from public.leave_requests l where l.employee_id=p_employee_id
        and l.status='approved' and l.extent='late_arrival' and l.starts_on=p_work_date and l.ends_on=p_work_date;
      if v_arrival is not null and (v_attendance.clock_in at time zone 'Asia/Jakarta')::time<=v_arrival then raise exception 'Keterlambatan sepenuhnya tercakup izin'; end if;
    elsif p_issue_type='short_duration' then
      if v_attendance.clock_out is null or coalesce(v_attendance.worked_minutes,480)>=480 then raise exception 'Durasi belum memenuhi pemeriksaan selisih'; end if;
    else raise exception 'Jenis tindak lanjut tidak cocok dengan sumber kehadiran'; end if;
  elsif p_source_type='correction' and p_issue_type='correction_pending' then
    select * into strict v_correction from public.attendance_correction_requests where id=p_source_id for share;
    if v_correction.employee_id<>p_employee_id or v_correction.work_date<>p_work_date or v_correction.outlet_id<>p_outlet_id
      or v_correction.shift<>p_shift or v_correction.status<>'pending' then raise exception 'Permintaan koreksi sudah berubah'; end if;
  elsif p_source_type='roster' and p_issue_type='unassigned' and p_source_id is null and p_shift is null then
    if p_work_date>v_day or p_outlet_id<>v_employee.outlet_id or extract(dow from p_work_date)::integer=any(v_employee.weekly_off_days)
      or exists(select 1 from public.cashier_assignments a where a.employee_id=p_employee_id and a.work_date=p_work_date and a.status='active')
      or exists(select 1 from public.attendance a where a.employee_id=p_employee_id and a.work_date=p_work_date)
      or exists(select 1 from public.leave_requests l where l.employee_id=p_employee_id and l.status='approved'
        and coalesce(l.extent,'full_day')='full_day' and l.starts_on<=p_work_date and l.ends_on>=p_work_date) then
      raise exception 'Kasir tidak lagi memerlukan tindak lanjut penugasan'; end if;
  else raise exception 'Sumber tindak lanjut tidak sesuai jenis kasus'; end if;

  v_case_key:=case when p_source_type='roster' then p_issue_type||':'||p_employee_id::text||':'||p_work_date::text
    else p_issue_type||':'||p_source_id::text end;
  insert into public.spv_followups(case_key,issue_type,source_type,source_id,work_date,outlet_id,employee_id,shift,created_by,updated_by)
    values(v_case_key,p_issue_type,p_source_type,p_source_id,p_work_date,p_outlet_id,p_employee_id,p_shift,v_actor,v_actor)
    on conflict(case_key) do nothing returning * into v_row;
  if not found then
    select * into strict v_row from public.spv_followups where case_key=v_case_key for update;
    if v_row.status='completed' then
      v_before:=v_row;
      update public.spv_followups set status='new',owner_id=null,resolution_note='',updated_by=v_actor,updated_at=clock_timestamp(),
        reopened_count=reopened_count+1 where id=v_row.id returning * into v_row;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('spv_followup',v_row.id,v_actor,'reopened','Kondisi sumber muncul kembali',to_jsonb(v_before),to_jsonb(v_row));
    end if;
    return v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('spv_followup',v_row.id,v_actor,'started','Tindak lanjut dimulai',to_jsonb(v_row));
  return v_row;
end;
$$;

create function public.spv_followup_update(p_id uuid,p_status text,p_owner_id uuid,p_note text,p_resolution_note text)
returns public.spv_followups language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.spv_followups; v_row public.spv_followups;
begin
  select * into strict v_before from public.spv_followups where id=p_id for update;
  if p_status is null or p_status not in ('new','in_progress','completed') then raise exception 'Status tindak lanjut tidak valid'; end if;
  if v_before.status='completed' and p_status<>'completed' then raise exception 'Gunakan Buka lagi setelah kondisi sumber muncul kembali'; end if;
  if p_owner_id is not null and not exists(select 1 from public.employees e join public.employee_roles r on r.employee_id=e.id
    where e.id=p_owner_id and e.status='active' and e.account_status='active' and r.role='admin_hr') then raise exception 'Penanggung jawab harus Admin HR aktif'; end if;
  if p_status='in_progress' and p_owner_id is null then raise exception 'Pilih penanggung jawab sebelum memproses kasus'; end if;
  if p_status='completed' and length(trim(coalesce(p_resolution_note,'')))<5 then raise exception 'Catatan penyelesaian minimal 5 karakter'; end if;
  if length(coalesce(p_note,''))>2000 or length(coalesce(p_resolution_note,''))>2000 then raise exception 'Catatan maksimal 2.000 karakter'; end if;
  update public.spv_followups set status=p_status,owner_id=p_owner_id,note=trim(coalesce(p_note,'')),
    resolution_note=case when p_status='completed' then trim(coalesce(p_resolution_note,'')) else '' end,
    updated_by=v_actor,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('spv_followup',v_row.id,v_actor,case when p_status='completed' then 'completed' else 'updated' end,
      coalesce(nullif(trim(coalesce(p_resolution_note,'')),''),nullif(trim(coalesce(p_note,'')),''),'Tindak lanjut diperbarui'),to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

revoke all on function public.staffing_requirement_save(uuid,integer,text,integer,date),
  public.cashier_roster_batch_save(date,uuid,jsonb),
  public.spv_followup_start(text,date,uuid,uuid,text,text,uuid),
  public.spv_followup_update(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.staffing_requirement_save(uuid,integer,text,integer,date),
  public.cashier_roster_batch_save(date,uuid,jsonb),
  public.spv_followup_start(text,date,uuid,uuid,text,text,uuid),
  public.spv_followup_update(uuid,text,uuid,text,text) to authenticated;

alter publication supabase_realtime add table public.staffing_requirements,public.spv_followups;
