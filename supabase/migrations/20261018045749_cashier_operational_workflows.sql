-- Daily roster and employee-submitted attendance exceptions. Writes stay behind
-- authenticated RPCs; every attendance/assignment operation locks employee first.
create table public.cashier_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  work_date date not null check(isfinite(work_date)),
  outlet_id uuid not null references public.outlets(id),
  shift text not null check(shift in ('morning','afternoon','middle','off')),
  status text not null default 'active' check(status in ('active','cancelled')),
  reason text not null check(length(trim(reason)) between 5 and 2000),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(employee_id,work_date)
);
create index cashier_assignments_outlet_date on public.cashier_assignments(outlet_id,work_date);
create index cashier_assignments_creator on public.cashier_assignments(created_by);
alter table public.attendance add column assignment_id uuid references public.cashier_assignments(id);
create index attendance_assignment on public.attendance(assignment_id) where assignment_id is not null;
alter table public.cashier_assignments enable row level security;
revoke all on public.cashier_assignments from public,anon,authenticated;
grant select on public.cashier_assignments to authenticated;
create policy cashier_assignments_read on public.cashier_assignments for select to authenticated
  using(employee_id=(select private.employee_id()) or (select private.has_role('admin_hr')));

create table public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),
  attendance_id uuid references public.attendance(id),work_date date not null check(isfinite(work_date)),
  outlet_id uuid not null references public.outlets(id),shift text not null check(shift in ('morning','afternoon','middle')),
  proposed_clock_in timestamptz not null check(isfinite(proposed_clock_in)),proposed_clock_out timestamptz,
  reason text not null check(length(trim(reason)) between 5 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  decision_note text,decision_by uuid references public.employees(id),original_snapshot jsonb,
  created_at timestamptz not null default now(),decided_at timestamptz,
  check(proposed_clock_out is null or (isfinite(proposed_clock_out) and proposed_clock_out>=proposed_clock_in)),
  check((proposed_clock_in at time zone 'Asia/Jakarta')::date=work_date)
);
create unique index attendance_correction_one_pending on public.attendance_correction_requests(employee_id,work_date) where status='pending';
create index attendance_correction_status_date on public.attendance_correction_requests(status,work_date);
create index attendance_correction_employee_created on public.attendance_correction_requests(employee_id,created_at desc);
create index attendance_correction_attendance on public.attendance_correction_requests(attendance_id) where attendance_id is not null;
create index attendance_correction_outlet_date on public.attendance_correction_requests(outlet_id,work_date);
create index attendance_correction_decider on public.attendance_correction_requests(decision_by) where decision_by is not null;
alter table public.attendance_correction_requests enable row level security;
revoke all on public.attendance_correction_requests from public,anon,authenticated;
grant select on public.attendance_correction_requests to authenticated;
create policy attendance_corrections_read on public.attendance_correction_requests for select to authenticated
  using(employee_id=(select private.employee_id()) or (select private.has_role('admin_hr')));

-- Existing leave notifications remain valid. Other entity IDs are checked in
-- the only writer helper rather than a foreign key to one workflow's table.
alter table public.notifications drop constraint notifications_entity_id_fkey;
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add column entity_type text not null default 'leave'
  check(entity_type in ('leave','attendance_correction','assignment','attendance_reminder'));
alter table public.notifications add constraint notifications_href_check check(
  (entity_type='leave' and href='/leave?request='||entity_id::text)
  or (entity_type='attendance_correction' and href in ('/attendance?request='||entity_id::text,'/reports?tab=corrections&request='||entity_id::text))
  or (entity_type='assignment' and href ~ '^/assignments\?date=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='attendance_reminder' and href='/attendance?record='||entity_id::text));
create index notifications_entity on public.notifications(entity_type,entity_id);
create function private.notify_workflow(p_employee_id uuid,p_entity_type text,p_entity_id uuid,p_title text,p_href text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_employee_id is null or p_employee_id=private.employee_id() then return; end if;
  if not exists(select 1 from public.employees where id=p_employee_id and status='active' and account_status='active') then return; end if;
  if (p_entity_type='assignment' and not exists(select 1 from public.cashier_assignments where id=p_entity_id and p_href='/assignments?date='||work_date::text))
    or (p_entity_type='attendance_correction' and not exists(select 1 from public.attendance_correction_requests where id=p_entity_id))
    or (p_entity_type='attendance_reminder' and not exists(select 1 from public.attendance where id=p_entity_id and employee_id=p_employee_id))
    or p_entity_type not in ('assignment','attendance_correction','attendance_reminder') then raise exception 'Tujuan notifikasi tidak valid'; end if;
  insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
    values(p_employee_id,p_entity_type,p_entity_id,p_title,'Buka rincian untuk melihat informasi terbaru.',p_href);
end;
$$;
revoke all on function private.notify_workflow(uuid,text,uuid,text,text) from public,anon,authenticated;

create function public.cashier_assignment_save(p_employee_id uuid,p_work_date date,p_outlet_id uuid,p_shift text,
  p_reason text,p_id uuid default null,p_cancel boolean default false)
returns public.cashier_assignments language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_old public.cashier_assignments; v_row public.cashier_assignments;
begin
  if p_employee_id=v_actor then raise exception 'Penugasan sendiri harus diatur Admin HR lain'; end if;
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for no key update;
  if not v_employee.can_clock then raise exception 'Penugasan hanya untuk kasir aktif'; end if;
  if p_work_date is null or not isfinite(p_work_date) or p_work_date<v_employee.starts_on then raise exception 'Tanggal penugasan tidak valid atau sebelum mulai bekerja'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Alasan penugasan minimal 5 karakter'; end if;
  if p_cancel is null then raise exception 'Jenis perubahan penugasan wajib diisi'; end if;
  if p_id is not null then
    select * into strict v_old from public.cashier_assignments where id=p_id for update;
    if v_old.employee_id<>p_employee_id or v_old.work_date<>p_work_date then raise exception 'Penugasan tidak sesuai karyawan atau tanggal'; end if;
  else select * into v_old from public.cashier_assignments where employee_id=p_employee_id and work_date=p_work_date for update; end if;
  if exists(select 1 from public.attendance where employee_id=p_employee_id and work_date=p_work_date) then
    raise exception 'Penugasan tidak dapat diubah setelah absensi tercatat'; end if;
  if p_cancel then
    if v_old.id is null or v_old.status<>'active' then raise exception 'Penugasan aktif tidak ditemukan'; end if;
    update public.cashier_assignments set status='cancelled',reason=trim(p_reason),updated_at=now() where id=v_old.id returning * into v_row;
  else
    if p_shift is null or p_shift not in ('morning','afternoon','middle','off') then raise exception 'Shift penugasan tidak valid'; end if;
    if p_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan oleh SPV'; end if;
    if not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet aktif tidak ditemukan'; end if;
    if v_old.id is null then
      insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by)
        values(p_employee_id,p_work_date,p_outlet_id,p_shift,trim(p_reason),v_actor) returning * into v_row;
    else
      update public.cashier_assignments set outlet_id=p_outlet_id,shift=p_shift,status='active',reason=trim(p_reason),updated_at=now()
        where id=v_old.id returning * into v_row;
    end if;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('assignment',v_row.id,v_actor,case when p_cancel then 'cancelled' else 'saved' end,trim(p_reason),
      case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_row));
  perform private.notify_workflow(p_employee_id,'assignment',v_row.id,case when p_cancel then 'Penugasan dibatalkan' else 'Penugasan diperbarui' end,'/assignments?date='||v_row.work_date::text);
  return v_row;
end;
$$;

create function public.attendance_correction_submit(p_attendance_id uuid,p_work_date date,p_clock_in timestamptz,
  p_clock_out timestamptz,p_shift text,p_reason text)
returns public.attendance_correction_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_employee public.employees; v_attendance public.attendance;
  v_outlet uuid; v_row public.attendance_correction_requests; v_hr record;
begin
  select * into strict v_employee from public.employees where id=v_actor for no key update;
  if not v_employee.can_clock then raise exception 'Permintaan koreksi hanya untuk kasir'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Alasan permintaan minimal 5 karakter'; end if;
  if p_clock_in is null or not isfinite(p_clock_in) or p_clock_in>now() or p_clock_out>now()
    or not isfinite(p_clock_out) or p_clock_out<p_clock_in or p_work_date is null
    or p_work_date<v_employee.starts_on or (p_clock_in at time zone 'Asia/Jakarta')::date<>p_work_date then raise exception 'Waktu permintaan koreksi tidak valid'; end if;
  if p_shift is null or p_shift not in ('morning','afternoon','middle') then raise exception 'Shift tidak valid'; end if;
  if p_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan oleh SPV'; end if;
  if p_attendance_id is not null then
    select * into strict v_attendance from public.attendance where id=p_attendance_id and employee_id=v_actor for update;
    if v_attendance.work_date<>p_work_date then raise exception 'Tanggal kerja tidak dapat diubah'; end if;
    v_outlet:=v_attendance.outlet_id;
  else
    if exists(select 1 from public.attendance where employee_id=v_actor and work_date=p_work_date) then raise exception 'Absensi sudah ada; ajukan koreksi catatan tersebut'; end if;
    select outlet_id into v_outlet from public.cashier_assignments where employee_id=v_actor and work_date=p_work_date and status='active';
    v_outlet:=coalesce(v_outlet,v_employee.outlet_id);
  end if;
  insert into public.attendance_correction_requests(employee_id,attendance_id,work_date,outlet_id,shift,proposed_clock_in,proposed_clock_out,reason,original_snapshot)
    values(v_actor,p_attendance_id,p_work_date,v_outlet,p_shift,p_clock_in,p_clock_out,trim(p_reason),
      case when p_attendance_id is null then null else jsonb_build_object('clock_in',v_attendance.clock_in,'clock_out',v_attendance.clock_out,'shift',v_attendance.shift,'outlet_id',v_attendance.outlet_id) end) returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('attendance_correction',v_row.id,v_actor,'submitted',trim(p_reason),to_jsonb(v_row));
  for v_hr in select employee_id from public.employee_roles where role='admin_hr' loop
    perform private.notify_workflow(v_hr.employee_id,'attendance_correction',v_row.id,'Permintaan koreksi kehadiran','/reports?tab=corrections&request='||v_row.id::text);
  end loop;
  return v_row;
exception when unique_violation then raise exception 'Masih ada permintaan koreksi yang menunggu pada tanggal ini';
end;
$$;

create function public.attendance_correction_cancel(p_id uuid)
returns public.attendance_correction_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.attendance_correction_requests; v_old public.attendance_correction_requests;
begin
  perform 1 from public.employees where id=v_actor for no key update;
  select * into strict v_old from public.attendance_correction_requests where id=p_id and employee_id=v_actor for update;
  if v_old.status<>'pending' then raise exception 'Permintaan sudah diproses'; end if;
  update public.attendance_correction_requests set status='cancelled',decided_at=now() where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('attendance_correction',p_id,v_actor,'cancelled',v_old.reason,to_jsonb(v_old),to_jsonb(v_row));
  return v_row;
end;
$$;

create function public.attendance_correction_decide(p_id uuid,p_approved boolean,p_note text)
returns public.attendance_correction_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_old public.attendance_correction_requests; v_row public.attendance_correction_requests;
  v_employee uuid; v_applied public.attendance; v_current public.attendance; v_current_outlet uuid;
begin
  select employee_id into strict v_employee from public.attendance_correction_requests where id=p_id;
  if v_employee=v_actor then raise exception 'Permintaan sendiri tidak boleh diputuskan'; end if;
  perform 1 from public.employees where id=v_employee for no key update;
  select * into strict v_old from public.attendance_correction_requests where id=p_id for update;
  if v_old.status<>'pending' then raise exception 'Permintaan sudah diproses'; end if;
  if p_approved is null then raise exception 'Keputusan wajib diisi'; end if;
  if length(trim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Catatan keputusan minimal 5 karakter'; end if;
  if p_approved then
    if not exists(select 1 from public.employees where id=v_employee and status='active' and can_clock) then raise exception 'Kasir tidak aktif'; end if;
    if v_old.attendance_id is not null then
      select * into strict v_current from public.attendance where id=v_old.attendance_id for update;
      if row(v_current.clock_in,v_current.clock_out,v_current.shift,v_current.outlet_id) is distinct from row(
        (v_old.original_snapshot->>'clock_in')::timestamptz,(v_old.original_snapshot->>'clock_out')::timestamptz,
        v_old.original_snapshot->>'shift',(v_old.original_snapshot->>'outlet_id')::uuid) then
        raise exception 'Catatan absensi berubah sejak permintaan dibuat. Tolak dan minta pengajuan baru'; end if;
      v_applied:=public.attendance_correct(v_old.attendance_id,v_old.proposed_clock_in,v_old.proposed_clock_out,
        trim(p_note)||' · Permintaan: '||v_old.reason,v_old.shift);
    else
      select coalesce(a.outlet_id,e.outlet_id) into strict v_current_outlet from public.employees e
        left join public.cashier_assignments a on a.employee_id=e.id and a.work_date=v_old.work_date and a.status='active'
        where e.id=v_old.employee_id;
      if v_current_outlet is distinct from v_old.outlet_id then raise exception 'Outlet penugasan berubah sejak permintaan dibuat. Tolak dan minta pengajuan baru'; end if;
      v_applied:=public.attendance_record_manual(v_old.employee_id,v_old.shift,v_old.proposed_clock_in,v_old.proposed_clock_out,
        trim(p_note)||' · Permintaan: '||v_old.reason);
    end if;
  end if;
  update public.attendance_correction_requests set status=case when p_approved then 'approved' else 'rejected' end,
    attendance_id=case when p_approved then v_applied.id else attendance_id end,decision_by=v_actor,decision_note=trim(p_note),decided_at=now()
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('attendance_correction',p_id,v_actor,v_row.status,trim(p_note),to_jsonb(v_old),to_jsonb(v_row));
  perform private.notify_workflow(v_old.employee_id,'attendance_correction',p_id,
    case when p_approved then 'Koreksi kehadiran disetujui' else 'Koreksi kehadiran ditolak' end,'/attendance?request='||p_id::text);
  return v_row;
end;
$$;

create function public.leave_record_retrospective(p_employee_id uuid,p_kind text,p_starts_on date,p_ends_on date,p_reason text,
  p_extent text default 'full_day',p_starts_at time default null,p_ends_at time default null,p_deductions jsonb default '{}',
  p_note text default null,p_external_decider text default null)
returns public.leave_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_row public.leave_requests;
begin
  if p_employee_id=v_actor then raise exception 'Pengajuan sendiri harus dicatat Admin HR lain'; end if;
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for no key update;
  if p_kind is null or p_kind not in ('personal','sick') then raise exception 'Pencatatan susulan hanya untuk izin pribadi atau sakit'; end if;
  if p_starts_on<v_employee.starts_on or p_starts_on>=(now() at time zone 'Asia/Jakarta')::date or p_ends_on>(now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Pencatatan susulan harus mulai pada tanggal lampau tanpa tanggal akhir mendatang'; end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 2000 or length(trim(coalesce(p_note,''))) not between 5 and 2000 then
    raise exception 'Alasan dan sumber konfirmasi HR wajib diisi'; end if;
  if v_employee.approval_mode='external' and length(trim(coalesce(p_external_decider,'')))<3 then
    raise exception 'Nama pemberi keputusan eksternal wajib diisi'; end if;
  perform private.assert_leave_period(p_extent,p_starts_on,p_ends_on,p_starts_at,p_ends_at);
  insert into public.leave_requests(employee_id,kind,extent,starts_on,ends_on,starts_at,ends_at,reason,status,decision_by,
    external_decider,decided_at,decision_note,deductions)
    values(p_employee_id,p_kind,p_extent,p_starts_on,p_ends_on,p_starts_at,p_ends_at,trim(p_reason),'approved',v_actor,
      case when v_employee.approval_mode='external' then trim(p_external_decider) else null end,now(),trim(p_note),p_deductions) returning * into v_row;
  v_row.deductions:='{}';
  perform private.set_deductions(v_row,p_deductions,'retrospective:'||v_row.id::text,v_actor);
  v_row.deductions:=p_deductions;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('leave',v_row.id,v_actor,'recorded_retrospective',trim(p_note),to_jsonb(v_row));
  perform private.notify_employee(p_employee_id,v_row.id,'Izin susulan dicatat HR');
  return v_row;
end;
$$;

create function public.leave_correct_hours(p_id uuid,p_starts_on date,p_ends_on date,p_deductions jsonb,p_reason text,
  p_cancel boolean default false,p_external_decider text default null,p_starts_at time default null,p_ends_at time default null)
returns public.leave_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.leave_requests; v_new public.leave_requests;
  v_row public.leave_requests; v_external boolean; v_deductions jsonb;
begin
  select * into strict v_before from public.leave_requests where id=p_id for update;
  if v_before.employee_id=v_actor then raise exception 'Pengajuan sendiri tidak boleh dikoreksi'; end if;
  if v_before.status<>'approved' then raise exception 'Hanya pengajuan disetujui yang dapat dikoreksi HR'; end if;
  if exists(select 1 from public.leave_adjustments where leave_request_id=p_id and status='pending') then raise exception 'Selesaikan permintaan perubahan yang masih menunggu terlebih dahulu'; end if;
  if p_cancel is null then raise exception 'Jenis koreksi wajib diisi'; end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 2000 then raise exception 'Alasan koreksi harus berisi 3 sampai 2000 karakter'; end if;
  select approval_mode='external' into v_external from public.employees where id=v_before.employee_id;
  if v_external and length(trim(coalesce(p_external_decider,'')))<3 then raise exception 'Nama pemberi keputusan eksternal wajib diisi'; end if;
  v_new:=v_before;
  if p_cancel then v_deductions:='{}';
  else
    v_new.starts_on:=p_starts_on; v_new.ends_on:=p_ends_on; v_new.starts_at:=p_starts_at; v_new.ends_at:=p_ends_at;
    perform private.assert_leave_period(v_new.extent,v_new.starts_on,v_new.ends_on,v_new.starts_at,v_new.ends_at);
    v_deductions:=p_deductions;
  end if;
  perform private.set_deductions(v_new,v_deductions,'correct:'||gen_random_uuid()::text,v_actor);
  update public.leave_requests set starts_on=v_new.starts_on,ends_on=v_new.ends_on,starts_at=v_new.starts_at,ends_at=v_new.ends_at,
    status=case when p_cancel then 'cancelled' else 'approved' end,deductions=v_deductions,decision_by=v_actor,
    external_decider=case when v_external then trim(p_external_decider) else null end,
    decided_at=now(),decision_note=trim(p_reason),updated_at=now() where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('leave',p_id,v_actor,'hours_corrected',trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

revoke all on function public.cashier_assignment_save(uuid,date,uuid,text,text,uuid,boolean),
  public.attendance_correction_submit(uuid,date,timestamptz,timestamptz,text,text),
  public.attendance_correction_decide(uuid,boolean,text),public.attendance_correction_cancel(uuid),
  public.leave_record_retrospective(uuid,text,date,date,text,text,time,time,jsonb,text,text),
  public.leave_correct_hours(uuid,date,date,jsonb,text,boolean,text,time,time) from public,anon,authenticated;
grant execute on function public.cashier_assignment_save(uuid,date,uuid,text,text,uuid,boolean),
  public.attendance_correction_submit(uuid,date,timestamptz,timestamptz,text,text),
  public.attendance_correction_decide(uuid,boolean,text),public.attendance_correction_cancel(uuid),
  public.leave_record_retrospective(uuid,text,date,date,text,text,time,time,jsonb,text,text),
  public.leave_correct_hours(uuid,date,date,jsonb,text,boolean,text,time,time) to authenticated;
alter publication supabase_realtime add table public.cashier_assignments,public.attendance_correction_requests;
create or replace function public.attendance_clock_in(p_shift text,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_selfie_path text) returns public.attendance
language plpgsql security definer set search_path='' as $$
declare v_employee public.employees; v_outlet public.outlets; v_now timestamptz:=clock_timestamp();
  v_date date:=(v_now at time zone 'Asia/Jakarta')::date; v_expected timestamptz;
  v_distance double precision; v_row public.attendance; v_assignment public.cashier_assignments;
begin
  select * into strict v_employee from public.employees where id=private.require_employee() for no key update;
  if not v_employee.can_clock then raise exception 'Clock in hanya tersedia untuk kasir yang diizinkan'; end if;
  if p_shift not in ('morning','afternoon','middle') or p_shift is null then raise exception 'Shift tidak valid'; end if;
  if p_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan oleh SPV'; end if;
  select * into v_assignment from public.cashier_assignments where employee_id=v_employee.id and work_date=v_date and status='active';
  if not found then raise exception 'Penugasan hari ini belum tersedia. Hubungi HR'; end if;
  if v_assignment.shift='off' then raise exception 'Hari ini dijadwalkan libur'; end if;
  if p_shift<>v_assignment.shift then raise exception 'Shift tidak sesuai penugasan HR'; end if;
  select * into strict v_outlet from public.outlets where id=v_assignment.outlet_id and active;
  v_distance:=private.validate_location(p_latitude,p_longitude,p_accuracy_m,v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,v_outlet.max_accuracy_m);
  if p_selfie_path is null or split_part(p_selfie_path,'/',1)<>auth.uid()::text
    or not exists(select 1 from storage.objects where bucket_id='attendance-selfies' and name=p_selfie_path) then
    raise exception 'Selfie wajib diunggah sebelum clock in'; end if;
  if exists(select 1 from public.attendance where selfie_path=p_selfie_path) then raise exception 'Gunakan selfie baru untuk setiap clock in'; end if;
  v_expected:=case p_shift when 'morning' then (v_date+v_outlet.morning_starts_at) at time zone 'Asia/Jakarta'
    when 'afternoon' then (v_date+v_outlet.afternoon_starts_at) at time zone 'Asia/Jakarta' else null end;
  insert into public.attendance(employee_id,assignment_id,outlet_id,work_date,shift,expected_in,expected_out,morning_starts_at,afternoon_starts_at,tolerance_minutes,
    outlet_latitude,outlet_longitude,radius_m,clock_in,in_latitude,in_longitude,in_accuracy_m,in_distance_m,selfie_path,late_minutes)
  values(v_employee.id,v_assignment.id,v_outlet.id,v_date,p_shift,v_expected,coalesce(v_expected,v_now)+interval '8 hours',v_outlet.morning_starts_at,v_outlet.afternoon_starts_at,
    v_outlet.late_tolerance_minutes,v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,v_now,p_latitude,p_longitude,
    p_accuracy_m,v_distance,p_selfie_path,
    case when v_expected is null or v_now<=v_expected+make_interval(mins=>v_outlet.late_tolerance_minutes) then 0
    else ceil(extract(epoch from(v_now-v_expected))/60)::integer end) returning * into v_row;
  return v_row;
exception when unique_violation then raise exception 'Clock in hari ini sudah tercatat atau clock out sebelumnya belum selesai';
end;
$$;
create or replace function public.attendance_record_manual(p_employee_id uuid,p_shift text,p_clock_in timestamptz,
  p_clock_out timestamptz default null,p_reason text default null)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_outlet public.outlets;
  v_date date; v_expected timestamptz; v_row public.attendance; v_outlet_id uuid; v_assignment_id uuid;
begin
  if v_actor=p_employee_id then raise exception 'Catatan absensi sendiri tidak boleh dibuat manual'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Alasan pencatatan manual wajib diisi'; end if;
  if p_clock_in is null or not isfinite(p_clock_in) or p_clock_in>now()
    or p_clock_out>now() or p_clock_out<p_clock_in or not isfinite(p_clock_out) then
    raise exception 'Waktu pencatatan manual tidak valid'; end if;
  if p_shift is null or p_shift not in ('morning','afternoon','middle') then raise exception 'Shift tidak valid'; end if;
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for no key update;
  if not v_employee.can_clock then raise exception 'Pencatatan absensi hanya untuk kasir yang diizinkan'; end if;
  if p_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan oleh SPV'; end if;
  v_date:=(p_clock_in at time zone 'Asia/Jakarta')::date;
  select outlet_id,id into v_outlet_id,v_assignment_id from public.cashier_assignments where employee_id=v_employee.id and work_date=v_date and status='active';
  select * into strict v_outlet from public.outlets where id=coalesce(v_outlet_id,v_employee.outlet_id);
  v_date:=(p_clock_in at time zone 'Asia/Jakarta')::date;
  v_expected:=case p_shift when 'morning' then (v_date+v_outlet.morning_starts_at) at time zone 'Asia/Jakarta'
    when 'afternoon' then (v_date+v_outlet.afternoon_starts_at) at time zone 'Asia/Jakarta' else null end;
  if exists(select 1 from public.attendance a where a.employee_id=p_employee_id
    and tstzrange(a.clock_in,a.clock_out,'[)') && tstzrange(p_clock_in,p_clock_out,'[)')) then
    raise exception 'Waktu absensi bertabrakan dengan catatan yang sudah ada'; end if;
  insert into public.attendance(employee_id,assignment_id,outlet_id,work_date,shift,expected_in,expected_out,
    morning_starts_at,afternoon_starts_at,tolerance_minutes,outlet_latitude,outlet_longitude,radius_m,
    clock_in,clock_out,late_minutes,worked_minutes,corrected,source)
  values(v_employee.id,v_assignment_id,v_outlet.id,v_date,p_shift,v_expected,coalesce(v_expected,p_clock_in)+interval '8 hours',
    v_outlet.morning_starts_at,v_outlet.afternoon_starts_at,v_outlet.late_tolerance_minutes,
    v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,p_clock_in,p_clock_out,
    case when v_expected is null or p_clock_in<=v_expected+make_interval(mins=>v_outlet.late_tolerance_minutes) then 0
      else ceil(extract(epoch from(p_clock_in-v_expected))/60)::integer end,
    case when p_clock_out is null then null else floor(extract(epoch from(p_clock_out-p_clock_in))/60)::integer end,
    true,'manual') returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('attendance',v_row.id,v_actor,'recorded_manual',trim(p_reason),to_jsonb(v_row));
  return v_row;
exception when unique_violation then
  raise exception 'Absensi tanggal tersebut sudah tercatat atau clock out sebelumnya belum selesai';
end;
$$;

-- Employee mutexes protect balances, attendance and account mutations without
-- blocking FK KEY SHARE checks from another employee's notification or audit.
-- Preserve entity/parent row locks and the key-changing account finalizer.
-- Recreate legacy bodies here so previously deployed migrations stay immutable.

create or replace function private.check_leave_duplicate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('pending','needs_info','approved') then return new; end if;
  perform 1 from public.employees where id=new.employee_id for no key update;
  if exists (
    select 1 from public.leave_requests r
    where r.employee_id=new.employee_id and r.id<>new.id
      and r.status in ('pending','needs_info','approved')
      and r.kind=new.kind and r.extent=new.extent
      and r.starts_on=new.starts_on and r.ends_on=new.ends_on
      and r.starts_at is not distinct from new.starts_at
      and r.ends_at is not distinct from new.ends_at
  ) then
    raise exception 'Pengajuan yang sama sudah ada dan masih aktif' using errcode='23505';
  end if;
  return new;
end;
$$;

create or replace function private.set_deductions(p_leave public.leave_requests,p_new jsonb,p_event_key text,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_item record; v_old numeric; v_new numeric; v_remaining numeric; v_year integer;
begin
  if p_new is null or jsonb_typeof(p_new)<>'object' then raise exception 'Potongan harus berupa tahun dan jumlah hari'; end if;
  perform 1 from public.employees where id=p_leave.employee_id for no key update;
  for v_item in select key,value from jsonb_each_text(p_new) loop
    if v_item.key !~ '^20[0-9]{2}$' or v_item.value !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Potongan tidak valid'; end if;
    v_year:=v_item.key::integer; v_new:=v_item.value::numeric;
    if v_year<extract(year from p_leave.starts_on)::integer or v_year>extract(year from p_leave.ends_on)::integer then
      raise exception 'Tahun potongan harus sesuai tanggal cuti'; end if;
    if v_new>12 then raise exception 'Potongan melebihi jatah tahunan'; end if;
  end loop;
  for v_item in select key from jsonb_each(p_leave.deductions) union select key from jsonb_each(p_new) loop
    v_year:=v_item.key::integer;
    v_old:=coalesce((p_leave.deductions->>v_item.key)::numeric,0);
    v_new:=coalesce((p_new->>v_item.key)::numeric,0);
    select private.allowance(p_leave.employee_id,v_year)+coalesce(sum(amount),0) into v_remaining
      from public.leave_ledger where employee_id=p_leave.employee_id and year=v_year;
    if v_new>v_old and v_remaining+v_old<v_new then raise exception 'Saldo cuti tahun % tidak cukup',v_year; end if;
    if v_new>v_old and v_year<extract(year from(now() at time zone 'Asia/Jakarta'))::integer then
      raise exception 'Saldo cuti tahun lampau sudah hangus'; end if;
    if v_new<>v_old then
      insert into public.leave_ledger(employee_id,year,leave_request_id,event_key,amount,actor_employee_id)
        values(p_leave.employee_id,v_year,p_leave.id,p_event_key,v_old-v_new,p_actor);
    end if;
  end loop;
end;
$$;

create or replace function public.attendance_clock_out(p_latitude double precision,p_longitude double precision,p_accuracy_m double precision)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.attendance; v_now timestamptz:=clock_timestamp();
  v_accuracy integer; v_distance double precision;
begin
  perform 1 from public.employees where id=v_actor for no key update;
  select * into v_row from public.attendance where employee_id=v_actor and clock_out is null for update;
  if not found then raise exception 'Tidak ada clock in yang belum selesai'; end if;
  select max_accuracy_m into v_accuracy from public.outlets where id=v_row.outlet_id;
  v_distance:=private.validate_location(p_latitude,p_longitude,p_accuracy_m,v_row.outlet_latitude,v_row.outlet_longitude,v_row.radius_m,v_accuracy);
  update public.attendance set clock_out=v_now,out_latitude=p_latitude,out_longitude=p_longitude,
    out_accuracy_m=p_accuracy_m,out_distance_m=v_distance,worked_minutes=floor(extract(epoch from(v_now-clock_in))/60)::integer
    where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.attendance_correct(p_id uuid,p_clock_in timestamptz,p_clock_out timestamptz,p_reason text,p_shift text default null)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee_id uuid;
  v_before public.attendance; v_row public.attendance; v_shift text; v_expected timestamptz;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Alasan koreksi wajib diisi'; end if;
  select employee_id into strict v_employee_id from public.attendance where id=p_id;
  perform 1 from public.employees where id=v_employee_id for no key update;
  select * into strict v_before from public.attendance where id=p_id for update;
  if v_actor=v_before.employee_id then raise exception 'Catatan absensi sendiri tidak boleh dikoreksi'; end if;
  if p_clock_in is null or p_clock_in>now() or p_clock_out>now() or p_clock_out<p_clock_in then raise exception 'Waktu koreksi tidak valid'; end if;
  if (p_clock_in at time zone 'Asia/Jakarta')::date<>v_before.work_date then raise exception 'Tanggal kerja tidak dapat diubah'; end if;
  v_shift:=coalesce(p_shift,v_before.shift);
  if v_shift not in ('morning','afternoon','middle') then raise exception 'Shift tidak valid'; end if;
  if exists(select 1 from public.attendance a where a.employee_id=v_before.employee_id and a.id<>p_id
    and tstzrange(a.clock_in,a.clock_out,'[)') && tstzrange(p_clock_in,p_clock_out,'[)')) then
    raise exception 'Waktu absensi bertabrakan dengan catatan yang sudah ada'; end if;
  v_expected:=case v_shift when 'morning' then (v_before.work_date+v_before.morning_starts_at) at time zone 'Asia/Jakarta'
    when 'afternoon' then (v_before.work_date+v_before.afternoon_starts_at) at time zone 'Asia/Jakarta' else null end;
  update public.attendance set clock_in=p_clock_in,clock_out=p_clock_out,corrected=true,shift=v_shift,
    expected_in=v_expected,expected_out=coalesce(v_expected,p_clock_in)+interval '8 hours',
    worked_minutes=case when p_clock_out is null then null else floor(extract(epoch from(p_clock_out-p_clock_in))/60)::integer end,
    late_minutes=case when v_expected is null or p_clock_in<=v_expected+make_interval(mins=>tolerance_minutes) then 0
      else ceil(extract(epoch from(p_clock_in-v_expected))/60)::integer end
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('attendance',p_id,v_actor,'corrected',p_reason,to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.hr_save_employee(p_employee jsonb, p_id uuid default null, p_reason text default 'Pembaruan data karyawan')
returns public.employees language plpgsql security definer set search_path='' as $$
declare v_actor uuid := private.require_hr(); v_before public.employees; v_row public.employees;
  v_candidate public.employees;
begin
  if p_employee ?| array['auth_user_id','employee_number','id','account_status','created_at','updated_at'] then
    raise exception 'Identitas akun dan nomor karyawan dikelola sistem';
  end if;
  if p_id is null then
    insert into public.employees(full_name,whatsapp,department_id,position_id,outlet_id,approver_employee_id,
      approval_mode,starts_on,can_clock,can_middle_shift,weekly_off_days)
    values(p_employee->>'full_name',p_employee->>'whatsapp',(p_employee->>'department_id')::uuid,
      (p_employee->>'position_id')::uuid,(p_employee->>'outlet_id')::uuid,
      (p_employee->>'approver_employee_id')::uuid,coalesce(p_employee->>'approval_mode','internal'),
      (p_employee->>'starts_on')::date,coalesce((p_employee->>'can_clock')::boolean,false),
      coalesce((p_employee->>'can_middle_shift')::boolean,false),
      case when p_employee ? 'weekly_off_days' then array(select jsonb_array_elements_text(p_employee->'weekly_off_days')::integer) else array[0] end)
    returning * into v_row;
    insert into public.employee_roles(employee_id,role) values(v_row.id,'employee');
  else
    select * into strict v_before from public.employees where id=p_id for no key update;
    if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Alasan perubahan wajib diisi'; end if;
    v_candidate := jsonb_populate_record(v_before,p_employee);
    if v_candidate.status='inactive' then
      if v_candidate.ends_on is null or length(trim(coalesce(v_candidate.exit_reason,'')))<3 then
        raise exception 'Tanggal dan alasan keluar wajib diisi'; end if;
      if exists(select 1 from public.employees where approver_employee_id=p_id and status='active') then
        raise exception 'Tetapkan pengganti atasan anggota tim terlebih dahulu'; end if;
      if p_id=v_actor then raise exception 'Admin tidak dapat menonaktifkan akun sendiri'; end if;
    end if;
    update public.employees set full_name=v_candidate.full_name,whatsapp=v_candidate.whatsapp,
      department_id=v_candidate.department_id,position_id=v_candidate.position_id,outlet_id=v_candidate.outlet_id,
      approver_employee_id=v_candidate.approver_employee_id,approval_mode=v_candidate.approval_mode,
      starts_on=v_candidate.starts_on,status=v_candidate.status,ends_on=v_candidate.ends_on,exit_reason=v_candidate.exit_reason,
      can_clock=v_candidate.can_clock,can_middle_shift=v_candidate.can_middle_shift,weekly_off_days=v_candidate.weekly_off_days,
      birthday=v_candidate.birthday,gender=v_candidate.gender,address=v_candidate.address,
      emergency_name=v_candidate.emergency_name,emergency_phone=v_candidate.emergency_phone,photo_path=v_candidate.photo_path,
      account_status=case when v_candidate.status='inactive' then 'disabled' else account_status end,
      updated_at=now() where id=p_id returning * into v_row;
    if v_row.status='inactive' then
      update public.account_tokens set revoked_at=now() where employee_id=p_id and consumed_at is null;
    end if;
  end if;
  if not exists(select 1 from public.positions where id=v_row.position_id and department_id=v_row.department_id and active)
    or not exists(select 1 from public.departments where id=v_row.department_id and active)
    or not exists(select 1 from public.outlets where id=v_row.outlet_id and active) then
    raise exception 'Departemen, jabatan, atau outlet tidak sesuai atau nonaktif';
  end if;
  if v_row.approver_employee_id is not null and not exists(select 1 from public.employees where id=v_row.approver_employee_id and status='active') then
    raise exception 'Atasan harus merupakan karyawan aktif'; end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
  values('employee',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,p_reason,
    case when p_id is null then null else to_jsonb(v_before) end,to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.hr_set_roles(p_employee_id uuid,p_roles text[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_actor uuid := private.require_hr();
begin
  if not p_roles <@ array['employee','admin_hr','head_baker'] then raise exception 'Hak akses tidak valid'; end if;
  if v_actor=p_employee_id then raise exception 'Hak akses sendiri tidak dapat diubah'; end if;
  perform 1 from public.employees where id=p_employee_id and status='active' for no key update;
  if not found then raise exception 'Karyawan aktif tidak ditemukan'; end if;
  delete from public.employee_roles where employee_id=p_employee_id;
  insert into public.employee_roles(employee_id,role) select p_employee_id, unnest(array_append(p_roles,'employee')) on conflict do nothing;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,after_data)
    values('employee',p_employee_id,v_actor,'roles_updated',jsonb_build_object('roles',p_roles));
end;
$$;

create or replace function public.issue_account_token(p_employee_id uuid,p_purpose text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_token public.account_tokens;
begin
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for no key update;
  if p_purpose='activation' and v_employee.auth_user_id is not null then raise exception 'Akun sudah diaktifkan'; end if;
  if p_purpose='reset' and v_employee.auth_user_id is null then raise exception 'Akun belum diaktifkan'; end if;
  if exists(select 1 from public.account_tokens where employee_id=p_employee_id
    and claimed_at>now()-interval '5 minutes' and expires_at>now()
    and consumed_at is null and revoked_at is null) then
    raise exception 'Aktivasi sedang diproses. Coba kembali sebentar lagi'; end if;
  update public.account_tokens set revoked_at=now() where employee_id=p_employee_id and consumed_at is null and revoked_at is null;
  insert into public.account_tokens(employee_id,purpose,token_hash,created_by)
    values(p_employee_id,p_purpose,p_token_hash,v_actor) returning * into v_token;
  if p_purpose='activation' then update public.employees set account_status='pending' where id=p_employee_id; end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action)
    values('employee',p_employee_id,v_actor,p_purpose||'_issued');
  return jsonb_build_object('id',v_token.id,'employee_id',p_employee_id,'employee_number',v_employee.employee_number,
    'full_name',v_employee.full_name,'expires_at',v_token.expires_at);
end;
$$;

create or replace function public.claim_account_token(p_token_hash text,p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_token public.account_tokens; v_employee public.employees; v_auth_id uuid;
begin
  perform private.require_service();
  select * into v_token from public.account_tokens where token_hash=p_token_hash;
  if not found then raise exception 'Tautan tidak berlaku atau sudah digunakan'; end if;
  select * into strict v_employee from public.employees where id=v_token.employee_id and status='active' for no key update;
  select * into strict v_token from public.account_tokens where id=v_token.id for update;
  if v_token.expires_at<=now() or v_token.revoked_at is not null or v_token.consumed_at is not null
    or (v_token.claimed_at is not null and v_token.claimed_at>now()-interval '5 minutes') then
    raise exception 'Tautan tidak berlaku, sedang diproses, atau sudah digunakan'; end if;
  select id into v_auth_id from auth.users where lower(email)=lower(v_employee.employee_number)||'@login.rajaklana.internal';
  update public.account_tokens set claimed_at=now(),claim_id=p_claim_id where id=v_token.id;
  return jsonb_build_object('token_id',v_token.id,'purpose',v_token.purpose,'employee_id',v_employee.id,
    'employee_number',v_employee.employee_number,'full_name',v_employee.full_name,
    'auth_user_id',coalesce(v_employee.auth_user_id,v_auth_id));
end;
$$;
