-- Supervisor operational modules: scoped capabilities, outlet issues,
-- versioned handovers and cashier shift exchanges.  This is forward-only over
-- the verified Preview 18 baseline and deliberately leaves all older
-- migrations unchanged.

create table public.supervisor_issue_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null check (length(trim(name)) between 3 and 120),
  active boolean not null default true,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supervisor_capabilities (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  capability text not null check (capability in (
    'issue_report','issue_report_for_other','issue_view','issue_handle',
    'issue_configure','handover_monitor','summary_view','coverage_configure'
  )),
  outlet_id uuid references public.outlets(id),
  category_id uuid references public.supervisor_issue_categories(id),
  granted_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct(employee_id,capability,outlet_id,category_id)
);

create index supervisor_capabilities_scope_idx
  on public.supervisor_capabilities(employee_id,capability,outlet_id,category_id);

create table public.supervisor_issue_routes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.supervisor_issue_categories(id),
  outlet_id uuid references public.outlets(id),
  recipient_employee_id uuid references public.employees(id),
  active boolean not null default true,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct(category_id,outlet_id)
);

create index supervisor_issue_routes_lookup_idx
  on public.supervisor_issue_routes(category_id,outlet_id) where active;

create function private.active_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.employees e
    where e.id=p_employee_id and e.status='active' and e.account_status='active'
  );
$$;

create function private.has_supervisor_capability(
  p_capability text,
  p_outlet_id uuid default null,
  p_category_id uuid default null,
  p_employee_id uuid default private.employee_id()
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.has_role('admin_hr'),false) or exists(
    select 1 from public.supervisor_capabilities c
    join public.employees e on e.id=c.employee_id
    where c.employee_id=p_employee_id
      and (p_employee_id=private.employee_id() or private.has_role('admin_hr'))
      and c.capability=p_capability
      and e.status='active' and e.account_status='active'
      and (c.outlet_id is null or c.outlet_id=p_outlet_id)
      and (c.category_id is null or c.category_id=p_category_id)
  );
$$;

create function private.require_supervisor_capability(
  p_capability text,
  p_outlet_id uuid default null,
  p_category_id uuid default null
) returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();
begin
  if v_actor is null or not private.has_supervisor_capability(p_capability,p_outlet_id,p_category_id,v_actor) then
    raise exception 'Anda tidak memiliki akses operasional untuk tindakan ini' using errcode='42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function private.active_employee(uuid),private.has_supervisor_capability(text,uuid,uuid,uuid),
  private.require_supervisor_capability(text,uuid,uuid) from public,anon,authenticated;
grant execute on function private.has_supervisor_capability(text,uuid,uuid,uuid) to authenticated;

create table public.outlet_issues (
  id uuid primary key default gen_random_uuid(),
  issue_number bigint generated always as identity unique,
  outlet_id uuid not null references public.outlets(id),
  reporter_employee_id uuid references public.employees(id),
  created_by uuid not null references public.employees(id),
  category_id uuid not null references public.supervisor_issue_categories(id),
  category_name_snapshot text not null,
  routed_to_snapshot uuid references public.employees(id),
  owner_id uuid references public.employees(id),
  urgency text not null check (urgency in ('low','normal','high','urgent')),
  description text not null check (length(trim(description)) between 5 and 2000),
  photo_path text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  status text not null default 'new' check (status in ('new','assigned','in_progress','completed')),
  due_at timestamptz check (due_at is null or isfinite(due_at)),
  resolution_note text not null default '' check (length(resolution_note)<=2000),
  revision bigint not null default 1 check (revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index outlet_issues_open_queue_idx on public.outlet_issues(outlet_id,category_id,status,due_at,created_at,id)
  where status<>'completed';
create index outlet_issues_reporter_idx on public.outlet_issues(reporter_employee_id,created_at desc);

create table public.outlet_issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.outlet_issues(id),
  revision bigint not null,
  actor_employee_id uuid not null references public.employees(id),
  action text not null check (action in ('created','updated','assigned','completed','reopened','route_missing')),
  reason text not null check (length(trim(reason)) between 3 and 2000),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index outlet_issue_events_issue_idx on public.outlet_issue_events(issue_id,revision,id);

create table private.outlet_issue_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_employee_id uuid not null references public.employees(id),
  idempotency_key uuid not null,
  request_hash text not null check(length(request_hash)=32),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(actor_employee_id,idempotency_key)
);

alter table public.supervisor_issue_categories enable row level security;
alter table public.supervisor_capabilities enable row level security;
alter table public.supervisor_issue_routes enable row level security;
alter table public.outlet_issues enable row level security;
alter table public.outlet_issue_events enable row level security;
alter table private.outlet_issue_receipts enable row level security;

-- The reporting catalogue is exposed through supervisor_issue_category_page.
-- Direct category reads are configuration-only, so a reporter cannot turn the
-- table into a broad metadata directory merely because they may submit a
-- scoped issue.
create policy supervisor_issue_categories_read on public.supervisor_issue_categories for select to authenticated
  using(private.has_role('admin_hr'));
create policy supervisor_capabilities_self_read on public.supervisor_capabilities for select to authenticated
  using(employee_id=private.employee_id() or private.has_role('admin_hr'));
create policy supervisor_issue_routes_read_scoped on public.supervisor_issue_routes for select to authenticated
  using(private.has_role('admin_hr') or private.has_supervisor_capability('issue_configure',outlet_id,category_id));
create policy outlet_issues_read_scoped on public.outlet_issues for select to authenticated using(
  reporter_employee_id=private.employee_id() or created_by=private.employee_id()
  or private.has_supervisor_capability('issue_view',outlet_id,category_id)
  or private.has_supervisor_capability('issue_handle',outlet_id,category_id)
);
create policy outlet_issue_events_read_scoped on public.outlet_issue_events for select to authenticated using(exists(
  select 1 from public.outlet_issues i where i.id=issue_id and (
    i.reporter_employee_id=private.employee_id() or i.created_by=private.employee_id()
    or private.has_supervisor_capability('issue_view',i.outlet_id,i.category_id)
    or private.has_supervisor_capability('issue_handle',i.outlet_id,i.category_id)
  )
));
revoke all on public.supervisor_issue_categories,public.supervisor_capabilities,public.supervisor_issue_routes,
  public.outlet_issues,public.outlet_issue_events from public,anon;
revoke all on private.outlet_issue_receipts from public,anon,authenticated,service_role;
grant select on public.supervisor_issue_categories,public.supervisor_capabilities,public.supervisor_issue_routes,
  public.outlet_issues,public.outlet_issue_events to authenticated;

alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in (
  'leave','attendance_correction','assignment','assignment_week','attendance_reminder','spv_followup',
  'outlet_issue','handover','shift_exchange'
));
alter table public.notifications add constraint notifications_href_check check(
  (entity_type='leave' and href='/leave?request='||entity_id::text)
  or (entity_type='attendance_correction' and href in ('/attendance?request='||entity_id::text,'/reports?tab=corrections&request='||entity_id::text))
  or (entity_type='assignment' and href ~ '^/assignments\?date=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='assignment_week' and href ~ '^/assignments\?week=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='attendance_reminder' and href='/attendance?record='||entity_id::text)
  or (entity_type='spv_followup' and href='/supervisor?case='||entity_id::text)
  or (entity_type='outlet_issue' and href='/operations?issue='||entity_id::text)
  or (entity_type='handover' and href='/operations?handover='||entity_id::text)
  or (entity_type='shift_exchange' and href='/operations?exchange='||entity_id::text)
);

create function public.supervisor_capability_save(
  p_employee_id uuid,p_capability text,p_outlet_id uuid default null,p_category_id uuid default null,p_granted boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_row public.supervisor_capabilities;
begin
  if p_capability not in ('issue_report','issue_report_for_other','issue_view','issue_handle','issue_configure','handover_monitor','summary_view','coverage_configure') then
    raise exception 'Kemampuan operasional tidak valid';
  end if;
  if not private.active_employee(p_employee_id) then raise exception 'Pilih akun aktif untuk kemampuan operasional'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet kemampuan harus aktif'; end if;
  if p_category_id is not null and not exists(select 1 from public.supervisor_issue_categories where id=p_category_id) then raise exception 'Kategori kemampuan tidak ditemukan'; end if;
  if p_granted then
    insert into public.supervisor_capabilities(employee_id,capability,outlet_id,category_id,granted_by)
      values(p_employee_id,p_capability,p_outlet_id,p_category_id,v_actor)
      on conflict(employee_id,capability,outlet_id,category_id) do update set granted_by=excluded.granted_by
      returning * into v_row;
  else
    delete from public.supervisor_capabilities
      where employee_id=p_employee_id and capability=p_capability and outlet_id is not distinct from p_outlet_id and category_id is not distinct from p_category_id
      returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('supervisor_capability',coalesce(v_row.id,gen_random_uuid()),v_actor,case when p_granted then 'granted' else 'revoked' end,
      'Konfigurasi kemampuan operasional',jsonb_build_object('employee_id',p_employee_id,'capability',p_capability,'outlet_id',p_outlet_id,'category_id',p_category_id));
  return jsonb_build_object('granted',p_granted,'employee_id',p_employee_id,'capability',p_capability,'outlet_id',p_outlet_id,'category_id',p_category_id);
end;
$$;

create function public.supervisor_issue_category_save(
  p_id uuid,p_code text,p_name text,p_active boolean default true
) returns public.supervisor_issue_categories language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.supervisor_issue_categories; v_row public.supervisor_issue_categories;
begin
  if p_code !~ '^[a-z][a-z0-9_]{1,47}$' or length(trim(coalesce(p_name,''))) not between 3 and 120 then
    raise exception 'Kode atau nama kategori tidak valid';
  end if;
  if p_id is null then
    insert into public.supervisor_issue_categories(code,name,active,created_by) values(trim(p_code),trim(p_name),coalesce(p_active,true),v_actor) returning * into v_row;
  else
    select * into strict v_before from public.supervisor_issue_categories where id=p_id for update;
    update public.supervisor_issue_categories set code=trim(p_code),name=trim(p_name),active=coalesce(p_active,true),updated_at=clock_timestamp()
      where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_issue_category',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,'Konfigurasi kategori kendala',to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

-- Reporting needs a narrow category catalogue, not a broad direct-table read.
-- Active employees may choose an active category; only Admin HR may inspect
-- inactive configuration while maintaining routes.
create function public.supervisor_issue_category_page(p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_items jsonb;
begin
  if v_actor is null or not private.active_employee(v_actor) then
    raise exception 'Akun aktif diperlukan untuk melihat kategori kendala' using errcode='42501';
  end if;
  if coalesce(p_include_inactive,false) and not private.has_role('admin_hr') then
    raise exception 'Kategori nonaktif hanya dapat dilihat Admin HR' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'active',c.active,'updated_at',c.updated_at) order by c.name,c.id),'[]'::jsonb)
    into v_items from public.supervisor_issue_categories c where c.active or coalesce(p_include_inactive,false);
  return jsonb_build_object('items',v_items,'as_of',statement_timestamp());
end;
$$;

-- The administration screen needs the current routing/capability snapshot, but
-- that configuration must not become a broadly readable public catalogue.
create function public.supervisor_operation_configuration_page()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_result jsonb;
begin
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'active',c.active,'updated_at',c.updated_at) order by c.name,c.id)
      from public.supervisor_issue_categories c),'[]'::jsonb),
    'routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'category_id',r.category_id,'outlet_id',r.outlet_id,
        'recipient_employee_id',r.recipient_employee_id,'active',r.active,'updated_at',r.updated_at) order by r.updated_at desc,r.id)
      from public.supervisor_issue_routes r),'[]'::jsonb),
    'capabilities',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'employee_id',c.employee_id,'capability',c.capability,
        'outlet_id',c.outlet_id,'category_id',c.category_id,'created_at',c.created_at) order by c.created_at desc,c.id)
      from public.supervisor_capabilities c),'[]'::jsonb),
    'as_of',statement_timestamp()
  ) into v_result;
  return v_result;
end;
$$;

create function public.supervisor_issue_route_save(
  p_id uuid,p_category_id uuid,p_outlet_id uuid,p_recipient_employee_id uuid,p_active boolean default true
) returns public.supervisor_issue_routes language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.supervisor_issue_routes; v_row public.supervisor_issue_routes;
begin
  if not exists(select 1 from public.supervisor_issue_categories where id=p_category_id and active) then raise exception 'Kategori routing harus aktif'; end if;
  if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet routing harus aktif'; end if;
  if p_recipient_employee_id is not null and not private.active_employee(p_recipient_employee_id) then raise exception 'Penerima routing harus akun aktif'; end if;
  if p_recipient_employee_id is not null and not private.has_supervisor_capability('issue_handle',p_outlet_id,p_category_id,p_recipient_employee_id) then
    raise exception 'Penerima routing belum mempunyai kemampuan menangani kategori/outlet ini';
  end if;
  if p_id is null then
    insert into public.supervisor_issue_routes(category_id,outlet_id,recipient_employee_id,active,created_by)
      values(p_category_id,p_outlet_id,p_recipient_employee_id,coalesce(p_active,true),v_actor) returning * into v_row;
  else
    select * into strict v_before from public.supervisor_issue_routes where id=p_id for update;
    update public.supervisor_issue_routes set category_id=p_category_id,outlet_id=p_outlet_id,recipient_employee_id=p_recipient_employee_id,
      active=coalesce(p_active,true),updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('supervisor_issue_route',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,'Konfigurasi penerima kendala',to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

create function private.outlet_issue_access(p_issue public.outlet_issues,p_action text,p_actor uuid default private.employee_id())
returns boolean language sql stable security definer set search_path='' as $$
  select p_actor is not null and (
    p_action='read' and (p_issue.reporter_employee_id=p_actor or p_issue.created_by=p_actor)
    or private.has_supervisor_capability(case when p_action='handle' then 'issue_handle' else 'issue_view' end,p_issue.outlet_id,p_issue.category_id,p_actor)
  );
$$;
revoke all on function private.outlet_issue_access(public.outlet_issues,text,uuid) from public,anon,authenticated;

create function public.outlet_issue_submit(
  p_outlet_id uuid,p_category_id uuid,p_description text,p_urgency text,p_photo_path text default null,
  p_reporter_employee_id uuid default null,p_idempotency_key uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.employee_id(); v_reporter uuid:=coalesce(p_reporter_employee_id,v_actor); v_category public.supervisor_issue_categories;
  v_route public.supervisor_issue_routes; v_row public.outlet_issues; v_receipt private.outlet_issue_receipts; v_hash text;
begin
  if v_actor is null or not private.active_employee(v_actor) then raise exception 'Akun aktif diperlukan untuk melapor' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'Kunci laporan wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('outlet_id',p_outlet_id,'category_id',p_category_id,'description',trim(coalesce(p_description,'')),
    'urgency',p_urgency,'photo_path',p_photo_path,'reporter_employee_id',p_reporter_employee_id)::text);
  insert into private.outlet_issue_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.outlet_issue_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci laporan sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Laporan sebelumnya belum selesai diproses'; end if;
    return v_receipt.result;
  end if;
  if p_urgency not in ('low','normal','high','urgent') or length(trim(coalesce(p_description,''))) not between 5 and 2000 then
    raise exception 'Uraian atau tingkat urgensi kendala tidak valid';
  end if;
  if p_photo_path is not null and p_photo_path !~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
    raise exception 'Lampiran foto tidak sesuai akun pelapor';
  end if;
  if v_reporter<>v_actor and not private.has_supervisor_capability('issue_report_for_other',p_outlet_id,p_category_id,v_actor) then
    raise exception 'Anda tidak dapat membuat laporan atas nama karyawan lain' using errcode='42501';
  end if;
  if not private.active_employee(v_reporter) then raise exception 'Pelapor harus akun aktif'; end if;
  if not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Outlet laporan harus aktif'; end if;
  select * into strict v_category from public.supervisor_issue_categories where id=p_category_id and active;
  if not private.has_role('admin_hr') and not private.has_supervisor_capability('issue_report',p_outlet_id,p_category_id,v_actor)
    and not exists(select 1 from public.cashier_assignments a where a.employee_id=v_reporter and a.outlet_id=p_outlet_id and a.status='active' and a.work_date between (now() at time zone 'Asia/Jakarta')::date-1 and (now() at time zone 'Asia/Jakarta')::date+1)
    and not exists(select 1 from public.attendance a where a.employee_id=v_reporter and a.outlet_id=p_outlet_id and a.work_date between (now() at time zone 'Asia/Jakarta')::date-1 and (now() at time zone 'Asia/Jakarta')::date+1) then
    raise exception 'Tidak ada konteks outlet yang sah. Hubungi petugas berwenang untuk membuat laporan atas nama Anda' using errcode='42501';
  end if;
  select * into v_route from public.supervisor_issue_routes r
    where r.category_id=p_category_id and r.active and (r.outlet_id=p_outlet_id or r.outlet_id is null)
    order by (r.outlet_id is null),r.updated_at desc limit 1;
  if found and v_route.recipient_employee_id is not null and private.active_employee(v_route.recipient_employee_id) then
    insert into public.outlet_issues(outlet_id,reporter_employee_id,created_by,category_id,category_name_snapshot,routed_to_snapshot,owner_id,urgency,description,photo_path,status)
      values(p_outlet_id,v_reporter,v_actor,p_category_id,v_category.name,v_route.recipient_employee_id,v_route.recipient_employee_id,p_urgency,trim(p_description),p_photo_path,'assigned') returning * into v_row;
  else
    insert into public.outlet_issues(outlet_id,reporter_employee_id,created_by,category_id,category_name_snapshot,routed_to_snapshot,owner_id,urgency,description,photo_path,status)
      values(p_outlet_id,v_reporter,v_actor,p_category_id,v_category.name,null,null,p_urgency,trim(p_description),p_photo_path,'new') returning * into v_row;
  end if;
  insert into public.outlet_issue_events(issue_id,revision,actor_employee_id,action,reason,after_data)
    values(v_row.id,v_row.revision,v_actor,case when v_row.owner_id is null then 'route_missing' else 'created' end,
      case when v_row.owner_id is null then 'Tidak ada penerima aktif pada routing kategori' else 'Laporan kendala dibuat' end,to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('outlet_issue',v_row.id,v_actor,'created','Laporan kendala outlet dibuat',to_jsonb(v_row));
  if v_row.owner_id is not null and v_row.owner_id<>v_actor then
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(v_row.owner_id,'outlet_issue',v_row.id,'Kendala outlet baru','Ada laporan kendala yang perlu ditinjau.','/operations?issue='||v_row.id::text);
  end if;
  update private.outlet_issue_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.outlet_issue_update_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_status text,p_owner_id uuid,
  p_due_at timestamptz,p_resolution_note text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.employee_id(); v_before public.outlet_issues; v_row public.outlet_issues;
  v_receipt private.outlet_issue_receipts; v_hash text; v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_actor is null or p_idempotency_key is null then raise exception 'Akun dan kunci pembaruan wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'status',p_status,'owner_id',p_owner_id,
    'due_at',p_due_at,'resolution_note',coalesce(p_resolution_note,''),'reason',v_reason)::text);
  insert into private.outlet_issue_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.outlet_issue_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci kendala sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Pembaruan kendala sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_before from public.outlet_issues where id=p_id for update;
  if not private.outlet_issue_access(v_before,'handle',v_actor) then raise exception 'Anda tidak berhak menangani kendala ini' using errcode='42501'; end if;
  if p_expected_revision is null or v_before.revision<>p_expected_revision then
    raise exception 'Kendala berubah sejak dibuka. Tinjau nilai terbaru sebelum menyimpan' using errcode='40001';
  end if;
  if p_status not in ('new','assigned','in_progress','completed') then raise exception 'Status kendala tidak valid'; end if;
  if p_status='in_progress' and p_owner_id is null then raise exception 'Pilih penanggung jawab sebelum memproses kendala'; end if;
  if p_status='completed' and length(trim(coalesce(p_resolution_note,'')))<5 then raise exception 'Catatan penyelesaian minimal 5 karakter'; end if;
  if length(coalesce(p_resolution_note,''))>2000 then raise exception 'Catatan maksimal 2.000 karakter'; end if;
  if p_owner_id is not null and (not private.active_employee(p_owner_id) or not private.has_supervisor_capability('issue_handle',v_before.outlet_id,v_before.category_id,p_owner_id)) then
    raise exception 'Penanggung jawab harus petugas aktif dalam scope kendala';
  end if;
  if (p_owner_id is distinct from v_before.owner_id or p_due_at is distinct from v_before.due_at) and length(v_reason)<5 then
    raise exception 'Alasan perubahan PIC atau tenggat minimal 5 karakter';
  end if;
  if v_before.status='completed' and p_status<>'new' then raise exception 'Kendala selesai hanya dapat dibuka kembali ke status Baru'; end if;
  update public.outlet_issues set status=p_status,owner_id=p_owner_id,due_at=p_due_at,
    resolution_note=case when p_status='completed' then trim(coalesce(p_resolution_note,'')) else '' end,
    completed_at=case when p_status='completed' then clock_timestamp() else null end,
    revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  insert into public.outlet_issue_events(issue_id,revision,actor_employee_id,action,reason,before_data,after_data)
    values(v_row.id,v_row.revision,v_actor,
      case when p_status='completed' then 'completed' when v_before.status='completed' then 'reopened' when p_owner_id is distinct from v_before.owner_id then 'assigned' else 'updated' end,
      coalesce(nullif(v_reason,''),nullif(trim(coalesce(p_resolution_note,'')),''),'Kendala diperbarui'),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('outlet_issue',v_row.id,v_actor,'updated',coalesce(nullif(v_reason,''),'Kendala diperbarui'),to_jsonb(v_before),to_jsonb(v_row));
  if p_owner_id is distinct from v_before.owner_id and p_owner_id is not null and p_owner_id<>v_actor then
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(p_owner_id,'outlet_issue',v_row.id,'Kendala outlet ditugaskan','Ada kendala outlet yang perlu Anda tindak lanjuti.','/operations?issue='||v_row.id::text);
  end if;
  update private.outlet_issue_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.outlet_issue_page(
  p_outlet_id uuid default null,p_category_id uuid default null,p_status text default 'open',
  p_page_size integer default 25,p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=private.employee_id(); v_size int:=least(greatest(coalesce(p_page_size,25),1),100);
  v_sort_at timestamptz; v_id uuid; v_total bigint; v_raw jsonb:='[]'::jsonb; v_items jsonb:='[]'::jsonb; v_next jsonb;
begin
  if v_actor is null then raise exception 'Sesi tidak aktif' using errcode='42501'; end if;
  if p_status not in ('open','mine','unassigned','history') then raise exception 'Tampilan kendala tidak valid'; end if;
  if p_cursor is not null then
    begin v_sort_at:=(p_cursor->>'sort_at')::timestamptz;v_id:=(p_cursor->>'id')::uuid; exception when others then raise exception 'Cursor kendala tidak valid'; end;
  end if;
  with visible as (
    select i.*,case when i.status='completed' then i.updated_at else coalesce(i.due_at,i.created_at) end as _sort_at
    from public.outlet_issues i
    where (i.reporter_employee_id=v_actor or i.created_by=v_actor or private.has_supervisor_capability('issue_view',i.outlet_id,i.category_id,v_actor) or private.has_supervisor_capability('issue_handle',i.outlet_id,i.category_id,v_actor))
      and (p_outlet_id is null or i.outlet_id=p_outlet_id) and (p_category_id is null or i.category_id=p_category_id)
      and (p_status='history' and i.status='completed' or p_status<>'history' and i.status<>'completed')
      and (p_status<>'mine' or i.owner_id=v_actor) and (p_status<>'unassigned' or i.owner_id is null)
  ), total as (select count(*) as n from visible), page_rows as (
    select * from visible where p_cursor is null or (_sort_at,id)>(v_sort_at,v_id) order by _sort_at,id limit v_size+1
  )
  select (select n from total),coalesce(jsonb_agg(to_jsonb(page_rows) order by _sort_at,id),'[]'::jsonb) into v_total,v_raw from page_rows;
  select coalesce(jsonb_agg(value-'_sort_at' order by ordinality),'[]'::jsonb) into v_items
    from jsonb_array_elements(v_raw) with ordinality where ordinality<=v_size;
  if jsonb_array_length(v_items)>0 then v_next:=jsonb_build_object('sort_at',v_raw->(jsonb_array_length(v_items)-1)->>'_sort_at','id',v_raw->(jsonb_array_length(v_items)-1)->>'id'); end if;
  return jsonb_build_object('items',v_items,'total',v_total,'has_more',jsonb_array_length(v_raw)>v_size,
    'next_cursor',case when jsonb_array_length(v_raw)>v_size then v_next else null end,'as_of',clock_timestamp());
end;
$$;

create table public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  work_date date not null,
  sender_employee_id uuid not null references public.employees(id),
  sender_assignment_id uuid references public.cashier_assignments(id),
  recipient_employee_id uuid references public.employees(id),
  recipient_assignment_id uuid references public.cashier_assignments(id),
  status text not null default 'draft' check(status in ('draft','sent','accepted','revision_requested')),
  version bigint not null default 1 check(version>0),
  current_pending_work text not null default '' check(length(current_pending_work)<=2000),
  current_outlet_condition text not null default '' check(length(current_outlet_condition)<=2000),
  current_notes text not null default '' check(length(current_notes)<=2000),
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(recipient_employee_id is null or recipient_employee_id<>sender_employee_id)
);
create index shift_handovers_recipient_idx on public.shift_handovers(recipient_employee_id,status,work_date desc);
create index shift_handovers_outlet_idx on public.shift_handovers(outlet_id,work_date desc);

create table public.shift_handover_versions (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.shift_handovers(id),
  version bigint not null,
  pending_work text not null check(length(pending_work)<=2000),
  outlet_condition text not null check(length(outlet_condition)<=2000),
  notes text not null check(length(notes)<=2000),
  authored_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  unique(handover_id,version)
);

create table public.shift_handover_events (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.shift_handovers(id),
  version bigint not null,
  actor_employee_id uuid not null references public.employees(id),
  action text not null check(action in ('draft_saved','sent','accepted','revision_requested','recipient_changed')),
  reason text not null check(length(trim(reason)) between 3 and 2000),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index shift_handover_events_handover_idx on public.shift_handover_events(handover_id,version,id);

create table private.shift_handover_receipts (
  id uuid primary key default gen_random_uuid(),actor_employee_id uuid not null references public.employees(id),idempotency_key uuid not null,
  request_hash text not null check(length(request_hash)=32),result jsonb,created_at timestamptz not null default now(),unique(actor_employee_id,idempotency_key)
);

alter table public.shift_handovers enable row level security;
alter table public.shift_handover_versions enable row level security;
alter table public.shift_handover_events enable row level security;
alter table private.shift_handover_receipts enable row level security;

create function private.handover_access(p_handover public.shift_handovers,p_actor uuid default private.employee_id())
returns boolean language sql stable security definer set search_path='' as $$
  select p_actor is not null and (
    p_handover.sender_employee_id=p_actor or p_handover.recipient_employee_id=p_actor
    or private.has_role('admin_hr') or private.has_supervisor_capability('handover_monitor',p_handover.outlet_id,null,p_actor)
  );
$$;
revoke all on function private.handover_access(public.shift_handovers,uuid) from public,anon,authenticated;
grant execute on function private.handover_access(public.shift_handovers,uuid) to authenticated;
create policy shift_handovers_read_scoped on public.shift_handovers for select to authenticated using(private.handover_access(shift_handovers));
create policy shift_handover_versions_read_scoped on public.shift_handover_versions for select to authenticated using(exists(
  select 1 from public.shift_handovers h where h.id=handover_id and private.handover_access(h)
));
create policy shift_handover_events_read_scoped on public.shift_handover_events for select to authenticated using(exists(
  select 1 from public.shift_handovers h where h.id=handover_id and private.handover_access(h)
));
revoke all on private.shift_handover_receipts from public,anon,authenticated,service_role;
grant select on public.shift_handovers,public.shift_handover_versions,public.shift_handover_events to authenticated;

create function private.assert_handover_assignment(p_employee_id uuid,p_assignment_id uuid,p_outlet_id uuid,p_work_date date,p_required boolean)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if p_assignment_id is null then
    if p_required then raise exception 'Penugasan kasir yang sah wajib dipilih'; end if;
    return;
  end if;
  if not exists(select 1 from public.cashier_assignments a where a.id=p_assignment_id and a.employee_id=p_employee_id
    and a.outlet_id=p_outlet_id and a.work_date=p_work_date and a.status='active') then
    raise exception 'Penugasan tidak sesuai dengan outlet, tanggal, atau karyawan';
  end if;
end;
$$;
revoke all on function private.assert_handover_assignment(uuid,uuid,uuid,date,boolean) from public,anon,authenticated;

create function public.shift_handover_save_v2(
  p_id uuid,p_expected_version bigint,p_idempotency_key uuid,p_outlet_id uuid,p_work_date date,
  p_sender_assignment_id uuid,p_recipient_employee_id uuid,p_recipient_assignment_id uuid,
  p_pending_work text,p_outlet_condition text,p_notes text,p_send boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.employee_id();v_before public.shift_handovers;v_row public.shift_handovers;v_receipt private.shift_handover_receipts;
  v_hash text;v_new_version bigint;v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_actor is null or p_idempotency_key is null then raise exception 'Akun dan kunci serah terima wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_version',p_expected_version,'outlet_id',p_outlet_id,'work_date',p_work_date,
    'sender_assignment_id',p_sender_assignment_id,'recipient_employee_id',p_recipient_employee_id,'recipient_assignment_id',p_recipient_assignment_id,
    'pending_work',coalesce(p_pending_work,''),'outlet_condition',coalesce(p_outlet_condition,''),'notes',coalesce(p_notes,''),'send',p_send,'reason',v_reason)::text);
  insert into private.shift_handover_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_handover_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci serah terima sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan serah terima sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  if p_work_date is null or not exists(select 1 from public.outlets where id=p_outlet_id and active) then raise exception 'Tanggal atau outlet serah terima tidak valid'; end if;
  if length(trim(coalesce(p_pending_work,'')))+length(trim(coalesce(p_outlet_condition,'')))+length(trim(coalesce(p_notes,'')))<5 then raise exception 'Isi serah terima terlalu singkat'; end if;
  if greatest(length(coalesce(p_pending_work,'')),length(coalesce(p_outlet_condition,'')),length(coalesce(p_notes,'')))>2000 then raise exception 'Catatan serah terima maksimal 2.000 karakter per bagian'; end if;
  if p_id is null then
    perform private.assert_handover_assignment(v_actor,p_sender_assignment_id,p_outlet_id,p_work_date,true);
    if p_recipient_employee_id is not null then
      if not private.active_employee(p_recipient_employee_id) or p_recipient_employee_id=v_actor then raise exception 'Penerima serah terima harus akun aktif lain'; end if;
      perform private.assert_handover_assignment(p_recipient_employee_id,p_recipient_assignment_id,p_outlet_id,p_work_date,true);
    end if;
    insert into public.shift_handovers(outlet_id,work_date,sender_employee_id,sender_assignment_id,recipient_employee_id,recipient_assignment_id,status,
      current_pending_work,current_outlet_condition,current_notes,sent_at)
    values(p_outlet_id,p_work_date,v_actor,p_sender_assignment_id,p_recipient_employee_id,p_recipient_assignment_id,
      case when p_send then 'sent' else 'draft' end,trim(coalesce(p_pending_work,'')),trim(coalesce(p_outlet_condition,'')),trim(coalesce(p_notes,'')),case when p_send then clock_timestamp() else null end)
    returning * into v_row;
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
    if p_send and p_recipient_employee_id is null then raise exception 'Penerima wajib ditetapkan sebelum serah terima dikirim'; end if;
    update public.shift_handovers set recipient_employee_id=p_recipient_employee_id,recipient_assignment_id=p_recipient_assignment_id,
      current_pending_work=trim(coalesce(p_pending_work,'')),current_outlet_condition=trim(coalesce(p_outlet_condition,'')),current_notes=trim(coalesce(p_notes,'')),
      status=case when p_send then 'sent' else 'draft' end,version=version+1,sent_at=case when p_send then clock_timestamp() else sent_at end,
      accepted_at=null,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  insert into public.shift_handover_versions(handover_id,version,pending_work,outlet_condition,notes,authored_by)
    values(v_row.id,v_row.version,v_row.current_pending_work,v_row.current_outlet_condition,v_row.current_notes,v_actor);
  insert into public.shift_handover_events(handover_id,version,actor_employee_id,action,reason,before_data,after_data)
    values(v_row.id,v_row.version,v_actor,case when p_send then 'sent' else 'draft_saved' end,
      coalesce(nullif(v_reason,''),case when p_send then 'Serah terima dikirim' else 'Draft serah terima disimpan' end),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('shift_handover',v_row.id,v_actor,case when p_send then 'sent' else 'saved' end,coalesce(nullif(v_reason,''),'Serah terima diperbarui'),to_jsonb(v_before),to_jsonb(v_row));
  if p_send and v_row.recipient_employee_id<>v_actor then
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(v_row.recipient_employee_id,'handover',v_row.id,'Serah terima menunggu konfirmasi','Ada catatan serah terima yang perlu Anda baca.','/operations?handover='||v_row.id::text);
  end if;
  update private.shift_handover_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.shift_handover_respond_v2(
  p_id uuid,p_expected_version bigint,p_idempotency_key uuid,p_accept boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_before public.shift_handovers;v_row public.shift_handovers;v_receipt private.shift_handover_receipts;v_hash text;
begin
  if v_actor is null or p_idempotency_key is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Akun, kunci, dan alasan respons wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_version',p_expected_version,'accept',p_accept,'reason',trim(p_reason))::text);
  insert into private.shift_handover_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
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
  update public.shift_handovers set status=case when p_accept then 'accepted' else 'revision_requested' end,
    accepted_at=case when p_accept then clock_timestamp() else null end,updated_at=clock_timestamp()
    where id=p_id returning * into v_row;
  insert into public.shift_handover_events(handover_id,version,actor_employee_id,action,reason,before_data,after_data)
    values(v_row.id,v_row.version,v_actor,case when p_accept then 'accepted' else 'revision_requested' end,trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('shift_handover',v_row.id,v_actor,case when p_accept then 'accepted' else 'revision_requested' end,trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  if v_row.sender_employee_id<>v_actor then
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(v_row.sender_employee_id,'handover',v_row.id,case when p_accept then 'Serah terima diterima' else 'Serah terima perlu perbaikan' end,
        'Buka aplikasi untuk melihat respons penerima.','/operations?handover='||v_row.id::text);
  end if;
  update private.shift_handover_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.shift_handover_page(p_outlet_id uuid default null,p_from date default null,p_to date default null,p_page_size integer default 25,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_size integer:=least(greatest(coalesce(p_page_size,25),1),100);v_date date;v_id uuid;v_total bigint;v_raw jsonb:='[]'::jsonb;v_items jsonb:='[]'::jsonb;v_next jsonb;
begin
  if v_actor is null then raise exception 'Sesi tidak aktif' using errcode='42501'; end if;
  if p_from is not null and (not isfinite(p_from) or (p_to is not null and p_from>p_to)) then raise exception 'Rentang tanggal serah terima tidak valid'; end if;
  if p_cursor is not null then begin v_date:=(p_cursor->>'work_date')::date;v_id:=(p_cursor->>'id')::uuid;exception when others then raise exception 'Cursor serah terima tidak valid';end;end if;
  with visible as (
    select h.* from public.shift_handovers h where private.handover_access(h,v_actor)
      and (p_outlet_id is null or h.outlet_id=p_outlet_id) and (p_from is null or h.work_date>=p_from) and (p_to is null or h.work_date<=p_to)
  ), total as (select count(*) n from visible), page_rows as (
    select * from visible where p_cursor is null or (work_date,id)<(v_date,v_id) order by work_date desc,id desc limit v_size+1
  ) select (select n from total),coalesce(jsonb_agg(to_jsonb(page_rows) order by work_date desc,id desc),'[]'::jsonb) into v_total,v_raw from page_rows;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_items from jsonb_array_elements(v_raw) with ordinality where ordinality<=v_size;
  if jsonb_array_length(v_items)>0 then v_next:=jsonb_build_object('work_date',v_raw->(jsonb_array_length(v_items)-1)->>'work_date','id',v_raw->(jsonb_array_length(v_items)-1)->>'id');end if;
  return jsonb_build_object('items',v_items,'total',v_total,'has_more',jsonb_array_length(v_raw)>v_size,'next_cursor',case when jsonb_array_length(v_raw)>v_size then v_next else null end,'as_of',clock_timestamp());
end;
$$;

create table public.shift_exchange_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity unique,
  request_type text not null check(request_type in ('swap','replacement')),
  work_date date not null,
  requester_employee_id uuid not null references public.employees(id),
  peer_employee_id uuid not null references public.employees(id),
  requester_assignment_id uuid not null references public.cashier_assignments(id),
  peer_assignment_id uuid references public.cashier_assignments(id),
  requester_assignment_updated_at timestamptz not null,
  peer_assignment_updated_at timestamptz,
  reason text not null check(length(trim(reason)) between 5 and 2000),
  status text not null default 'pending_peer' check(status in ('pending_peer','pending_spv','approved','rejected','cancelled','expired')),
  peer_note text not null default '' check(length(peer_note)<=2000),
  decision_note text not null default '' check(length(decision_note)<=2000),
  decided_by uuid references public.employees(id),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  check(requester_employee_id<>peer_employee_id),
  check((request_type='swap' and peer_assignment_id is not null and peer_assignment_updated_at is not null)
    or (request_type='replacement'))
);
create index shift_exchange_party_idx on public.shift_exchange_requests(requester_employee_id,status,work_date desc);
create index shift_exchange_peer_idx on public.shift_exchange_requests(peer_employee_id,status,work_date desc);
create index shift_exchange_pending_spv_idx on public.shift_exchange_requests(status,work_date,created_at) where status='pending_spv';

create table public.shift_exchange_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.shift_exchange_requests(id),
  revision bigint not null,actor_employee_id uuid not null references public.employees(id),
  action text not null check(action in ('requested','peer_accepted','peer_rejected','approved','rejected','cancelled','expired')),
  reason text not null check(length(trim(reason)) between 3 and 2000),before_data jsonb,after_data jsonb not null,created_at timestamptz not null default now()
);
create index shift_exchange_events_request_idx on public.shift_exchange_events(request_id,revision,id);

create table private.shift_exchange_receipts (
  id uuid primary key default gen_random_uuid(),actor_employee_id uuid not null references public.employees(id),idempotency_key uuid not null,
  request_hash text not null check(length(request_hash)=32),result jsonb,created_at timestamptz not null default now(),unique(actor_employee_id,idempotency_key)
);

alter table public.shift_exchange_requests enable row level security;
alter table public.shift_exchange_events enable row level security;
alter table private.shift_exchange_receipts enable row level security;
create policy shift_exchange_requests_read on public.shift_exchange_requests for select to authenticated using(
  requester_employee_id=private.employee_id() or peer_employee_id=private.employee_id() or private.has_role('admin_hr')
);
create policy shift_exchange_events_read on public.shift_exchange_events for select to authenticated using(exists(
  select 1 from public.shift_exchange_requests r where r.id=request_id and (r.requester_employee_id=private.employee_id() or r.peer_employee_id=private.employee_id() or private.has_role('admin_hr'))
));
revoke all on private.shift_exchange_receipts from public,anon,authenticated,service_role;
grant select on public.shift_exchange_requests,public.shift_exchange_events to authenticated;

create function private.shift_exchange_deadline(p_assignment public.cashier_assignments)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare v_outlet public.outlets;v_start time;
begin
  if p_assignment.shift='middle' then return ((p_assignment.work_date+1)::timestamp at time zone 'Asia/Jakarta'); end if;
  select * into strict v_outlet from public.outlets where id=p_assignment.outlet_id;
  v_start:=case when p_assignment.shift='morning' then v_outlet.morning_starts_at else v_outlet.afternoon_starts_at end;
  return (p_assignment.work_date::timestamp+v_start) at time zone 'Asia/Jakarta';
end;
$$;
revoke all on function private.shift_exchange_deadline(public.cashier_assignments) from public,anon,authenticated;

create function private.assert_exchange_assignment(p_assignment public.cashier_assignments,p_employee_id uuid,p_work_date date,p_require_work boolean)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if p_assignment.id is null or p_assignment.employee_id<>p_employee_id or p_assignment.work_date<>p_work_date or p_assignment.status<>'active'
    or (p_require_work and p_assignment.shift='off') then raise exception 'Penugasan pertukaran tidak lagi tersedia'; end if;
  if exists(select 1 from public.attendance a where a.employee_id=p_employee_id and a.work_date=p_work_date) then raise exception 'Jadwal tidak dapat ditukar setelah absensi tercatat'; end if;
  if private.shift_exchange_deadline(p_assignment)<=clock_timestamp() then raise exception 'Batas waktu pertukaran shift sudah terlewati'; end if;
end;
$$;
revoke all on function private.assert_exchange_assignment(public.cashier_assignments,uuid,date,boolean) from public,anon,authenticated;

create function public.shift_exchange_submit(
  p_request_type text,p_requester_assignment_id uuid,p_peer_employee_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.employee_id();v_requester public.cashier_assignments;v_peer public.cashier_assignments;v_peer_employee public.employees;
  v_row public.shift_exchange_requests;v_receipt private.shift_exchange_receipts;v_hash text;v_today date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date;v_peer_exists boolean:=false;
begin
  if v_actor is null or p_idempotency_key is null or p_request_type not in ('swap','replacement') or length(trim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Data pengajuan pertukaran tidak valid';
  end if;
  v_hash:=md5(jsonb_build_object('request_type',p_request_type,'requester_assignment_id',p_requester_assignment_id,'peer_employee_id',p_peer_employee_id,'reason',trim(p_reason))::text);
  insert into private.shift_exchange_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_exchange_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci pengajuan sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Pengajuan sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_requester from public.cashier_assignments where id=p_requester_assignment_id for update;
  perform private.assert_exchange_assignment(v_requester,v_actor,v_requester.work_date,true);
  if v_requester.work_date<v_today then raise exception 'Pertukaran hanya untuk jadwal hari ini sebelum mulai atau hari mendatang'; end if;
  if v_requester.shift='middle' and v_requester.work_date<=v_today then raise exception 'Middle tanpa jam rencana hanya dapat diajukan untuk tanggal setelah hari ini'; end if;
  if not private.active_employee(p_peer_employee_id) or p_peer_employee_id=v_actor then raise exception 'Pilih rekan kasir aktif yang berbeda'; end if;
  select * into strict v_peer_employee from public.employees where id=p_peer_employee_id for no key update;
  if not v_peer_employee.can_clock then raise exception 'Rekan pengganti harus kasir aktif'; end if;
  select * into v_peer from public.cashier_assignments where employee_id=p_peer_employee_id and work_date=v_requester.work_date for update;
  v_peer_exists:=found;
  if p_request_type='swap' then
    perform private.assert_exchange_assignment(v_peer,p_peer_employee_id,v_requester.work_date,true);
    if v_peer.shift='middle' and v_peer.work_date<=v_today then raise exception 'Tukar Middle hari ini belum didukung tanpa jam rencana'; end if;
  else
    if v_peer_exists and v_peer.status='active' then raise exception 'Calon pengganti sudah memiliki penugasan aktif atau Libur eksplisit pada tanggal tersebut'; end if;
    if v_peer_exists and v_peer.status<>'cancelled' then raise exception 'Status jadwal calon pengganti perlu ditinjau oleh Admin HR'; end if;
  end if;
  if exists(select 1 from public.shift_exchange_requests r where r.requester_assignment_id=v_requester.id and r.status in ('pending_peer','pending_spv')) then
    raise exception 'Masih ada pengajuan aktif untuk jadwal ini';
  end if;
  insert into public.shift_exchange_requests(request_type,work_date,requester_employee_id,peer_employee_id,requester_assignment_id,peer_assignment_id,
    requester_assignment_updated_at,peer_assignment_updated_at,reason)
  values(p_request_type,v_requester.work_date,v_actor,p_peer_employee_id,v_requester.id,case when v_peer_exists then v_peer.id else null end,
    v_requester.updated_at,case when v_peer_exists then v_peer.updated_at else null end,trim(p_reason)) returning * into v_row;
  insert into public.shift_exchange_events(request_id,revision,actor_employee_id,action,reason,after_data)
    values(v_row.id,v_row.revision,v_actor,'requested',trim(p_reason),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('shift_exchange',v_row.id,v_actor,'requested',trim(p_reason),to_jsonb(v_row));
  insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
    values(p_peer_employee_id,'shift_exchange',v_row.id,'Permintaan tukar/pengganti shift','Buka aplikasi untuk merespons pengajuan rekan.','/operations?exchange='||v_row.id::text);
  update private.shift_exchange_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.shift_exchange_respond_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_accept boolean,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_before public.shift_exchange_requests;v_row public.shift_exchange_requests;v_receipt private.shift_exchange_receipts;v_hash text;
begin
  if v_actor is null or p_idempotency_key is null or length(trim(coalesce(p_note,'')))<3 then raise exception 'Akun, kunci, dan catatan respons wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'accept',p_accept,'note',trim(p_note))::text);
  insert into private.shift_exchange_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_exchange_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci respons pengajuan sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Respons pengajuan sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_before from public.shift_exchange_requests where id=p_id for update;
  if v_before.peer_employee_id<>v_actor then raise exception 'Hanya rekan yang dipilih dapat merespons pengajuan' using errcode='42501'; end if;
  if p_expected_revision is null or v_before.revision<>p_expected_revision then raise exception 'Pengajuan berubah sejak dibuka. Tinjau versi terbaru' using errcode='40001'; end if;
  if v_before.status<>'pending_peer' then raise exception 'Pengajuan ini tidak menunggu respons rekan'; end if;
  update public.shift_exchange_requests set status=case when p_accept then 'pending_spv' else 'rejected' end,peer_note=trim(p_note),revision=revision+1,updated_at=clock_timestamp()
    where id=p_id returning * into v_row;
  insert into public.shift_exchange_events(request_id,revision,actor_employee_id,action,reason,before_data,after_data)
    values(v_row.id,v_row.revision,v_actor,case when p_accept then 'peer_accepted' else 'peer_rejected' end,trim(p_note),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('shift_exchange',v_row.id,v_actor,case when p_accept then 'peer_accepted' else 'peer_rejected' end,trim(p_note),to_jsonb(v_before),to_jsonb(v_row));
  if v_row.requester_employee_id<>v_actor then
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(v_row.requester_employee_id,'shift_exchange',v_row.id,case when p_accept then 'Pengajuan diteruskan ke SPV' else 'Pengajuan ditolak rekan' end,
        'Buka aplikasi untuk melihat respons pengajuan.','/operations?exchange='||v_row.id::text);
  end if;
  update private.shift_exchange_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.shift_exchange_decide_v2(
  p_id uuid,p_expected_revision bigint,p_idempotency_key uuid,p_approved boolean,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_hr();v_before public.shift_exchange_requests;v_row public.shift_exchange_requests;v_receipt private.shift_exchange_receipts;
  v_hash text;v_requester public.cashier_assignments;v_peer public.cashier_assignments;v_peer_employee public.employees;v_changed public.cashier_assignments;v_peer_exists boolean:=false;
begin
  if p_idempotency_key is null or length(trim(coalesce(p_note,'')))<5 then raise exception 'Kunci dan catatan keputusan minimal 5 karakter wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'approved',p_approved,'note',trim(p_note))::text);
  insert into private.shift_exchange_receipts(actor_employee_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.shift_exchange_receipts where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci keputusan sudah dipakai untuk isi lain'; end if;
    if v_receipt.result is null then raise exception 'Keputusan sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;
  select * into strict v_before from public.shift_exchange_requests where id=p_id for update;
  if v_actor in (v_before.requester_employee_id,v_before.peer_employee_id) then raise exception 'Admin HR peserta pengajuan tidak dapat memberi keputusan' using errcode='42501'; end if;
  if p_expected_revision is null or v_before.revision<>p_expected_revision then raise exception 'Pengajuan berubah sejak dibuka. Tinjau versi terbaru' using errcode='40001'; end if;
  if v_before.status<>'pending_spv' then raise exception 'Pengajuan belum siap diputuskan oleh SPV'; end if;
  if not p_approved then
    update public.shift_exchange_requests set status='rejected',decision_note=trim(p_note),decided_by=v_actor,decided_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into v_row;
  else
    select * into strict v_requester from public.cashier_assignments where id=v_before.requester_assignment_id for update;
    select * into strict v_peer_employee from public.employees where id=v_before.peer_employee_id and status='active' and account_status='active' for no key update;
    if v_requester.updated_at<>v_before.requester_assignment_updated_at then raise exception 'Jadwal pengusul berubah sejak pengajuan. Minta pengajuan ulang' using errcode='40001'; end if;
    perform private.assert_exchange_assignment(v_requester,v_before.requester_employee_id,v_before.work_date,true);
    if v_before.request_type='swap' then
      select * into strict v_peer from public.cashier_assignments where id=v_before.peer_assignment_id for update;
      if v_peer.updated_at<>v_before.peer_assignment_updated_at then raise exception 'Jadwal rekan berubah sejak pengajuan. Minta pengajuan ulang' using errcode='40001'; end if;
      perform private.assert_exchange_assignment(v_peer,v_before.peer_employee_id,v_before.work_date,true);
      -- Row identities remain with their original employees; only the approved
      -- outlet/shift context changes in this one transaction.
      update public.cashier_assignments set outlet_id=v_peer.outlet_id,shift=v_peer.shift,reason='Pertukaran shift disetujui: '||trim(p_note),updated_at=clock_timestamp()
        where id=v_requester.id returning * into v_changed;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('assignment',v_changed.id,v_actor,'shift_exchange_swap',trim(p_note),to_jsonb(v_requester),to_jsonb(v_changed));
      update public.cashier_assignments set outlet_id=v_requester.outlet_id,shift=v_requester.shift,reason='Pertukaran shift disetujui: '||trim(p_note),updated_at=clock_timestamp()
        where id=v_peer.id returning * into v_changed;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('assignment',v_changed.id,v_actor,'shift_exchange_swap',trim(p_note),to_jsonb(v_peer),to_jsonb(v_changed));
    else
      select * into v_peer from public.cashier_assignments where employee_id=v_before.peer_employee_id and work_date=v_before.work_date for update;
      v_peer_exists:=found;
      if v_peer_exists and v_peer.status<>'cancelled' then raise exception 'Jadwal pengganti berubah; pengajuan perlu ditinjau ulang' using errcode='40001'; end if;
      if v_peer_exists and v_before.peer_assignment_id is distinct from v_peer.id then raise exception 'Baris jadwal pengganti berubah; pengajuan perlu ditinjau ulang' using errcode='40001'; end if;
      if v_peer_exists and v_before.peer_assignment_updated_at is distinct from v_peer.updated_at then raise exception 'Jadwal pengganti berubah sejak pengajuan. Minta pengajuan ulang' using errcode='40001'; end if;
      update public.cashier_assignments set status='cancelled',reason='Digantikan melalui pengajuan disetujui: '||trim(p_note),updated_at=clock_timestamp()
        where id=v_requester.id returning * into v_changed;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('assignment',v_changed.id,v_actor,'shift_exchange_replacement_cancelled',trim(p_note),to_jsonb(v_requester),to_jsonb(v_changed));
      if v_peer_exists then
        update public.cashier_assignments set outlet_id=v_requester.outlet_id,shift=v_requester.shift,status='active',reason='Pengganti disetujui: '||trim(p_note),updated_at=clock_timestamp()
          where id=v_peer.id returning * into v_changed;
      else
        insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,status,reason,created_by)
          values(v_before.peer_employee_id,v_before.work_date,v_requester.outlet_id,v_requester.shift,'active','Pengganti disetujui: '||trim(p_note),v_actor) returning * into v_changed;
      end if;
      insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('assignment',v_changed.id,v_actor,'shift_exchange_replacement_assigned',trim(p_note),case when v_peer.id is null then null else to_jsonb(v_peer) end,to_jsonb(v_changed));
    end if;
    update public.shift_exchange_requests set status='approved',decision_note=trim(p_note),decided_by=v_actor,decided_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into v_row;
  end if;
  insert into public.shift_exchange_events(request_id,revision,actor_employee_id,action,reason,before_data,after_data)
    values(v_row.id,v_row.revision,v_actor,case when p_approved then 'approved' else 'rejected' end,trim(p_note),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('shift_exchange',v_row.id,v_actor,case when p_approved then 'approved' else 'rejected' end,trim(p_note),to_jsonb(v_before),to_jsonb(v_row));
  insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
    select e,'shift_exchange',v_row.id,case when p_approved then 'Pertukaran/pengganti disetujui' else 'Pertukaran/pengganti ditolak' end,
      'Buka aplikasi untuk melihat keputusan Admin HR.','/operations?exchange='||v_row.id::text
    from unnest(array[v_row.requester_employee_id,v_row.peer_employee_id]) e where e<>v_actor;
  update private.shift_exchange_receipts set result=to_jsonb(v_row) where id=v_receipt.id;
  return to_jsonb(v_row);
end;
$$;

create function public.shift_exchange_page(p_status text default 'active',p_page_size integer default 25,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.employee_id();v_size integer:=least(greatest(coalesce(p_page_size,25),1),100);v_at timestamptz;v_id uuid;v_total bigint;v_raw jsonb:='[]'::jsonb;v_items jsonb:='[]'::jsonb;v_next jsonb;
begin
  if v_actor is null then raise exception 'Sesi tidak aktif' using errcode='42501';end if;
  if p_status not in ('active','history','pending_spv') then raise exception 'Tampilan pengajuan tidak valid';end if;
  if p_cursor is not null then begin v_at:=(p_cursor->>'updated_at')::timestamptz;v_id:=(p_cursor->>'id')::uuid;exception when others then raise exception 'Cursor pengajuan tidak valid';end;end if;
  with visible as (
    select r.* from public.shift_exchange_requests r where (r.requester_employee_id=v_actor or r.peer_employee_id=v_actor or private.has_role('admin_hr'))
      and (p_status='history' and r.status in ('approved','rejected','cancelled','expired') or p_status='active' and r.status in ('pending_peer','pending_spv') or p_status='pending_spv' and r.status='pending_spv' and private.has_role('admin_hr'))
  ),total as(select count(*) n from visible),page_rows as(select * from visible where p_cursor is null or (updated_at,id)<(v_at,v_id) order by updated_at desc,id desc limit v_size+1)
  select(select n from total),coalesce(jsonb_agg(to_jsonb(page_rows) order by updated_at desc,id desc),'[]'::jsonb) into v_total,v_raw from page_rows;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_items from jsonb_array_elements(v_raw) with ordinality where ordinality<=v_size;
  if jsonb_array_length(v_items)>0 then v_next:=jsonb_build_object('updated_at',v_raw->(jsonb_array_length(v_items)-1)->>'updated_at','id',v_raw->(jsonb_array_length(v_items)-1)->>'id');end if;
  return jsonb_build_object('items',v_items,'total',v_total,'has_more',jsonb_array_length(v_raw)>v_size,'next_cursor',case when jsonb_array_length(v_raw)>v_size then v_next else null end,'as_of',clock_timestamp());
end;
$$;

-- Keep issue photos private: the object key is bound to its uploader's Auth
-- folder and readers must also have access to the referenced issue. Signed
-- URLs are minted by the application only after its issue query is authorized.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('outlet-issue-photos','outlet-issue-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy outlet_issue_photo_insert on storage.objects for insert to authenticated with check(
  bucket_id='outlet-issue-photos' and private.employee_id() is not null and (storage.foldername(name))[1]=auth.uid()::text
);
create policy outlet_issue_photo_select on storage.objects for select to authenticated using(
  bucket_id='outlet-issue-photos' and exists(
    select 1 from public.outlet_issues i where i.photo_path=name and (
      i.reporter_employee_id=private.employee_id() or i.created_by=private.employee_id()
      or private.has_supervisor_capability('issue_view',i.outlet_id,i.category_id)
      or private.has_supervisor_capability('issue_handle',i.outlet_id,i.category_id)
    )
  )
);
create policy outlet_issue_photo_delete_unreferenced on storage.objects for delete to authenticated using(
  bucket_id='outlet-issue-photos' and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.outlet_issues i where i.photo_path=name)
);

-- Storage policies are planned even when a different bucket is queried. Keep
-- the issue lookup in a definer helper so unrelated attendance/profile object
-- operations do not require direct privileges on this private operational table.
create function private.can_read_outlet_issue_photo(p_name text,p_employee_id uuid default private.employee_id())
returns boolean language sql stable security definer set search_path='' as $$
  select p_employee_id is not null and exists(
    select 1 from public.outlet_issues i where i.photo_path=p_name and (
      i.reporter_employee_id=p_employee_id or i.created_by=p_employee_id
      or private.has_supervisor_capability('issue_view',i.outlet_id,i.category_id,p_employee_id)
      or private.has_supervisor_capability('issue_handle',i.outlet_id,i.category_id,p_employee_id)
    )
  );
$$;
create function private.outlet_issue_photo_unreferenced(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.outlet_issues i where i.photo_path=p_name);
$$;
revoke all on function private.can_read_outlet_issue_photo(text,uuid),private.outlet_issue_photo_unreferenced(text) from public,anon,authenticated;
grant execute on function private.can_read_outlet_issue_photo(text,uuid),private.outlet_issue_photo_unreferenced(text) to authenticated;
drop policy outlet_issue_photo_select on storage.objects;
drop policy outlet_issue_photo_delete_unreferenced on storage.objects;
create policy outlet_issue_photo_select on storage.objects for select to authenticated using(
  bucket_id='outlet-issue-photos' and private.can_read_outlet_issue_photo(name)
);
create policy outlet_issue_photo_delete_unreferenced on storage.objects for delete to authenticated using(
  bucket_id='outlet-issue-photos' and (storage.foldername(name))[1]=auth.uid()::text
  and private.outlet_issue_photo_unreferenced(name)
);

revoke all on function public.supervisor_capability_save(uuid,text,uuid,uuid,boolean),
  public.supervisor_issue_category_save(uuid,text,text,boolean),public.supervisor_issue_category_page(boolean),public.supervisor_operation_configuration_page(),public.supervisor_issue_route_save(uuid,uuid,uuid,uuid,boolean),
  public.outlet_issue_submit(uuid,uuid,text,text,text,uuid,uuid),
  public.outlet_issue_update_v2(uuid,bigint,uuid,text,uuid,timestamptz,text,text),
  public.outlet_issue_page(uuid,uuid,text,integer,jsonb),
  public.shift_handover_save_v2(uuid,bigint,uuid,uuid,date,uuid,uuid,uuid,text,text,text,boolean,text),
  public.shift_handover_respond_v2(uuid,bigint,uuid,boolean,text),public.shift_handover_page(uuid,date,date,integer,jsonb),
  public.shift_exchange_submit(text,uuid,uuid,text,uuid),public.shift_exchange_respond_v2(uuid,bigint,uuid,boolean,text),
  public.shift_exchange_decide_v2(uuid,bigint,uuid,boolean,text),public.shift_exchange_page(text,integer,jsonb)
  from public,anon;
grant execute on function public.supervisor_capability_save(uuid,text,uuid,uuid,boolean),
  public.supervisor_issue_category_save(uuid,text,text,boolean),public.supervisor_issue_category_page(boolean),public.supervisor_operation_configuration_page(),public.supervisor_issue_route_save(uuid,uuid,uuid,uuid,boolean),
  public.outlet_issue_submit(uuid,uuid,text,text,text,uuid,uuid),
  public.outlet_issue_update_v2(uuid,bigint,uuid,text,uuid,timestamptz,text,text),
  public.outlet_issue_page(uuid,uuid,text,integer,jsonb),
  public.shift_handover_save_v2(uuid,bigint,uuid,uuid,date,uuid,uuid,uuid,text,text,text,boolean,text),
  public.shift_handover_respond_v2(uuid,bigint,uuid,boolean,text),public.shift_handover_page(uuid,date,date,integer,jsonb),
  public.shift_exchange_submit(text,uuid,uuid,text,uuid),public.shift_exchange_respond_v2(uuid,bigint,uuid,boolean,text),
  public.shift_exchange_decide_v2(uuid,bigint,uuid,boolean,text),public.shift_exchange_page(text,integer,jsonb)
  to authenticated;
