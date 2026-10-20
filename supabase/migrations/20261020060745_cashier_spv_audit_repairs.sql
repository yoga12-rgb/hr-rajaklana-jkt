-- Tahap A audit repairs. This is a forward-only correction: prior migrations,
-- case IDs, decisions and audit history remain intact.

create table if not exists private.spv_followup_context_repair_log (
  migration_key text not null,
  followup_id uuid not null references public.spv_followups(id),
  captured_at timestamptz not null default clock_timestamp(),
  before_data jsonb not null,
  after_data jsonb not null,
  primary key (migration_key, followup_id)
);
revoke all on private.spv_followup_context_repair_log from public, anon, authenticated;

create index if not exists spv_followups_active_source_idx
  on public.spv_followups(source_type, source_id)
  where source_id is not null and status <> 'completed';

-- Preserve the old case state alongside the corrected source snapshot. This
-- private migration record is separate from actor-driven operational audits.
with targets as (
  select f.id, to_jsonb(f) as before_data, a.work_date, a.outlet_id, a.employee_id, a.shift
  from public.spv_followups f join public.cashier_assignments a on a.id=f.source_id
  where f.status <> 'completed' and f.source_type='assignment'
    and (f.work_date,f.outlet_id,f.employee_id,f.shift) is distinct from (a.work_date,a.outlet_id,a.employee_id,a.shift)
), changed as (
  update public.spv_followups f set work_date=t.work_date,outlet_id=t.outlet_id,employee_id=t.employee_id,shift=t.shift
  from targets t where f.id=t.id returning f.id,to_jsonb(f) as after_data
)
insert into private.spv_followup_context_repair_log(migration_key,followup_id,before_data,after_data)
select '20261020052932_cashier_spv_audit_repairs',t.id,t.before_data,c.after_data from targets t join changed c on c.id=t.id
on conflict do nothing;

with targets as (
  select f.id, to_jsonb(f) as before_data, a.work_date, a.outlet_id, a.employee_id, a.shift
  from public.spv_followups f join public.attendance a on a.id=f.source_id
  where f.status <> 'completed' and f.source_type='attendance'
    and (f.work_date,f.outlet_id,f.employee_id,f.shift) is distinct from (a.work_date,a.outlet_id,a.employee_id,a.shift)
), changed as (
  update public.spv_followups f set work_date=t.work_date,outlet_id=t.outlet_id,employee_id=t.employee_id,shift=t.shift
  from targets t where f.id=t.id returning f.id,to_jsonb(f) as after_data
)
insert into private.spv_followup_context_repair_log(migration_key,followup_id,before_data,after_data)
select '20261020052932_cashier_spv_audit_repairs',t.id,t.before_data,c.after_data from targets t join changed c on c.id=t.id
on conflict do nothing;

with targets as (
  select f.id, to_jsonb(f) as before_data, c.work_date, c.outlet_id, c.employee_id, c.shift
  from public.spv_followups f join public.attendance_correction_requests c on c.id=f.source_id
  where f.status <> 'completed' and f.source_type='correction'
    and (f.work_date,f.outlet_id,f.employee_id,f.shift) is distinct from (c.work_date,c.outlet_id,c.employee_id,c.shift)
), changed as (
  update public.spv_followups f set work_date=t.work_date,outlet_id=t.outlet_id,employee_id=t.employee_id,shift=t.shift
  from targets t where f.id=t.id returning f.id,to_jsonb(f) as after_data
)
insert into private.spv_followup_context_repair_log(migration_key,followup_id,before_data,after_data)
select '20261020052932_cashier_spv_audit_repairs',t.id,t.before_data,c.after_data from targets t join changed c on c.id=t.id
on conflict do nothing;

with targets as (
  select f.id,to_jsonb(f) as before_data,f.work_date,
    coalesce(a.outlet_id,e.outlet_id) as outlet_id,e.id as employee_id,f.shift
  from public.spv_followups f join public.employees e on e.id=f.employee_id
  left join public.cashier_assignments a on a.employee_id=e.id and a.work_date=f.work_date and a.status='active'
  where f.status <> 'completed' and f.source_type='roster' and f.source_id is null and f.issue_type='unassigned'
    and coalesce(a.outlet_id,e.outlet_id) is not null and f.outlet_id is distinct from coalesce(a.outlet_id,e.outlet_id)
), changed as (
  update public.spv_followups f set outlet_id=t.outlet_id
  from targets t where f.id=t.id returning f.id,to_jsonb(f) as after_data
)
insert into private.spv_followup_context_repair_log(migration_key,followup_id,before_data,after_data)
select '20261020052932_cashier_spv_audit_repairs',t.id,t.before_data,c.after_data from targets t join changed c on c.id=t.id
on conflict do nothing;

-- Match attendanceDurationReview(): measure the remaining part of 480 minutes
-- that is not explained by an approved early-departure or late-arrival permit.
create or replace function private.spv_unexplained_shortfall(p_attendance_id uuid)
returns integer language plpgsql stable set search_path='' as $$
declare
  v_att public.attendance; v_start timestamptz; v_end timestamptz; v_day date; v_actual integer; v_shortfall integer;
  v_leave record; v_boundary timestamptz; v_departure timestamptz; v_early integer:=0; v_late_permitted integer:=0;
  v_unexcused integer; v_permitted integer;
begin
  select * into strict v_att from public.attendance where id=p_attendance_id;
  if v_att.clock_out is null then return 0; end if;
  v_start:=coalesce(v_att.expected_in,v_att.clock_in);
  v_end:=v_start+interval '8 hours';
  v_day:=(v_start at time zone 'Asia/Jakarta')::date;
  v_actual:=greatest(0,coalesce(v_att.worked_minutes,floor(extract(epoch from(v_att.clock_out-v_att.clock_in))/60)::integer));
  v_shortfall:=greatest(0,480-v_actual);
  if v_shortfall=0 then return 0; end if;

  for v_leave in select l.starts_at,l.ends_at from public.leave_requests l
    where l.employee_id=v_att.employee_id and l.status='approved' and l.extent='early_departure'
      and l.starts_on=v_day and l.ends_on=v_day
  loop
    v_departure:=((v_day+coalesce(v_leave.starts_at,v_leave.ends_at)) at time zone 'Asia/Jakarta');
    if v_departure<v_start and (v_end at time zone 'Asia/Jakarta')::date>v_day then v_departure:=v_departure+interval '1 day'; end if;
    if v_departure>=v_start and v_departure<v_end then
      v_early:=greatest(v_early,greatest(0,floor(extract(epoch from(v_end-greatest(v_departure,v_att.clock_out))/60))::integer));
    end if;
  end loop;
  v_early:=least(v_shortfall,v_early);

  if v_att.expected_in is not null and v_att.shift<>'middle' and v_att.late_minutes>0 then
    select max(case
      when boundary< v_start and (v_att.clock_in at time zone 'Asia/Jakarta')::date>v_day then boundary+interval '1 day'
      else boundary end) into v_boundary
    from (select ((v_day+coalesce(l.starts_at,l.ends_at)) at time zone 'Asia/Jakarta') as boundary
      from public.leave_requests l where l.employee_id=v_att.employee_id and l.status='approved'
        and l.extent='late_arrival' and l.starts_on=v_day and l.ends_on=v_day) permitted
    where case when boundary<v_start and (v_att.clock_in at time zone 'Asia/Jakarta')::date>v_day then boundary+interval '1 day' else boundary end>v_start;
    if v_boundary is not null then
      v_unexcused:=least(v_att.late_minutes,greatest(0,ceil(extract(epoch from(v_att.clock_in-v_boundary))/60)::integer));
      v_late_permitted:=greatest(0,v_att.late_minutes-v_unexcused);
    end if;
  end if;

  v_permitted:=v_early+least(greatest(0,v_shortfall-v_early),v_late_permitted);
  return greatest(0,v_shortfall-v_permitted);
end;
$$;
revoke all on function private.spv_unexplained_shortfall(uuid) from public,anon,authenticated;

-- Refresh active case snapshots inside the same source transaction, and retain
-- the actor's before/after evidence in the normal audit stream.
create or replace function private.sync_spv_followup_source_context()
returns trigger language plpgsql set search_path='' as $$
declare
  v_type text; v_id uuid; v_date date; v_outlet uuid; v_employee uuid; v_shift text; v_actor uuid;
begin
  v_actor:=private.employee_id();
  if v_actor is null then raise exception 'Akun karyawan tidak aktif' using errcode='42501'; end if;
  if tg_table_name='cashier_assignments' then
    v_type:='assignment'; v_id:=new.id; v_date:=new.work_date; v_outlet:=new.outlet_id; v_employee:=new.employee_id; v_shift:=new.shift;
  elsif tg_table_name='attendance' then
    v_type:='attendance'; v_id:=new.id; v_date:=new.work_date; v_outlet:=new.outlet_id; v_employee:=new.employee_id; v_shift:=new.shift;
  elsif tg_table_name='attendance_correction_requests' then
    v_type:='correction'; v_id:=new.id; v_date:=new.work_date; v_outlet:=new.outlet_id; v_employee:=new.employee_id; v_shift:=new.shift;
  else
    with targets as (
      select f.id,to_jsonb(f) as before_data from public.spv_followups f
      where f.source_type='roster' and f.issue_type='unassigned' and f.source_id is null
        and f.employee_id=new.id and f.status<>'completed' and f.outlet_id is distinct from new.outlet_id
    ), changed as (
      update public.spv_followups f set outlet_id=new.outlet_id,updated_by=v_actor,updated_at=clock_timestamp()
      where f.id in (select t.id from targets t) returning f.id,to_jsonb(f) as after_data
    )
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    select 'spv_followup',c.id,v_actor,'source_context_refreshed','Outlet utama karyawan diperbarui',t.before_data,c.after_data
    from targets t join changed c on c.id=t.id;
    return new;
  end if;

  with targets as (
    select f.id,to_jsonb(f) as before_data from public.spv_followups f
    where f.source_type=v_type and f.source_id=v_id and f.status<>'completed'
      and (f.work_date,f.outlet_id,f.employee_id,f.shift) is distinct from (v_date,v_outlet,v_employee,v_shift)
  ), changed as (
    update public.spv_followups f set work_date=v_date,outlet_id=v_outlet,employee_id=v_employee,shift=v_shift,
      updated_by=v_actor,updated_at=clock_timestamp()
    where f.id in (select t.id from targets t) returning f.id,to_jsonb(f) as after_data
  )
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
  select 'spv_followup',c.id,v_actor,'source_context_refreshed','Konteks sumber diperbarui bersama perubahan data sumber',t.before_data,c.after_data
  from targets t join changed c on c.id=t.id;
  return new;
end;
$$;
revoke all on function private.sync_spv_followup_source_context() from public,anon,authenticated;

drop trigger if exists cashier_assignment_sync_spv_context on public.cashier_assignments;
create trigger cashier_assignment_sync_spv_context after update of employee_id,work_date,outlet_id,shift,status on public.cashier_assignments
  for each row execute function private.sync_spv_followup_source_context();
drop trigger if exists attendance_sync_spv_context on public.attendance;
create trigger attendance_sync_spv_context after update of employee_id,work_date,outlet_id,shift on public.attendance
  for each row execute function private.sync_spv_followup_source_context();
drop trigger if exists correction_sync_spv_context on public.attendance_correction_requests;
create trigger correction_sync_spv_context after update of employee_id,work_date,outlet_id,shift,status on public.attendance_correction_requests
  for each row execute function private.sync_spv_followup_source_context();
drop trigger if exists employee_sync_spv_context on public.employees;
create trigger employee_sync_spv_context after update of outlet_id on public.employees
  for each row when (old.outlet_id is distinct from new.outlet_id)
  execute function private.sync_spv_followup_source_context();

create or replace function public.spv_followup_start(p_issue_type text,p_work_date date,p_outlet_id uuid,p_employee_id uuid,
  p_shift text,p_source_type text,p_source_id uuid)
returns public.spv_followups language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_hr(); v_row public.spv_followups; v_before public.spv_followups; v_case_key text;
  v_assignment public.cashier_assignments; v_attendance public.attendance; v_correction public.attendance_correction_requests;
  v_employee public.employees; v_outlet public.outlets; v_day date:=(now() at time zone 'Asia/Jakarta')::date;
  v_due timestamptz; v_arrival time;
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
      if v_attendance.clock_out is null or private.spv_unexplained_shortfall(v_attendance.id)<=0 then
        raise exception 'Selisih durasi sudah dijelaskan izin yang disetujui';
      end if;
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
      update public.spv_followups set status='new',owner_id=null,resolution_note='',work_date=p_work_date,outlet_id=p_outlet_id,
        employee_id=p_employee_id,shift=p_shift,updated_by=v_actor,updated_at=clock_timestamp(),reopened_count=reopened_count+1
        where id=v_row.id returning * into v_row;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('spv_followup',v_row.id,v_actor,'reopened','Kondisi sumber muncul kembali',to_jsonb(v_before),to_jsonb(v_row));
    elsif (v_row.work_date,v_row.outlet_id,v_row.employee_id,v_row.shift) is distinct from (p_work_date,p_outlet_id,p_employee_id,p_shift) then
      v_before:=v_row;
      update public.spv_followups set work_date=p_work_date,outlet_id=p_outlet_id,employee_id=p_employee_id,shift=p_shift,
        updated_by=v_actor,updated_at=clock_timestamp() where id=v_row.id returning * into v_row;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('spv_followup',v_row.id,v_actor,'source_context_refreshed','Konteks sumber divalidasi saat tindak lanjut dibuka',to_jsonb(v_before),to_jsonb(v_row));
    end if;
    return v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('spv_followup',v_row.id,v_actor,'started','Tindak lanjut dimulai',to_jsonb(v_row));
  return v_row;
end;
$$;
