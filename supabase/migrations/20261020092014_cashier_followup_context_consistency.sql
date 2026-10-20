-- Align current follow-up source context with active cashier assignments.
-- This is a forward-only correction; case identity and operational history stay intact.

alter table public.spv_followups drop constraint if exists spv_followups_shift_check;
alter table public.spv_followups add constraint spv_followups_shift_check
  check (shift is null or shift in ('morning','afternoon','middle','off'));

-- Unassigned cases are keyed by employee/date, so moving the employee's
-- assignment changes their outlet context without creating a second case.
create or replace function private.sync_roster_followup_context(
  p_employee_id uuid, p_work_date date, p_actor uuid, p_reason text
) returns void language plpgsql set search_path='' as $$
begin
  if p_actor is null and exists (
    select 1
    from public.spv_followups f
    join public.employees e on e.id=f.employee_id
    left join public.cashier_assignments a on a.employee_id=e.id and a.work_date=f.work_date and a.status='active'
    where f.source_type='roster' and f.issue_type='unassigned' and f.source_id is null
      and f.employee_id=p_employee_id and (p_work_date is null or f.work_date=p_work_date)
      and f.status<>'completed' and coalesce(a.outlet_id,e.outlet_id) is not null
      and f.outlet_id is distinct from coalesce(a.outlet_id,e.outlet_id)
  ) then
    raise exception 'Akun karyawan tidak aktif' using errcode='42501';
  end if;

  with targets as (
    select f.id,to_jsonb(f) as before_data,coalesce(a.outlet_id,e.outlet_id) as outlet_id
    from public.spv_followups f
    join public.employees e on e.id=f.employee_id
    left join public.cashier_assignments a on a.employee_id=e.id and a.work_date=f.work_date and a.status='active'
    where f.source_type='roster' and f.issue_type='unassigned' and f.source_id is null
      and f.employee_id=p_employee_id and (p_work_date is null or f.work_date=p_work_date)
      and f.status<>'completed' and coalesce(a.outlet_id,e.outlet_id) is not null
      and f.outlet_id is distinct from coalesce(a.outlet_id,e.outlet_id)
  ), changed as (
    update public.spv_followups f set outlet_id=t.outlet_id,updated_by=p_actor,updated_at=clock_timestamp()
    from targets t where f.id=t.id returning f.id,to_jsonb(f) as after_data
  )
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
  select 'spv_followup',c.id,p_actor,'source_context_refreshed',p_reason,t.before_data,c.after_data
  from targets t join changed c on c.id=t.id;
end;
$$;
revoke all on function private.sync_roster_followup_context(uuid,date,uuid,text) from public,anon,authenticated;

-- Repair the same mismatch left by the earlier employee-outlet-only trigger.
-- The private migration log records data correction without inventing an actor.
with targets as (
  select f.id,to_jsonb(f) as before_data,coalesce(a.outlet_id,e.outlet_id) as outlet_id
  from public.spv_followups f
  join public.employees e on e.id=f.employee_id
  left join public.cashier_assignments a on a.employee_id=e.id and a.work_date=f.work_date and a.status='active'
  where f.source_type='roster' and f.issue_type='unassigned' and f.source_id is null
    and f.status<>'completed' and coalesce(a.outlet_id,e.outlet_id) is not null
    and f.outlet_id is distinct from coalesce(a.outlet_id,e.outlet_id)
), changed as (
  update public.spv_followups f set outlet_id=t.outlet_id
  from targets t where f.id=t.id returning f.id,to_jsonb(f) as after_data
)
insert into private.spv_followup_context_repair_log(migration_key,followup_id,before_data,after_data)
select '20261020081916_cashier_followup_context_consistency',t.id,t.before_data,c.after_data
from targets t join changed c on c.id=t.id
on conflict (migration_key,followup_id) do nothing;

create or replace function private.sync_spv_followup_source_context()
returns trigger language plpgsql set search_path='' as $$
declare
  v_type text; v_id uuid; v_date date; v_outlet uuid; v_employee uuid; v_shift text; v_actor uuid; v_roster_date date;
begin
  v_actor:=private.employee_id();
  if tg_table_name='cashier_assignments' then
    v_type:='assignment'; v_id:=new.id; v_date:=new.work_date; v_outlet:=new.outlet_id; v_employee:=new.employee_id; v_shift:=new.shift;
  elsif tg_table_name='attendance' then
    v_type:='attendance'; v_id:=new.id; v_date:=new.work_date; v_outlet:=new.outlet_id; v_employee:=new.employee_id; v_shift:=new.shift;
  elsif tg_table_name='attendance_correction_requests' then
    v_type:='correction'; v_id:=new.id; v_date:=new.work_date; v_outlet:=new.outlet_id; v_employee:=new.employee_id; v_shift:=new.shift;
  else
    for v_roster_date in
      select distinct f.work_date from public.spv_followups f
      where f.source_type='roster' and f.issue_type='unassigned' and f.source_id is null
        and f.employee_id=new.id and f.status<>'completed'
    loop
      perform private.sync_roster_followup_context(new.id,v_roster_date,v_actor,'Outlet karyawan diperbarui; penugasan aktif tetap menjadi sumber outlet');
    end loop;
    return new;
  end if;

  if v_actor is null and exists (
    select 1 from public.spv_followups f
    where f.source_type=v_type and f.source_id=v_id and f.status<>'completed'
      and (f.work_date,f.outlet_id,f.employee_id,f.shift) is distinct from (v_date,v_outlet,v_employee,v_shift)
  ) then
    raise exception 'Akun karyawan tidak aktif' using errcode='42501';
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

  if tg_table_name='cashier_assignments' then
    if tg_op='UPDATE' and (old.employee_id,old.work_date) is distinct from (new.employee_id,new.work_date) then
      perform private.sync_roster_followup_context(old.employee_id,old.work_date,v_actor,'Penugasan dipindahkan; outlet konteks kasus dihitung ulang');
    end if;
    perform private.sync_roster_followup_context(new.employee_id,new.work_date,v_actor,
      case when new.status='active' then 'Penugasan aktif mengubah outlet konteks kasus' else 'Penugasan dibatalkan; outlet utama menjadi fallback konteks' end);
  end if;
  return new;
end;
$$;
revoke all on function private.sync_spv_followup_source_context() from public,anon,authenticated;

drop trigger if exists cashier_assignment_sync_spv_context on public.cashier_assignments;
create trigger cashier_assignment_sync_spv_context after insert or update on public.cashier_assignments
  for each row execute function private.sync_spv_followup_source_context();
drop trigger if exists employee_sync_spv_context on public.employees;
create trigger employee_sync_spv_context after update of outlet_id on public.employees
  for each row when (old.outlet_id is distinct from new.outlet_id)
  execute function private.sync_spv_followup_source_context();
