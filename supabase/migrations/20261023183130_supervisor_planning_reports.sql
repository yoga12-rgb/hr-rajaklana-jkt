-- Explicit interval planning and traceable supervisor summaries. Existing
-- shift minima remain intact: they are never silently converted to intervals.

create table public.staffing_interval_requirements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  weekday smallint not null check(weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  minimum integer not null check(minimum between 0 and 100),
  effective_from date not null check(isfinite(effective_from)),
  effective_until date check(effective_until is null or (isfinite(effective_until) and effective_until>=effective_from)),
  revision bigint not null default 1 check(revision>0),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at)
);
create index staffing_interval_requirements_effective_idx
  on public.staffing_interval_requirements(outlet_id,weekday,effective_from,effective_until,starts_at,ends_at);

create table private.supervisor_planning_receipts (
  id uuid primary key default gen_random_uuid(),actor_employee_id uuid not null references public.employees(id),
  idempotency_key uuid not null,request_hash text not null check(length(request_hash)=32),result jsonb,
  created_at timestamptz not null default now(),unique(actor_employee_id,idempotency_key)
);
alter table public.staffing_interval_requirements enable row level security;
alter table private.supervisor_planning_receipts enable row level security;
revoke all on public.staffing_interval_requirements from public,anon;
create policy staffing_interval_requirements_read on public.staffing_interval_requirements for select to authenticated using(
  private.has_role('admin_hr') or private.has_supervisor_capability('summary_view',outlet_id,null)
);
grant select on public.staffing_interval_requirements to authenticated;
revoke all on private.supervisor_planning_receipts from public,anon,authenticated,service_role;

alter table public.cashier_assignments
  add column planned_starts_at time,
  add column planned_ends_at time,
  add column planned_ends_next_day boolean not null default false,
  add column planned_source text not null default 'unknown' check(planned_source in ('unknown','outlet_snapshot','manual_middle'));

create function private.set_cashier_assignment_planned_interval()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_start time;v_end time;
begin
  if new.status<>'active' or new.shift='off' then
    new.planned_starts_at:=null;new.planned_ends_at:=null;new.planned_ends_next_day:=false;new.planned_source:='unknown';
    return new;
  end if;
  if new.shift in ('morning','afternoon') then
    select case when new.shift='morning' then morning_starts_at else afternoon_starts_at end into strict v_start from public.outlets where id=new.outlet_id;
    v_end:=(v_start+interval '8 hours')::time;
    new.planned_starts_at:=v_start;new.planned_ends_at:=v_end;new.planned_ends_next_day:=v_end<=v_start;new.planned_source:='outlet_snapshot';
  elsif tg_op='INSERT' or old.shift is distinct from 'middle' or old.outlet_id is distinct from new.outlet_id then
    new.planned_starts_at:=null;new.planned_ends_at:=null;new.planned_ends_next_day:=false;new.planned_source:='unknown';
  end if;
  return new;
end;
$$;
revoke all on function private.set_cashier_assignment_planned_interval() from public,anon,authenticated;
create trigger cashier_assignment_planned_interval_before_write
  before insert or update of outlet_id,shift,status on public.cashier_assignments
  for each row execute function private.set_cashier_assignment_planned_interval();

create function public.staffing_interval_requirement_save_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_outlet_id uuid,p_weekday integer,p_starts_at time,p_ends_at time,
  p_minimum integer,p_effective_from date,p_effective_until date,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_supervisor_capability('coverage_configure',p_outlet_id,null);v_before public.staffing_interval_requirements;
  v_row public.staffing_interval_requirements;v_receipt private.supervisor_planning_receipts;v_hash text;v_reason text:=trim(coalesce(p_reason,''));
begin
  if p_idempotency_key is null then raise exception 'Kunci kebutuhan interval wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'outlet_id',p_outlet_id,'weekday',p_weekday,
    'starts_at',p_starts_at,'ends_at',p_ends_at,'minimum',p_minimum,'effective_from',p_effective_from,'effective_until',p_effective_until,'reason',v_reason)::text);
  insert into private.supervisor_planning_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.supervisor_planning_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci kebutuhan interval sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan kebutuhan interval sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if not exists(select 1 from public.outlets where id=p_outlet_id and active) or p_weekday not between 0 and 6 or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at
    or p_minimum not between 0 and 100 or p_effective_from is null or (p_effective_until is not null and p_effective_until<p_effective_from) then
    raise exception 'Kebutuhan interval tidak valid';
  end if;
  if p_id is not null then
    select * into strict v_before from public.staffing_interval_requirements where id=p_id for update;
    if v_before.revision<>p_expected_revision then raise exception 'Kebutuhan interval berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001'; end if;
    if length(v_reason)<5 then raise exception 'Alasan perubahan kebutuhan interval minimal 5 karakter'; end if;
  end if;
  if exists(select 1 from public.staffing_interval_requirements r where r.id is distinct from p_id and r.outlet_id=p_outlet_id and r.weekday=p_weekday
    and r.starts_at<p_ends_at and r.ends_at>p_starts_at
    and r.effective_from<=coalesce(p_effective_until,'infinity'::date) and coalesce(r.effective_until,'infinity'::date)>=p_effective_from) then
    raise exception 'Kebutuhan interval aktif tidak boleh saling tumpang tindih';
  end if;
  if p_id is null then
    insert into public.staffing_interval_requirements(outlet_id,weekday,starts_at,ends_at,minimum,effective_from,effective_until,created_by)
      values(p_outlet_id,p_weekday,p_starts_at,p_ends_at,p_minimum,p_effective_from,p_effective_until,v_actor) returning * into v_row;
  else
    update public.staffing_interval_requirements set outlet_id=p_outlet_id,weekday=p_weekday,starts_at=p_starts_at,ends_at=p_ends_at,minimum=p_minimum,
      effective_from=p_effective_from,effective_until=p_effective_until,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('staffing_interval_requirement',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,
      coalesce(nullif(v_reason,''),'Kebutuhan interval disimpan'),to_jsonb(v_before),to_jsonb(v_row));
  update private.supervisor_planning_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.cashier_assignment_plan_save_v2(
  p_assignment_id uuid,p_expected_updated_at timestamptz,p_idempotency_key uuid,p_starts_at time,p_ends_at time,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.cashier_assignments;v_row public.cashier_assignments;v_receipt private.supervisor_planning_receipts;v_hash text;v_seconds integer;
begin
  if p_idempotency_key is null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Kunci dan alasan jam rencana minimal 5 karakter wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('assignment_id',p_assignment_id,'expected_updated_at',p_expected_updated_at,'starts_at',p_starts_at,'ends_at',p_ends_at,'reason',trim(p_reason))::text);
  insert into private.supervisor_planning_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.supervisor_planning_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci jam rencana sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan jam rencana sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_before from public.cashier_assignments where id=p_assignment_id for update;
  if v_before.updated_at is distinct from p_expected_updated_at then raise exception 'Jadwal berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001'; end if;
  if v_before.status<>'active' or v_before.shift<>'middle' then raise exception 'Jam rencana manual hanya untuk penugasan Middle aktif'; end if;
  if exists(select 1 from public.attendance where assignment_id=v_before.id) then raise exception 'Jam rencana sumber absensi tidak dapat diubah; gunakan jalur koreksi'; end if;
  if p_starts_at is null or p_ends_at is null then raise exception 'Jam mulai dan selesai Middle wajib diisi'; end if;
  v_seconds:=extract(epoch from (p_ends_at-p_starts_at));
  if v_seconds<=0 then v_seconds:=v_seconds+86400; end if;
  if v_seconds<>28800 then raise exception 'Jam rencana Middle harus 8 jam termasuk istirahat'; end if;
  update public.cashier_assignments set planned_starts_at=p_starts_at,planned_ends_at=p_ends_at,planned_ends_next_day=p_ends_at<=p_starts_at,
    planned_source='manual_middle',reason=trim(p_reason),updated_at=clock_timestamp() where id=p_assignment_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('assignment',v_row.id,v_actor,'middle_planned_interval_saved',trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  update private.supervisor_planning_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.supervisor_interval_coverage(p_outlet_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_people boolean:=private.has_role('admin_hr');v_result jsonb;
begin
  if v_actor is null or not (v_people or private.has_supervisor_capability('summary_view',p_outlet_id,null,v_actor)) then
    raise exception 'Anda tidak memiliki akses cakupan outlet ini' using errcode='42501';
  end if;
  if p_work_date is null or not isfinite(p_work_date) or not exists(select 1 from public.outlets where id=p_outlet_id) then raise exception 'Outlet atau tanggal cakupan tidak valid'; end if;
  with needs as (
    select r.id,r.minimum,r.starts_at,r.ends_at,(p_work_date::timestamp+r.starts_at) as starts_ts,(p_work_date::timestamp+r.ends_at) as ends_ts
    from public.staffing_interval_requirements r
    where r.outlet_id=p_outlet_id and r.weekday=extract(dow from p_work_date)::int and r.effective_from<=p_work_date
      and coalesce(r.effective_until,'infinity'::date)>=p_work_date
  ), assignments as (
    select a.id,a.employee_id,a.shift,(p_work_date::timestamp+a.planned_starts_at) as starts_ts,
      ((p_work_date+case when a.planned_ends_next_day then 1 else 0 end)::timestamp+a.planned_ends_at) as ends_ts
    from public.cashier_assignments a
    where a.outlet_id=p_outlet_id and a.work_date=p_work_date and a.status='active' and a.shift<>'off'
      and a.planned_starts_at is not null and a.planned_ends_at is not null
  ), unknown_middle as (
    select a.employee_id from public.cashier_assignments a where a.outlet_id=p_outlet_id and a.work_date=p_work_date
      and a.status='active' and a.shift='middle' and (a.planned_starts_at is null or a.planned_ends_at is null)
  ), leave_windows as (
    select l.employee_id,
      case when coalesce(l.extent,'full_day') in ('full_day','late_arrival') then p_work_date::timestamp
        else p_work_date::timestamp+coalesce(l.starts_at,'00:00'::time) end as starts_ts,
      case when coalesce(l.extent,'full_day') in ('full_day','early_departure') then (p_work_date+1)::timestamp
        when coalesce(l.extent,'full_day')='late_arrival' then p_work_date::timestamp+coalesce(l.ends_at,'23:59:59'::time)
        else p_work_date::timestamp+coalesce(l.ends_at,l.starts_at,'00:00'::time) end as ends_ts
    from public.leave_requests l
    where l.status='approved' and l.starts_on<=p_work_date and l.ends_on>=p_work_date
  ), endpoints as (
    select n.id,n.starts_ts as endpoint from needs n union select n.id,n.ends_ts from needs n
    union select n.id,greatest(n.starts_ts,a.starts_ts) from needs n join assignments a on a.starts_ts<n.ends_ts and a.ends_ts>n.starts_ts
    union select n.id,least(n.ends_ts,a.ends_ts) from needs n join assignments a on a.starts_ts<n.ends_ts and a.ends_ts>n.starts_ts
    union select n.id,greatest(n.starts_ts,l.starts_ts) from needs n join leave_windows l on l.starts_ts<n.ends_ts and l.ends_ts>n.starts_ts
    union select n.id,least(n.ends_ts,l.ends_ts) from needs n join leave_windows l on l.starts_ts<n.ends_ts and l.ends_ts>n.starts_ts
  ), segments as (
    select n.id as need_id,n.minimum,e.endpoint as starts_ts,lead(e.endpoint) over(partition by n.id order by e.endpoint) as ends_ts
    from needs n join endpoints e on e.id=n.id
  ), evaluated as (
    select s.*,coalesce((select array_agg(distinct a.employee_id order by a.employee_id) from assignments a
      where a.starts_ts<s.ends_ts and a.ends_ts>s.starts_ts
        and not exists(select 1 from leave_windows l where l.employee_id=a.employee_id and l.starts_ts<s.ends_ts and l.ends_ts>s.starts_ts)),array[]::uuid[]) as available_ids,
      coalesce((select array_agg(distinct a.employee_id order by a.employee_id) from assignments a where a.starts_ts<s.ends_ts and a.ends_ts>s.starts_ts),array[]::uuid[]) as planned_ids,
      coalesce((select array_agg(distinct a.employee_id order by a.employee_id) from assignments a join public.attendance t on t.employee_id=a.employee_id and t.work_date=p_work_date
        where a.starts_ts<s.ends_ts and a.ends_ts>s.starts_ts and t.clock_in < (s.ends_ts at time zone 'Asia/Jakarta') and (t.clock_out is null or t.clock_out>(s.starts_ts at time zone 'Asia/Jakarta'))),array[]::uuid[]) as attendance_ids
    from segments s where s.ends_ts is not null and s.ends_ts>s.starts_ts
  ), coverage as (
    select jsonb_agg(jsonb_build_object('requirement_id',need_id,'starts_at',starts_ts at time zone 'Asia/Jakarta','ends_at',ends_ts at time zone 'Asia/Jakarta',
      'minimum',minimum,'planned_count',cardinality(planned_ids),'available_count',cardinality(available_ids),'attendance_recorded_count',cardinality(attendance_ids),
      'shortage',greatest(minimum-cardinality(available_ids),0),'employee_ids',case when v_people then to_jsonb(available_ids) else '[]'::jsonb end) order by starts_ts) as rows from evaluated
  ) select jsonb_build_object('outlet_id',p_outlet_id,'work_date',p_work_date,'as_of',statement_timestamp(),
      'configured',(select count(*)>0 from needs),'coverage',coalesce((select rows from coverage),'[]'::jsonb),
      'unknown_middle_count',(select count(*) from unknown_middle),'unknown_middle_employee_ids',case when v_people then coalesce((select jsonb_agg(employee_id order by employee_id) from unknown_middle),'[]'::jsonb) else '[]'::jsonb end,
      'legacy_shift_requirements',coalesce((select jsonb_agg(jsonb_build_object('shift',shift,'minimum',minimum) order by shift) from public.staffing_requirements r
        where r.outlet_id=p_outlet_id and r.weekday=extract(dow from p_work_date)::int and r.effective_from<=p_work_date
          and r.effective_from=(select max(r2.effective_from) from public.staffing_requirements r2 where r2.outlet_id=r.outlet_id and r2.weekday=r.weekday and r2.shift=r.shift and r2.effective_from<=p_work_date)),'[]'::jsonb)
    ) into v_result;
  return v_result;
end;
$$;

create function public.supervisor_report_page(
  p_from date,p_to date,p_outlet_id uuid default null,p_employee_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_people boolean:=private.has_role('admin_hr');v_result jsonb;
begin
  if v_actor is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>62 then
    raise exception 'Rentang laporan tidak valid; maksimum 63 hari';
  end if;
  if not v_people and p_employee_id is not null and p_employee_id<>v_actor then raise exception 'Filter karyawan tidak diizinkan' using errcode='42501'; end if;
  if p_outlet_id is not null and not (v_people or private.has_supervisor_capability('summary_view',p_outlet_id,null,v_actor)) then raise exception 'Akses outlet laporan ditolak' using errcode='42501'; end if;
  with assignments as (
    select a.* from public.cashier_assignments a
    where a.status='active' and a.shift<>'off' and a.work_date between p_from and p_to
      and (p_outlet_id is null or a.outlet_id=p_outlet_id) and (p_employee_id is null or a.employee_id=p_employee_id)
      and (v_people or a.employee_id=v_actor or private.has_supervisor_capability('summary_view',a.outlet_id,null,v_actor))
  ), daily as (
    select a.*,
      exists(select 1 from public.attendance t where t.employee_id=a.employee_id and t.work_date=a.work_date) as attended,
      coalesce((select sum(t.late_minutes) from public.attendance t where t.employee_id=a.employee_id and t.work_date=a.work_date),0)::integer as late_minutes,
      exists(select 1 from public.leave_requests l where l.employee_id=a.employee_id and l.status='approved' and coalesce(l.extent,'full_day')='full_day' and l.starts_on<=a.work_date and l.ends_on>=a.work_date) as full_leave,
      exists(select 1 from public.leave_requests l where l.employee_id=a.employee_id and l.status='approved' and coalesce(l.extent,'full_day')<>'full_day' and l.starts_on<=a.work_date and l.ends_on>=a.work_date) as partial_leave,
      (select count(*) from public.attendance_correction_requests c where c.employee_id=a.employee_id and c.work_date=a.work_date) as corrections
    from assignments a
  ), people as (
    select d.employee_id,
      count(*) filter(where not full_leave) as scheduled_days,
      count(*) filter(where attended and not full_leave) as attendance_days,
      count(*) filter(where full_leave) as approved_full_leave_days,
      count(*) filter(where partial_leave) as approved_partial_leave_days,
      coalesce(sum(late_minutes) filter(where not full_leave),0)::integer as late_minutes,
      coalesce(sum(corrections),0)::integer as corrections
    from daily d group by d.employee_id
  ), details as (
    select jsonb_agg(jsonb_build_object('employee_id',case when v_people then d.employee_id else null end,'work_date',d.work_date,
      'outlet_id',d.outlet_id,'shift',d.shift,'planned_source',d.planned_source,'attendance_recorded',d.attended,
      'full_leave',d.full_leave,'partial_leave',d.partial_leave,'late_minutes',d.late_minutes,'corrections',d.corrections) order by d.work_date,d.employee_id) as rows from daily d
  ), coverage_keys as (
    select distinct d.outlet_id,d.work_date from daily d
  ), coverage_days as (
    select k.outlet_id,k.work_date,public.supervisor_interval_coverage(k.outlet_id,k.work_date) as coverage from coverage_keys k
  ), coverage_summary as (
    select count(*) filter(where not coalesce((coverage->>'configured')::boolean,false)) as unconfigured_days,
      coalesce(sum((select count(*) from jsonb_array_elements(coverage->'coverage') r where (r->>'shortage')::int>0)),0)::integer as shortage_intervals,
      coalesce(sum((coverage->>'unknown_middle_count')::integer),0)::integer as unknown_middle_assignments
    from coverage_days
  ), period_followups as (
    select count(*) filter(where f.status<>'completed') as open_now,
      count(*) filter(where f.status='completed') as completed_now,
      count(*) filter(where f.status<>'completed' and f.due_at<clock_timestamp()) as overdue_now
    from public.spv_followups f where f.work_date between p_from and p_to and (p_outlet_id is null or f.outlet_id=p_outlet_id)
  ) select jsonb_build_object(
    'from',p_from,'to',p_to,'outlet_id',p_outlet_id,'employee_id',case when v_people then p_employee_id else v_actor end,'as_of',statement_timestamp(),
    'basis','Hari kerja terjadwal dalam periode; backlog memakai status saat laporan dihitung.',
    'summary',jsonb_build_object('scheduled_days',coalesce((select sum(scheduled_days) from people),0),'attendance_days',coalesce((select sum(attendance_days) from people),0),
      'approved_full_leave_days',coalesce((select sum(approved_full_leave_days) from people),0),'approved_partial_leave_days',coalesce((select sum(approved_partial_leave_days) from people),0),
      'late_minutes',coalesce((select sum(late_minutes) from people),0),'corrections',coalesce((select sum(corrections) from people),0),
      'coverage_unconfigured_days',coalesce((select unconfigured_days from coverage_summary),0),'coverage_shortage_intervals',coalesce((select shortage_intervals from coverage_summary),0),
      'coverage_unknown_middle_assignments',coalesce((select unknown_middle_assignments from coverage_summary),0),
      'followups_open_now',case when v_people then coalesce((select open_now from period_followups),0) else null end,
      'followups_completed_now',case when v_people then coalesce((select completed_now from period_followups),0) else null end,
      'followups_overdue_now',case when v_people then coalesce((select overdue_now from period_followups),0) else null end),
    'people',case when v_people then coalesce((select jsonb_agg(jsonb_build_object('employee_id',employee_id,'scheduled_days',scheduled_days,'attendance_days',attendance_days,
      'approved_full_leave_days',approved_full_leave_days,'approved_partial_leave_days',approved_partial_leave_days,'late_minutes',late_minutes,'corrections',corrections) order by employee_id) from people),'[]'::jsonb) else '[]'::jsonb end,
    'details',coalesce((select rows from details),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.staffing_interval_requirement_save_v2(uuid,bigint,uuid,uuid,integer,time,time,integer,date,date,text),
  public.cashier_assignment_plan_save_v2(uuid,timestamptz,uuid,time,time,text),public.supervisor_interval_coverage(uuid,date),
  public.supervisor_report_page(date,date,uuid,uuid) from public,anon;
grant execute on function public.staffing_interval_requirement_save_v2(uuid,bigint,uuid,uuid,integer,time,time,integer,date,date,text),
  public.cashier_assignment_plan_save_v2(uuid,timestamptz,uuid,time,time,text),public.supervisor_interval_coverage(uuid,date),
  public.supervisor_report_page(date,date,uuid,uuid) to authenticated;
