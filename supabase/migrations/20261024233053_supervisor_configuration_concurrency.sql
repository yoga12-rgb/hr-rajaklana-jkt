-- Versioned, idempotent configuration writes for categories, routes, and
-- capability grants. Existing v1 RPCs remain available during the frontend
-- transition, but now advance the same revisions so they cannot silently
-- bypass a v2 baseline.

alter table public.supervisor_issue_categories
  add column if not exists revision bigint not null default 1 check (revision > 0);
alter table public.supervisor_issue_routes
  add column if not exists revision bigint not null default 1 check (revision > 0);
alter table public.supervisor_capabilities
  add column if not exists revision bigint not null default 1 check (revision > 0),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists private.supervisor_configuration_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_employee_id uuid not null references public.employees(id),
  idempotency_key uuid not null,
  request_hash text not null check(length(request_hash)=32),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(actor_employee_id,idempotency_key)
);
alter table private.supervisor_configuration_receipts enable row level security;
revoke all on private.supervisor_configuration_receipts from public,anon,authenticated,service_role;

-- `private.has_supervisor_capability` intentionally treats the *caller* as
-- unrestricted when they are Admin HR.  It must therefore not be used to
-- validate a different employee selected as a routing recipient/issue owner:
-- that would turn the caller's Admin role into a capability grant for the
-- target employee.  This target-only predicate evaluates the configured
-- employee directly and deliberately requires a global capability when the
-- configured route itself is global (outlet/category context is NULL).
create or replace function private.supervisor_target_has_capability(
  p_capability text,p_outlet_id uuid,p_category_id uuid,p_employee_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select p_employee_id is not null and exists(
    select 1
    from public.employees e
    where e.id=p_employee_id and e.status='active' and e.account_status='active'
      and (
        exists(select 1 from public.employee_roles r where r.employee_id=e.id and r.role='admin_hr')
        or exists(
          select 1
          from public.supervisor_capabilities c
          where c.employee_id=e.id and c.capability=p_capability
            and (c.outlet_id is null or (p_outlet_id is not null and c.outlet_id=p_outlet_id))
            and (c.category_id is null or (p_category_id is not null and c.category_id=p_category_id))
        )
      )
  );
$$;
revoke all on function private.supervisor_target_has_capability(text,uuid,uuid,uuid) from public,anon,authenticated;

-- Keep the write trigger and configuration save RPCs on the same target-only
-- predicate.  Historical owners are still retained if their access later
-- changes; only a new/changed owner must satisfy the current scope.
create or replace function private.validate_outlet_issue_owner()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.owner_id is null or (tg_op='UPDATE' and new.owner_id is not distinct from old.owner_id) then
    return new;
  end if;
  if not private.supervisor_target_has_capability('issue_handle',new.outlet_id,new.category_id,new.owner_id) then
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

-- Replacement requests have no peer assignment for
-- `assert_exchange_assignment` to validate.  Keep their eligibility in one
-- private assertion that is invoked by the pending/approved request trigger,
-- so it runs at initial submission and again immediately before the final
-- decision commits.  It intentionally checks current state rather than the
-- submission snapshot: attendance, approved full leave, account status and
-- Middle permission may all have changed while a request was pending.
create or replace function private.assert_shift_exchange_replacement_candidate(
  p_employee_id uuid,p_work_date date,p_required_shift text
) returns void language plpgsql security definer set search_path='' as $$
declare v_candidate public.employees;
begin
  select * into v_candidate
  from public.employees
  where id=p_employee_id
  for no key update;
  if not found or v_candidate.status<>'active' or v_candidate.account_status<>'active' or not v_candidate.can_clock then
    raise exception 'Rekan pengganti harus kasir aktif';
  end if;
  if p_required_shift='middle' and not v_candidate.can_middle_shift then
    raise exception 'Karyawan belum memiliki izin Shift Middle';
  end if;
  if exists(select 1 from public.attendance a where a.employee_id=p_employee_id and a.work_date=p_work_date) then
    raise exception 'Jadwal tidak dapat ditukar setelah absensi tercatat';
  end if;
  if exists(
    select 1 from public.leave_requests l
    where l.employee_id=p_employee_id and l.status='approved'
      and coalesce(l.extent,'full_day')='full_day'
      and l.starts_on<=p_work_date and l.ends_on>=p_work_date
  ) then
    raise exception 'Jadwal tidak dapat ditukar saat cuti penuh sudah disetujui';
  end if;
end;
$$;
revoke all on function private.assert_shift_exchange_replacement_candidate(uuid,date,text) from public,anon,authenticated;

-- m22 already installs this trigger on shift_exchange_requests.  Replacing
-- its function keeps that forward-only trigger while extending it safely for
-- replacement candidates.  The requester row can already be cancelled when
-- the final decision reaches this BEFORE status='approved' trigger, so only
-- its stable identity/date/shift snapshot is read here; the public decision
-- RPC remains responsible for validating its active baseline before it makes
-- the cancellation.
create or replace function private.assert_shift_exchange_parties_available()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_requester public.cashier_assignments;
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
  if new.request_type='replacement' then
    select * into strict v_requester from public.cashier_assignments
      where id=new.requester_assignment_id for no key update;
    if v_requester.employee_id is distinct from new.requester_employee_id
      or v_requester.work_date is distinct from new.work_date then
      raise exception 'Penugasan pengusul tidak cocok dengan pengajuan pertukaran';
    end if;
    perform private.assert_shift_exchange_replacement_candidate(new.peer_employee_id,new.work_date,v_requester.shift);
  end if;
  return new;
end;
$$;
revoke all on function private.assert_shift_exchange_parties_available() from public,anon,authenticated;

-- Keep the legacy methods compatible while making legacy writes visible to
-- v2 callers as a newer server revision.
create or replace function public.supervisor_capability_save(
  p_employee_id uuid,p_capability text,p_outlet_id uuid default null,p_category_id uuid default null,p_granted boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.supervisor_capabilities;v_row public.supervisor_capabilities;
begin
  if p_capability not in ('issue_report','issue_report_for_other','issue_view','issue_handle','issue_configure','handover_monitor','summary_view','coverage_configure') then
    raise exception 'Kemampuan operasional tidak valid';
  end if;
  if not private.active_employee(p_employee_id) then raise exception 'Pilih akun aktif untuk kemampuan operasional'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet kemampuan harus aktif'; end if;
  if p_category_id is not null and not exists(select 1 from public.supervisor_issue_categories where id=p_category_id) then raise exception 'Kategori kemampuan tidak ditemukan'; end if;
  if p_granted then
    select * into v_before from public.supervisor_capabilities
      where employee_id=p_employee_id and capability=p_capability and outlet_id is not distinct from p_outlet_id and category_id is not distinct from p_category_id
      for update;
    if found then
      update public.supervisor_capabilities set granted_by=v_actor,revision=revision+1,updated_at=clock_timestamp()
        where id=v_before.id returning * into v_row;
    else
      insert into public.supervisor_capabilities(employee_id,capability,outlet_id,category_id,granted_by)
        values(p_employee_id,p_capability,p_outlet_id,p_category_id,v_actor) returning * into v_row;
    end if;
  else
    delete from public.supervisor_capabilities
      where employee_id=p_employee_id and capability=p_capability and outlet_id is not distinct from p_outlet_id and category_id is not distinct from p_category_id
      returning * into v_row;
    v_before:=v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_capability',coalesce(v_row.id,gen_random_uuid()),v_actor,case when p_granted then 'granted' else 'revoked' end,
      'Konfigurasi kemampuan operasional',to_jsonb(v_before),jsonb_build_object('employee_id',p_employee_id,'capability',p_capability,'outlet_id',p_outlet_id,'category_id',p_category_id,'granted',p_granted));
  return jsonb_build_object('granted',p_granted,'employee_id',p_employee_id,'capability',p_capability,'outlet_id',p_outlet_id,'category_id',p_category_id,
    'id',v_row.id,'revision',case when p_granted then v_row.revision else coalesce(v_before.revision,0)+1 end);
end;
$$;

create or replace function public.supervisor_issue_category_save(
  p_id uuid,p_code text,p_name text,p_active boolean default true
) returns public.supervisor_issue_categories language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.supervisor_issue_categories;v_row public.supervisor_issue_categories;v_code text:=trim(coalesce(p_code,''));
begin
  if v_code !~ '^[a-z][a-z0-9_]{1,47}$' or length(trim(coalesce(p_name,''))) not between 3 and 120 then
    raise exception 'Kode atau nama kategori tidak valid';
  end if;
  if p_id is null then
    insert into public.supervisor_issue_categories(code,name,active,created_by) values(v_code,trim(p_name),coalesce(p_active,true),v_actor) returning * into v_row;
  else
    select * into strict v_before from public.supervisor_issue_categories where id=p_id for update;
    update public.supervisor_issue_categories set code=v_code,name=trim(p_name),active=coalesce(p_active,true),revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_issue_category',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,'Konfigurasi kategori kendala',to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.supervisor_issue_route_save(
  p_id uuid,p_category_id uuid,p_outlet_id uuid,p_recipient_employee_id uuid,p_active boolean default true
) returns public.supervisor_issue_routes language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.supervisor_issue_routes;v_row public.supervisor_issue_routes;
begin
  if not exists(select 1 from public.supervisor_issue_categories where id=p_category_id and active) then raise exception 'Kategori routing harus aktif'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet routing harus aktif'; end if;
  if p_recipient_employee_id is not null and not private.supervisor_target_has_capability('issue_handle',p_outlet_id,p_category_id,p_recipient_employee_id) then
    raise exception 'Penerima routing belum mempunyai kemampuan menangani kategori/outlet ini';
  end if;
  if p_id is null then
    insert into public.supervisor_issue_routes(category_id,outlet_id,recipient_employee_id,active,created_by)
      values(p_category_id,p_outlet_id,p_recipient_employee_id,coalesce(p_active,true),v_actor) returning * into v_row;
  else
    select * into strict v_before from public.supervisor_issue_routes where id=p_id for update;
    update public.supervisor_issue_routes set category_id=p_category_id,outlet_id=p_outlet_id,recipient_employee_id=p_recipient_employee_id,
      active=coalesce(p_active,true),revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_issue_route',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,'Konfigurasi penerima kendala',to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

-- Admin-only configuration snapshot now carries the server baseline needed by
-- v2. Older clients ignore the additive JSON fields and continue to use v1.
create or replace function public.supervisor_operation_configuration_page()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_result jsonb;
begin
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'active',c.active,'revision',c.revision,'updated_at',c.updated_at) order by c.name,c.id)
      from public.supervisor_issue_categories c),'[]'::jsonb),
    'routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'category_id',r.category_id,'outlet_id',r.outlet_id,
        'recipient_employee_id',r.recipient_employee_id,'active',r.active,'revision',r.revision,'updated_at',r.updated_at) order by r.updated_at desc,r.id)
      from public.supervisor_issue_routes r),'[]'::jsonb),
    'capabilities',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'employee_id',c.employee_id,'capability',c.capability,
        'outlet_id',c.outlet_id,'category_id',c.category_id,'revision',c.revision,'created_at',c.created_at,'updated_at',c.updated_at) order by c.updated_at desc,c.id)
      from public.supervisor_capabilities c),'[]'::jsonb),
    'as_of',statement_timestamp()
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.supervisor_issue_category_save_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_code text,p_name text,p_active boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.supervisor_issue_categories;v_row public.supervisor_issue_categories;
  v_receipt private.supervisor_configuration_receipts;v_hash text;v_code text:=trim(coalesce(p_code,''));v_active boolean:=coalesce(p_active,true);
begin
  if p_idempotency_key is null then raise exception 'Kunci konfigurasi kategori wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('kind','category','id',p_id,'expected_revision',p_expected_revision,'code',v_code,'name',trim(coalesce(p_name,'')),'active',v_active)::text);
  insert into private.supervisor_configuration_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.supervisor_configuration_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci konfigurasi sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan konfigurasi kategori sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if v_code !~ '^[a-z][a-z0-9_]{1,47}$' or length(trim(coalesce(p_name,''))) not between 3 and 120 then raise exception 'Kode atau nama kategori tidak valid'; end if;
  if p_id is null then
    if p_expected_revision is not null then raise exception 'Kategori baru tidak memakai revisi lama'; end if;
    insert into public.supervisor_issue_categories(code,name,active,created_by)
      values(v_code,trim(p_name),v_active,v_actor)
      on conflict(code) do nothing returning * into v_row;
    if not found then
      raise exception 'Kategori konfigurasi berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001';
    end if;
  else
    select * into strict v_before from public.supervisor_issue_categories where id=p_id for update;
    if p_expected_revision is null or v_before.revision is distinct from p_expected_revision then raise exception 'Kategori konfigurasi berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001'; end if;
    update public.supervisor_issue_categories set code=v_code,name=trim(p_name),active=v_active,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_issue_category',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,'Konfigurasi kategori kendala berversi',to_jsonb(v_before),to_jsonb(v_row));
  update private.supervisor_configuration_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.supervisor_issue_route_save_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_category_id uuid,p_outlet_id uuid,p_recipient_employee_id uuid,p_active boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.supervisor_issue_routes;v_row public.supervisor_issue_routes;
  v_receipt private.supervisor_configuration_receipts;v_hash text;v_active boolean:=coalesce(p_active,true);
begin
  if p_idempotency_key is null then raise exception 'Kunci konfigurasi routing wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('kind','route','id',p_id,'expected_revision',p_expected_revision,'category_id',p_category_id,'outlet_id',p_outlet_id,'recipient_employee_id',p_recipient_employee_id,'active',v_active)::text);
  insert into private.supervisor_configuration_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.supervisor_configuration_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci konfigurasi sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan konfigurasi routing sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if not exists(select 1 from public.supervisor_issue_categories where id=p_category_id and active) then raise exception 'Kategori routing harus aktif'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet routing harus aktif'; end if;
  if p_recipient_employee_id is not null and not private.supervisor_target_has_capability('issue_handle',p_outlet_id,p_category_id,p_recipient_employee_id) then raise exception 'Penerima routing belum mempunyai kemampuan menangani kategori/outlet ini'; end if;
  if p_id is null then
    if p_expected_revision is not null then raise exception 'Routing baru tidak memakai revisi lama'; end if;
    insert into public.supervisor_issue_routes(category_id,outlet_id,recipient_employee_id,active,created_by)
      values(p_category_id,p_outlet_id,p_recipient_employee_id,v_active,v_actor)
      on conflict(category_id,outlet_id) do nothing returning * into v_row;
    if not found then
      raise exception 'Routing konfigurasi berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001';
    end if;
  else
    select * into strict v_before from public.supervisor_issue_routes where id=p_id for update;
    if p_expected_revision is null or v_before.revision is distinct from p_expected_revision then raise exception 'Routing konfigurasi berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001'; end if;
    update public.supervisor_issue_routes set category_id=p_category_id,outlet_id=p_outlet_id,recipient_employee_id=p_recipient_employee_id,
      active=v_active,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_issue_route',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,'Konfigurasi routing kendala berversi',to_jsonb(v_before),to_jsonb(v_row));
  update private.supervisor_configuration_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.supervisor_capability_save_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_employee_id uuid,p_capability text,p_outlet_id uuid,p_category_id uuid,p_granted boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_before public.supervisor_capabilities;v_row public.supervisor_capabilities;
  v_receipt private.supervisor_configuration_receipts;v_hash text;v_result jsonb;v_granted boolean:=coalesce(p_granted,true);
begin
  if p_idempotency_key is null then raise exception 'Kunci konfigurasi kemampuan wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('kind','capability','id',p_id,'expected_revision',p_expected_revision,'employee_id',p_employee_id,'capability',p_capability,'outlet_id',p_outlet_id,'category_id',p_category_id,'granted',v_granted)::text);
  insert into private.supervisor_configuration_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.supervisor_configuration_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci konfigurasi sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan konfigurasi kemampuan sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if p_capability not in ('issue_report','issue_report_for_other','issue_view','issue_handle','issue_configure','handover_monitor','summary_view','coverage_configure') then raise exception 'Kemampuan operasional tidak valid'; end if;
  if not private.active_employee(p_employee_id) then raise exception 'Pilih akun aktif untuk kemampuan operasional'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet kemampuan harus aktif'; end if;
  if p_category_id is not null and not exists(select 1 from public.supervisor_issue_categories where id=p_category_id) then raise exception 'Kategori kemampuan tidak ditemukan'; end if;
  if v_granted then
    if p_id is not null or p_expected_revision is not null then raise exception 'Pemberian kemampuan baru tidak memakai baseline lama'; end if;
    select * into v_before from public.supervisor_capabilities
      where employee_id=p_employee_id and capability=p_capability and outlet_id is not distinct from p_outlet_id and category_id is not distinct from p_category_id
      for update;
    if found then raise exception 'Kemampuan operasional berubah sejak dibuka. Muat ulang konfigurasi sebelum mengubahnya' using errcode='40001'; end if;
    insert into public.supervisor_capabilities(employee_id,capability,outlet_id,category_id,granted_by)
      values(p_employee_id,p_capability,p_outlet_id,p_category_id,v_actor)
      on conflict(employee_id,capability,outlet_id,category_id) do nothing returning * into v_row;
    if not found then
      raise exception 'Kemampuan operasional berubah sejak dibuka. Muat ulang konfigurasi sebelum mengubahnya' using errcode='40001';
    end if;
    v_result:=jsonb_build_object('granted',true,'capability',to_jsonb(v_row));
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
      values('supervisor_capability',v_row.id,v_actor,'granted','Konfigurasi kemampuan operasional berversi',null,to_jsonb(v_row));
  else
    if p_id is null or p_expected_revision is null then raise exception 'Pencabutan kemampuan wajib memakai ID dan revisi terakhir'; end if;
    select * into strict v_before from public.supervisor_capabilities where id=p_id for update;
    if v_before.revision is distinct from p_expected_revision then raise exception 'Kemampuan konfigurasi berubah sejak dibuka. Muat ulang dan tinjau konflik' using errcode='40001'; end if;
    if v_before.employee_id is distinct from p_employee_id or v_before.capability is distinct from p_capability
      or v_before.outlet_id is distinct from p_outlet_id or v_before.category_id is distinct from p_category_id then
      raise exception 'Baseline kemampuan tidak cocok dengan konfigurasi saat ini' using errcode='40001';
    end if;
    v_result:=jsonb_build_object('granted',false,'id',v_before.id,'employee_id',v_before.employee_id,'capability',v_before.capability,
      'outlet_id',v_before.outlet_id,'category_id',v_before.category_id,'revision',v_before.revision+1);
    delete from public.supervisor_capabilities where id=v_before.id;
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
      values('supervisor_capability',v_before.id,v_actor,'revoked','Konfigurasi kemampuan operasional berversi',to_jsonb(v_before),v_result);
  end if;
  update private.supervisor_configuration_receipts set result=v_result where id=v_receipt.id;
  return v_result;
end;
$$;

revoke all on function public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean),
  public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean),
  public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean) from public,anon;
grant execute on function public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean),
  public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean),
  public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean) to authenticated;
