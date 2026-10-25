-- Hardening follow-up for the additive supervisor modules.  This migration is
-- intentionally forward-only: Preview 18 receives 19–22, while the historical
-- 13-migration fixture still needs its own preflight before migration 14.

-- Realtime subscriptions in the application already listen to these tables.
-- Add them to the only Supabase publication once, without changing any older
-- publication membership.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'outlet_issues', 'shift_handovers', 'shift_exchange_requests', 'staffing_interval_requirements'
  ] loop
    if not exists(
      select 1
      from pg_catalog.pg_publication p
      join pg_catalog.pg_publication_rel pr on pr.prpubid=p.oid
      join pg_catalog.pg_class c on c.oid=pr.prrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where p.pubname='supabase_realtime' and n.nspname='public' and c.relname=v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I',v_table);
    end if;
  end loop;
end;
$$;

-- A coverage configurator must be able to read the scoped configuration and
-- resulting coverage they are allowed to maintain.  Employee identities remain
-- redacted by the coverage/report RPC unless the caller is Admin HR.
drop policy if exists staffing_interval_requirements_read on public.staffing_interval_requirements;
create policy staffing_interval_requirements_read on public.staffing_interval_requirements for select to authenticated using(
  private.has_role('admin_hr')
  or private.has_supervisor_capability('summary_view',outlet_id,null)
  or private.has_supervisor_capability('coverage_configure',outlet_id,null)
);

-- Do not route a new issue to an account whose handling capability was revoked
-- after a route was configured.  Existing historical owners are deliberately
-- retained; they are visible for reassignment rather than erased.
create or replace function private.validate_outlet_issue_owner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.owner_id is null or (tg_op='UPDATE' and new.owner_id is not distinct from old.owner_id) then
    return new;
  end if;
  if not private.active_employee(new.owner_id) or not (
    exists(select 1 from public.employee_roles r where r.employee_id=new.owner_id and r.role='admin_hr')
    or exists(
      select 1 from public.supervisor_capabilities c
      join public.employees e on e.id=c.employee_id
      where c.employee_id=new.owner_id and c.capability='issue_handle'
        and e.status='active' and e.account_status='active'
        and (c.outlet_id is null or c.outlet_id=new.outlet_id)
        and (c.category_id is null or c.category_id=new.category_id)
    )
  ) then
    if tg_op='INSERT' then
      new.owner_id:=null;
      new.status:='new';
      return new;
    end if;
    raise exception 'Penanggung jawab harus petugas aktif dalam scope kendala';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_outlet_issue_owner() from public,anon,authenticated;
drop trigger if exists outlet_issue_owner_scope_before_write on public.outlet_issues;
create trigger outlet_issue_owner_scope_before_write
  before insert or update of owner_id,outlet_id,category_id on public.outlet_issues
  for each row execute function private.validate_outlet_issue_owner();

-- Interval requirements must lock and authorize the existing row before a
-- scoped user can move it.  The two deterministic advisory keys serialize
-- overlap checks across both the old and requested scope.
create or replace function public.staffing_interval_requirement_save_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_outlet_id uuid,p_weekday integer,p_starts_at time,p_ends_at time,
  p_minimum integer,p_effective_from date,p_effective_until date,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.employee_id();v_before public.staffing_interval_requirements;
  v_row public.staffing_interval_requirements;v_receipt private.supervisor_planning_receipts;v_hash text;v_reason text:=trim(coalesce(p_reason,''));
  v_today date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date;v_lock_one integer;v_lock_two integer;
begin
  if v_actor is null or p_idempotency_key is null then raise exception 'Akun aktif dan kunci kebutuhan interval wajib diisi' using errcode='42501'; end if;
  if p_weekday not between 0 and 6 or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at
    or p_minimum not between 0 and 100 or p_effective_from is null or (p_effective_until is not null and p_effective_until<p_effective_from)
    or not exists(select 1 from public.outlets where id=p_outlet_id and active) then
    raise exception 'Kebutuhan interval tidak valid';
  end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'outlet_id',p_outlet_id,'weekday',p_weekday,
    'starts_at',p_starts_at,'ends_at',p_ends_at,'minimum',p_minimum,'effective_from',p_effective_from,'effective_until',p_effective_until,'reason',v_reason)::text);
  if p_id is not null then
    select * into strict v_before from public.staffing_interval_requirements where id=p_id for update;
    -- Authorize both the current and requested scope before honoring a stored
    -- result. A lost response remains replayable after later edits, but a
    -- caller whose access was revoked cannot use a receipt as an auth bypass.
    if not private.has_role('admin_hr') and not private.has_supervisor_capability('coverage_configure',v_before.outlet_id,null,v_actor) then
      raise exception 'Anda tidak memiliki akses konfigurasi pada outlet kebutuhan sebelumnya' using errcode='42501';
    end if;
    if not private.has_role('admin_hr') and not private.has_supervisor_capability('coverage_configure',p_outlet_id,null,v_actor) then
      raise exception 'Anda tidak memiliki akses konfigurasi pada outlet kebutuhan tujuan' using errcode='42501';
    end if;
  else
    if not private.has_role('admin_hr') and not private.has_supervisor_capability('coverage_configure',p_outlet_id,null,v_actor) then
      raise exception 'Anda tidak memiliki akses konfigurasi pada outlet ini' using errcode='42501';
    end if;
  end if;
  insert into private.supervisor_planning_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.supervisor_planning_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci kebutuhan interval sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan kebutuhan interval sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if p_id is not null then
    if p_expected_revision is null or v_before.revision is distinct from p_expected_revision then
      raise exception 'Kebutuhan interval berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001';
    end if;
    if v_before.effective_from < v_today and (
      v_before.outlet_id is distinct from p_outlet_id or v_before.weekday is distinct from p_weekday
      or v_before.starts_at is distinct from p_starts_at or v_before.ends_at is distinct from p_ends_at
      or v_before.minimum is distinct from p_minimum or v_before.effective_from is distinct from p_effective_from
      or v_before.effective_until is distinct from p_effective_until
    ) then
      raise exception 'Kebutuhan interval yang sudah berlaku tidak dapat ditulis ulang; buat interval baru untuk tanggal mendatang';
    end if;
    if length(v_reason)<5 then raise exception 'Alasan perubahan kebutuhan interval minimal 5 karakter'; end if;
  else
    if p_expected_revision is not null then raise exception 'Kebutuhan interval baru tidak memakai revisi lama'; end if;
    if p_effective_from < v_today then raise exception 'Kebutuhan interval baru tidak boleh berlaku surut'; end if;
  end if;
  v_lock_one:=hashtext(format('staffing-interval:%s:%s',p_outlet_id,p_weekday));
  v_lock_two:=case when p_id is null then v_lock_one else hashtext(format('staffing-interval:%s:%s',v_before.outlet_id,v_before.weekday)) end;
  if v_lock_one<=v_lock_two then
    perform pg_advisory_xact_lock(v_lock_one); if v_lock_two<>v_lock_one then perform pg_advisory_xact_lock(v_lock_two); end if;
  else
    perform pg_advisory_xact_lock(v_lock_two); perform pg_advisory_xact_lock(v_lock_one);
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

-- A legacy attendance row may lack assignment_id.  It must still freeze a
-- Middle interval, otherwise historical attendance can be silently rewritten.
create or replace function public.cashier_assignment_plan_save_v2(
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
  if not exists(select 1 from public.employees e where e.id=v_before.employee_id and e.status='active' and e.account_status='active' and e.can_middle_shift) then
    raise exception 'Karyawan belum memiliki izin Shift Middle';
  end if;
  if exists(select 1 from public.attendance a where a.assignment_id=v_before.id or (a.assignment_id is null and a.employee_id=v_before.employee_id and a.work_date=v_before.work_date)) then
    raise exception 'Jam rencana sumber absensi tidak dapat diubah; gunakan jalur koreksi';
  end if;
  if p_starts_at is null or p_ends_at is null then raise exception 'Jam mulai dan selesai Middle wajib diisi'; end if;
  v_seconds:=extract(epoch from (p_ends_at-p_starts_at)); if v_seconds<=0 then v_seconds:=v_seconds+86400; end if;
  if v_seconds<>28800 then raise exception 'Jam rencana Middle harus 8 jam termasuk istirahat'; end if;
  update public.cashier_assignments set planned_starts_at=p_starts_at,planned_ends_at=p_ends_at,planned_ends_next_day=p_ends_at<=p_starts_at,
    planned_source='manual_middle',reason=trim(p_reason),updated_at=clock_timestamp() where id=p_assignment_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('assignment',v_row.id,v_actor,'middle_planned_interval_saved',trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  update private.supervisor_planning_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.supervisor_interval_coverage(p_outlet_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_people boolean:=private.has_role('admin_hr');v_result jsonb;
begin
  if v_actor is null or not (v_people or private.has_supervisor_capability('summary_view',p_outlet_id,null,v_actor) or private.has_supervisor_capability('coverage_configure',p_outlet_id,null,v_actor)) then
    raise exception 'Anda tidak memiliki akses cakupan outlet ini' using errcode='42501';
  end if;
  if p_work_date is null or not isfinite(p_work_date) or not exists(select 1 from public.outlets where id=p_outlet_id) then raise exception 'Outlet atau tanggal cakupan tidak valid'; end if;
  with needs as (
    select r.id,r.minimum,r.starts_at,r.ends_at,(p_work_date::timestamp+r.starts_at) as starts_ts,(p_work_date::timestamp+r.ends_at) as ends_ts
    from public.staffing_interval_requirements r where r.outlet_id=p_outlet_id and r.weekday=extract(dow from p_work_date)::int and r.effective_from<=p_work_date and coalesce(r.effective_until,'infinity'::date)>=p_work_date
  ), assignments as (
    select a.id,a.employee_id,a.shift,(p_work_date::timestamp+a.planned_starts_at) as starts_ts,((p_work_date+case when a.planned_ends_next_day then 1 else 0 end)::timestamp+a.planned_ends_at) as ends_ts
    from public.cashier_assignments a where a.outlet_id=p_outlet_id and a.work_date=p_work_date and a.status='active' and a.shift<>'off' and a.planned_starts_at is not null and a.planned_ends_at is not null
  ), unknown_middle as (
    select a.employee_id from public.cashier_assignments a where a.outlet_id=p_outlet_id and a.work_date=p_work_date and a.status='active' and a.shift='middle' and (a.planned_starts_at is null or a.planned_ends_at is null)
  ), leave_windows as (
    select l.employee_id,case when coalesce(l.extent,'full_day') in ('full_day','late_arrival') then p_work_date::timestamp else p_work_date::timestamp+coalesce(l.starts_at,'00:00'::time) end as starts_ts,
      case when coalesce(l.extent,'full_day') in ('full_day','early_departure') then (p_work_date+1)::timestamp when coalesce(l.extent,'full_day')='late_arrival' then p_work_date::timestamp+coalesce(l.ends_at,'23:59:59'::time) else p_work_date::timestamp+coalesce(l.ends_at,l.starts_at,'00:00'::time) end as ends_ts
    from public.leave_requests l where l.status='approved' and l.starts_on<=p_work_date and l.ends_on>=p_work_date
  ), endpoints as (
    select n.id,n.starts_ts as endpoint from needs n union select n.id,n.ends_ts from needs n union select n.id,greatest(n.starts_ts,a.starts_ts) from needs n join assignments a on a.starts_ts<n.ends_ts and a.ends_ts>n.starts_ts union select n.id,least(n.ends_ts,a.ends_ts) from needs n join assignments a on a.starts_ts<n.ends_ts and a.ends_ts>n.starts_ts union select n.id,greatest(n.starts_ts,l.starts_ts) from needs n join leave_windows l on l.starts_ts<n.ends_ts and l.ends_ts>n.starts_ts union select n.id,least(n.ends_ts,l.ends_ts) from needs n join leave_windows l on l.starts_ts<n.ends_ts and l.ends_ts>n.starts_ts
  ), segments as (
    select n.id as need_id,n.minimum,e.endpoint as starts_ts,lead(e.endpoint) over(partition by n.id order by e.endpoint) as ends_ts from needs n join endpoints e on e.id=n.id
  ), evaluated as (
    select s.*,coalesce((select array_agg(distinct a.employee_id order by a.employee_id) from assignments a where a.starts_ts<s.ends_ts and a.ends_ts>s.starts_ts and not exists(select 1 from leave_windows l where l.employee_id=a.employee_id and l.starts_ts<s.ends_ts and l.ends_ts>s.starts_ts)),array[]::uuid[]) as available_ids,
      coalesce((select array_agg(distinct a.employee_id order by a.employee_id) from assignments a where a.starts_ts<s.ends_ts and a.ends_ts>s.starts_ts),array[]::uuid[]) as planned_ids,
      coalesce((select array_agg(distinct a.employee_id order by a.employee_id) from assignments a join public.attendance t on t.employee_id=a.employee_id and t.work_date=p_work_date where a.starts_ts<s.ends_ts and a.ends_ts>s.starts_ts and t.clock_in < (s.ends_ts at time zone 'Asia/Jakarta') and (t.clock_out is null or t.clock_out>(s.starts_ts at time zone 'Asia/Jakarta'))),array[]::uuid[]) as attendance_ids
    from segments s where s.ends_ts is not null and s.ends_ts>s.starts_ts
  ), coverage as (
    select jsonb_agg(jsonb_build_object('requirement_id',need_id,'starts_at',starts_ts at time zone 'Asia/Jakarta','ends_at',ends_ts at time zone 'Asia/Jakarta','minimum',minimum,'planned_count',cardinality(planned_ids),'available_count',cardinality(available_ids),'attendance_recorded_count',cardinality(attendance_ids),'shortage',greatest(minimum-cardinality(available_ids),0),'employee_ids',case when v_people then to_jsonb(available_ids) else '[]'::jsonb end) order by starts_ts) as rows from evaluated
  ) select jsonb_build_object('outlet_id',p_outlet_id,'work_date',p_work_date,'as_of',statement_timestamp(),'configured',(select count(*)>0 from needs),'coverage',coalesce((select rows from coverage),'[]'::jsonb),'unknown_middle_count',(select count(*) from unknown_middle),'unknown_middle_employee_ids',case when v_people then coalesce((select jsonb_agg(employee_id order by employee_id) from unknown_middle),'[]'::jsonb) else '[]'::jsonb end,'legacy_shift_requirements',coalesce((select jsonb_agg(jsonb_build_object('shift',shift,'minimum',minimum) order by shift) from public.staffing_requirements r where r.outlet_id=p_outlet_id and r.weekday=extract(dow from p_work_date)::int and r.effective_from<=p_work_date and r.effective_from=(select max(r2.effective_from) from public.staffing_requirements r2 where r2.outlet_id=r.outlet_id and r2.weekday=r.weekday and r2.shift=r.shift and r2.effective_from<=p_work_date)),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

-- A sent handover must always have a recipient.  The response advances the
-- version and records the snapshot that the recipient actually confirmed.
create or replace function public.shift_handover_save_v2(
  p_id uuid,p_expected_version bigint,p_idempotency_key uuid,p_outlet_id uuid,p_work_date date,
  p_sender_assignment_id uuid,p_recipient_employee_id uuid,p_recipient_assignment_id uuid,
  p_pending_work text,p_outlet_condition text,p_notes text,p_send boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_before public.shift_handovers;v_row public.shift_handovers;v_receipt private.shift_handover_receipts;v_hash text;v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_actor is null or p_idempotency_key is null then raise exception 'Akun dan kunci serah terima wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_version',p_expected_version,'outlet_id',p_outlet_id,'work_date',p_work_date,'sender_assignment_id',p_sender_assignment_id,'recipient_employee_id',p_recipient_employee_id,'recipient_assignment_id',p_recipient_assignment_id,'pending_work',coalesce(p_pending_work,''),'outlet_condition',coalesce(p_outlet_condition,''),'notes',coalesce(p_notes,''),'send',p_send,'reason',v_reason)::text);
  insert into private.shift_handover_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash) on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_handover_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci serah terima sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan serah terima sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if p_work_date is null or not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Tanggal atau outlet serah terima tidak valid'; end if;
  if length(trim(coalesce(p_pending_work,'')))+length(trim(coalesce(p_outlet_condition,'')))+length(trim(coalesce(p_notes,'')))<5 then raise exception 'Isi serah terima terlalu singkat'; end if;
  if greatest(length(coalesce(p_pending_work,'')),length(coalesce(p_outlet_condition,'')),length(coalesce(p_notes,'')))>2000 then raise exception 'Catatan serah terima maksimal 2.000 karakter per bagian'; end if;
  if p_send and p_recipient_employee_id is null then raise exception 'Penerima wajib ditetapkan sebelum serah terima dikirim'; end if;
  if p_id is null then
    perform private.assert_handover_assignment(v_actor,p_sender_assignment_id,p_outlet_id,p_work_date,true);
    if p_recipient_employee_id is not null then
      if not private.active_employee(p_recipient_employee_id) or p_recipient_employee_id=v_actor then raise exception 'Penerima serah terima harus akun aktif lain'; end if;
      perform private.assert_handover_assignment(p_recipient_employee_id,p_recipient_assignment_id,p_outlet_id,p_work_date,true);
    end if;
    insert into public.shift_handovers(outlet_id,work_date,sender_employee_id,sender_assignment_id,recipient_employee_id,recipient_assignment_id,status,current_pending_work,current_outlet_condition,current_notes,sent_at)
      values(p_outlet_id,p_work_date,v_actor,p_sender_assignment_id,p_recipient_employee_id,p_recipient_assignment_id,case when p_send then 'sent' else 'draft' end,trim(coalesce(p_pending_work,'')),trim(coalesce(p_outlet_condition,'')),trim(coalesce(p_notes,'')),case when p_send then clock_timestamp() else null end) returning * into v_row;
  else
    select * into strict v_before from public.shift_handovers where id=p_id for update;
    if v_before.sender_employee_id<>v_actor and not private.has_role('admin_hr') then raise exception 'Hanya pengirim atau Admin HR dapat memperbarui serah terima' using errcode='42501'; end if;
    if p_expected_version is null or v_before.version<>p_expected_version then raise exception 'Serah terima berubah sejak dibuka. Tinjau versi terbaru' using errcode='40001'; end if;
    if v_before.status='accepted' and not private.has_role('admin_hr') then raise exception 'Serah terima diterima harus diubah melalui amendemen Admin HR'; end if;
    if p_recipient_employee_id is not null then
      if not private.active_employee(p_recipient_employee_id) or p_recipient_employee_id=v_before.sender_employee_id then raise exception 'Penerima serah terima harus akun aktif lain'; end if;
      perform private.assert_handover_assignment(p_recipient_employee_id,p_recipient_assignment_id,v_before.outlet_id,v_before.work_date,true);
    end if;
    if p_recipient_employee_id is distinct from v_before.recipient_employee_id and length(v_reason)<5 then raise exception 'Alasan perubahan penerima wajib diisi'; end if;
    update public.shift_handovers set recipient_employee_id=p_recipient_employee_id,recipient_assignment_id=p_recipient_assignment_id,current_pending_work=trim(coalesce(p_pending_work,'')),current_outlet_condition=trim(coalesce(p_outlet_condition,'')),current_notes=trim(coalesce(p_notes,'')),status=case when p_send then 'sent' else 'draft' end,version=version+1,sent_at=case when p_send then clock_timestamp() else sent_at end,accepted_at=null,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  insert into public.shift_handover_versions(handover_id,version,pending_work,outlet_condition,notes,authored_by) values(v_row.id,v_row.version,v_row.current_pending_work,v_row.current_outlet_condition,v_row.current_notes,v_actor);
  insert into public.shift_handover_events(handover_id,version,actor_employee_id,action,reason,before_data,after_data) values(v_row.id,v_row.version,v_actor,case when p_send then 'sent' else 'draft_saved' end,coalesce(nullif(v_reason,''),case when p_send then 'Serah terima dikirim' else 'Draft serah terima disimpan' end),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data) values('shift_handover',v_row.id,v_actor,case when p_send then 'sent' else 'saved' end,coalesce(nullif(v_reason,''),'Serah terima diperbarui'),to_jsonb(v_before),to_jsonb(v_row));
  if p_send and v_row.recipient_employee_id<>v_actor then insert into public.notifications(employee_id,entity_type,entity_id,title,body,href) values(v_row.recipient_employee_id,'handover',v_row.id,'Serah terima menunggu konfirmasi','Ada catatan serah terima yang perlu Anda baca.','/operations?handover='||v_row.id::text); end if;
  update private.shift_handover_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.shift_handover_respond_v2(
  p_id uuid,p_expected_version bigint,p_idempotency_key uuid,p_accept boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_before public.shift_handovers;v_row public.shift_handovers;v_receipt private.shift_handover_receipts;v_hash text;
begin
  if v_actor is null or p_idempotency_key is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Akun, kunci, dan alasan respons wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_version',p_expected_version,'accept',p_accept,'reason',trim(p_reason))::text);
  insert into private.shift_handover_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash) on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_handover_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci respons serah terima sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Respons serah terima sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_before from public.shift_handovers where id=p_id for update;
  if v_before.recipient_employee_id<>v_actor or v_before.sender_employee_id=v_actor then raise exception 'Hanya penerima yang sah dapat merespons serah terima' using errcode='42501'; end if;
  if p_expected_version is null or v_before.version<>p_expected_version then raise exception 'Serah terima berubah sejak dibuka. Tinjau versi terbaru' using errcode='40001'; end if;
  if v_before.status<>'sent' then raise exception 'Serah terima ini tidak menunggu respons'; end if;
  update public.shift_handovers set status=case when p_accept then 'accepted' else 'revision_requested' end,accepted_at=case when p_accept then clock_timestamp() else null end,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  insert into public.shift_handover_versions(handover_id,version,pending_work,outlet_condition,notes,authored_by) values(v_row.id,v_row.version,v_row.current_pending_work,v_row.current_outlet_condition,v_row.current_notes,v_actor);
  insert into public.shift_handover_events(handover_id,version,actor_employee_id,action,reason,before_data,after_data) values(v_row.id,v_row.version,v_actor,case when p_accept then 'accepted' else 'revision_requested' end,trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data) values('shift_handover',v_row.id,v_actor,case when p_accept then 'accepted' else 'revision_requested' end,trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  if v_row.sender_employee_id<>v_actor then insert into public.notifications(employee_id,entity_type,entity_id,title,body,href) values(v_row.sender_employee_id,'handover',v_row.id,case when p_accept then 'Serah terima diterima' else 'Serah terima perlu perbaikan' end,'Buka aplikasi untuk melihat respons penerima.','/operations?handover='||v_row.id::text); end if;
  update private.shift_handover_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

-- Exchange deadlines use the planning snapshot when present.  Full-day leave
-- and legacy attendance are checked again at both submit and final decision.
create or replace function private.shift_exchange_deadline(p_assignment public.cashier_assignments)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare v_outlet public.outlets;v_start time;
begin
  if p_assignment.planned_starts_at is not null then return (p_assignment.work_date::timestamp+p_assignment.planned_starts_at) at time zone 'Asia/Jakarta'; end if;
  if p_assignment.shift='middle' then return ((p_assignment.work_date+1)::timestamp at time zone 'Asia/Jakarta'); end if;
  select * into strict v_outlet from public.outlets where id=p_assignment.outlet_id;
  v_start:=case when p_assignment.shift='morning' then v_outlet.morning_starts_at else v_outlet.afternoon_starts_at end;
  return (p_assignment.work_date::timestamp+v_start) at time zone 'Asia/Jakarta';
end;
$$;

create or replace function private.assert_exchange_assignment(p_assignment public.cashier_assignments,p_employee_id uuid,p_work_date date,p_require_work boolean)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if p_assignment.id is null or p_assignment.employee_id<>p_employee_id or p_assignment.work_date<>p_work_date or p_assignment.status<>'active' or (p_require_work and p_assignment.shift='off') then raise exception 'Penugasan pertukaran tidak lagi tersedia'; end if;
  if p_assignment.shift='middle' and not exists(select 1 from public.employees e where e.id=p_employee_id and e.status='active' and e.account_status='active' and e.can_middle_shift) then raise exception 'Karyawan belum memiliki izin Shift Middle'; end if;
  if exists(select 1 from public.attendance a where a.employee_id=p_employee_id and a.work_date=p_work_date) then raise exception 'Jadwal tidak dapat ditukar setelah absensi tercatat'; end if;
  if exists(select 1 from public.leave_requests l where l.employee_id=p_employee_id and l.status='approved' and coalesce(l.extent,'full_day')='full_day' and l.starts_on<=p_work_date and l.ends_on>=p_work_date) then raise exception 'Jadwal tidak dapat ditukar saat cuti penuh sudah disetujui'; end if;
  if private.shift_exchange_deadline(p_assignment)<=clock_timestamp() then raise exception 'Batas waktu pertukaran shift sudah terlewati'; end if;
end;
$$;

-- Replacement requests have no peer assignment to pass through
-- assert_exchange_assignment. Enforce the full-day-leave invariant at the
-- request row itself so both submission and the later final decision recheck
-- it under deterministic employee row locks.
create or replace function private.assert_shift_exchange_parties_available()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('pending_peer','pending_spv','approved') then return new; end if;
  perform 1 from public.employees e
    where e.id in (new.requester_employee_id,new.peer_employee_id)
    order by e.id for no key update;
  if exists(
    select 1 from public.leave_requests l
    where l.employee_id in (new.requester_employee_id,new.peer_employee_id)
      and l.status='approved' and coalesce(l.extent,'full_day')='full_day'
      and l.starts_on<=new.work_date and l.ends_on>=new.work_date
  ) then
    raise exception 'Jadwal tidak dapat ditukar saat cuti penuh sudah disetujui';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_shift_exchange_parties_available() from public,anon,authenticated;
drop trigger if exists shift_exchange_parties_available_before_write on public.shift_exchange_requests;
create trigger shift_exchange_parties_available_before_write
  before insert or update of status,requester_employee_id,peer_employee_id,work_date on public.shift_exchange_requests
  for each row execute function private.assert_shift_exchange_parties_available();

-- Fail closed before adding the uniqueness constraints. Existing operational
-- history is intentionally not changed by this migration; a duplicate must be
-- reviewed and resolved through an authorized workflow before retrying.
do $$
begin
  if exists(
    select 1 from public.shift_exchange_requests
    where status in ('pending_peer','pending_spv')
    group by requester_assignment_id having count(*)>1
  ) or exists(
    select 1 from public.shift_exchange_requests
    where status in ('pending_peer','pending_spv')
    group by peer_employee_id,work_date having count(*)>1
  ) then
    raise exception 'Preflight supervisor hardening menemukan pengajuan pertukaran aktif ganda; data tidak diubah. Selesaikan melalui alur berwenang sebelum migration diulang';
  end if;
end;
$$;

create unique index shift_exchange_active_requester_once_idx on public.shift_exchange_requests(requester_assignment_id) where status in ('pending_peer','pending_spv');
create unique index shift_exchange_active_peer_day_once_idx on public.shift_exchange_requests(peer_employee_id,work_date) where status in ('pending_peer','pending_spv');

create or replace function public.shift_exchange_cancel_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_before public.shift_exchange_requests;v_row public.shift_exchange_requests;v_receipt private.shift_exchange_receipts;v_hash text;
begin
  if v_actor is null or p_idempotency_key is null or length(trim(coalesce(p_note,'')))<3 then raise exception 'Akun, kunci, dan alasan pembatalan wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'note',trim(p_note))::text);
  insert into private.shift_exchange_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash) on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_exchange_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci pembatalan sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Pembatalan sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_before from public.shift_exchange_requests where id=p_id for update;
  if v_before.requester_employee_id<>v_actor then raise exception 'Hanya pengusul dapat membatalkan pengajuan' using errcode='42501'; end if;
  if p_expected_revision is null or v_before.revision<>p_expected_revision then raise exception 'Pengajuan berubah sejak dibuka. Tinjau versi terbaru' using errcode='40001'; end if;
  if v_before.status not in ('pending_peer','pending_spv') then raise exception 'Hanya pengajuan yang masih menunggu dapat dibatalkan'; end if;
  update public.shift_exchange_requests set status='cancelled',decision_note=trim(p_note),revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  insert into public.shift_exchange_events(request_id,revision,actor_employee_id,action,reason,before_data,after_data) values(v_row.id,v_row.revision,v_actor,'cancelled',trim(p_note),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data) values('shift_exchange',v_row.id,v_actor,'cancelled',trim(p_note),to_jsonb(v_before),to_jsonb(v_row));
  if v_row.peer_employee_id<>v_actor then insert into public.notifications(employee_id,entity_type,entity_id,title,body,href) values(v_row.peer_employee_id,'shift_exchange',v_row.id,'Pengajuan tukar/pengganti dibatalkan','Pengusul membatalkan pengajuan sebelum keputusan final.','/operations?exchange='||v_row.id::text); end if;
  update private.shift_exchange_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.shift_exchange_expire_stale_v2(p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_receipt private.shift_exchange_receipts;v_hash text:=md5('expire-stale-v1');v_before public.shift_exchange_requests;v_row public.shift_exchange_requests;v_count integer:=0;v_today date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date;v_result jsonb;
begin
  if p_idempotency_key is null then raise exception 'Kunci kedaluwarsa wajib diisi'; end if;
  insert into private.shift_exchange_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash) on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_exchange_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci kedaluwarsa sudah dipakai untuk tindakan lain'; end if;
    if v_receipt.result is null then raise exception 'Penutupan kedaluwarsa sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  for v_before in select * from public.shift_exchange_requests where status in ('pending_peer','pending_spv') and work_date<v_today for update skip locked loop
    update public.shift_exchange_requests set status='expired',decision_note='Ditutup otomatis oleh Admin HR karena tanggal kerja telah lewat.',revision=revision+1,updated_at=clock_timestamp() where id=v_before.id returning * into v_row;
    insert into public.shift_exchange_events(request_id,revision,actor_employee_id,action,reason,before_data,after_data) values(v_row.id,v_row.revision,v_actor,'expired','Tanggal kerja telah lewat sebelum keputusan final',to_jsonb(v_before),to_jsonb(v_row));
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data) values('shift_exchange',v_row.id,v_actor,'expired','Tanggal kerja telah lewat sebelum keputusan final',to_jsonb(v_before),to_jsonb(v_row));
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href) select e,'shift_exchange',v_row.id,'Pengajuan tukar/pengganti kedaluwarsa','Tanggal kerja telah lewat sebelum keputusan final.','/operations?exchange='||v_row.id::text from unnest(array[v_row.requester_employee_id,v_row.peer_employee_id]) e where e<>v_actor;
    v_count:=v_count+1;
  end loop;
  -- Persist and return exactly one result object. A retry after a lost response
  -- must receive the same payload as the committed first request, including its
  -- server timestamp, rather than a freshly generated acknowledgement.
  v_result:=jsonb_build_object('expired_count',v_count,'as_of',clock_timestamp());
  update private.shift_exchange_receipts set result=v_result where id=v_receipt.id;
  return v_result;
end;
$$;

revoke all on function public.shift_exchange_cancel_v2(uuid,bigint,uuid,text),public.shift_exchange_expire_stale_v2(uuid) from public,anon;
grant execute on function public.shift_exchange_cancel_v2(uuid,bigint,uuid,text),public.shift_exchange_expire_stale_v2(uuid) to authenticated;
