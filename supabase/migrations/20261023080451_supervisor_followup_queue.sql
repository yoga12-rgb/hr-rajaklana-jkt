-- Supervisor backlog, optimistic concurrency and durable due reminders.
-- This migration is additive over the verified 18-migration Preview baseline.

alter table public.spv_followups
  add column revision bigint not null default 1 check (revision > 0),
  add column due_at timestamptz check (due_at is null or isfinite(due_at));

create index spv_followups_open_priority
  on public.spv_followups(status,due_at,created_at,id)
  where status <> 'completed';
create index spv_followups_history_page
  on public.spv_followups(updated_at,id)
  where status = 'completed';

create function private.bump_spv_followup_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function private.bump_spv_followup_revision() from public,anon,authenticated;
create trigger spv_followup_revision_before_update
  before update on public.spv_followups
  for each row execute function private.bump_spv_followup_revision();

create table private.spv_followup_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_employee_id uuid not null references public.employees(id),
  idempotency_key uuid not null,
  request_hash text not null check (length(request_hash)=32),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(actor_employee_id,idempotency_key)
);
alter table private.spv_followup_receipts enable row level security;
revoke all on private.spv_followup_receipts from public,anon,authenticated,service_role;

alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications drop constraint notifications_href_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('leave','attendance_correction','assignment','assignment_week','attendance_reminder','spv_followup'));
alter table public.notifications add constraint notifications_href_check check(
  (entity_type='leave' and href='/leave?request='||entity_id::text)
  or (entity_type='attendance_correction' and href in ('/attendance?request='||entity_id::text,'/reports?tab=corrections&request='||entity_id::text))
  or (entity_type='assignment' and href ~ '^/assignments\?date=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='assignment_week' and href ~ '^/assignments\?week=[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (entity_type='attendance_reminder' and href='/attendance?record='||entity_id::text)
  or (entity_type='spv_followup' and href='/supervisor?case='||entity_id::text));

create table private.spv_followup_reminders (
  followup_id uuid not null references public.spv_followups(id),
  revision bigint not null,
  employee_id uuid not null references public.employees(id),
  due_at timestamptz not null,
  notification_id uuid not null references public.notifications(id),
  created_at timestamptz not null default now(),
  primary key(followup_id,revision,employee_id)
);
alter table private.spv_followup_reminders enable row level security;
revoke all on private.spv_followup_reminders from public,anon,authenticated,service_role;

create function public.spv_followup_page(
  p_view text default 'all_open',
  p_outlet_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_page_size integer default 25,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_hr();
  v_now timestamptz:=statement_timestamp();
  v_size integer:=least(greatest(coalesce(p_page_size,25),1),100);
  v_cursor_priority integer;
  v_cursor_sort_at timestamptz;
  v_cursor_id uuid;
  v_raw jsonb:='[]'::jsonb;
  v_items jsonb:='[]'::jsonb;
  v_total bigint:=0;
  v_has_more boolean:=false;
  v_next jsonb;
begin
  if p_view not in ('all_open','mine','unassigned','overdue','history') then
    raise exception 'Tampilan tindak lanjut tidak valid';
  end if;
  if p_from is not null and (not isfinite(p_from) or (p_to is not null and p_from>p_to)) then
    raise exception 'Rentang tanggal tindak lanjut tidak valid';
  end if;
  if p_to is not null and not isfinite(p_to) then raise exception 'Rentang tanggal tindak lanjut tidak valid'; end if;
  if p_cursor is not null then
    begin
      v_cursor_priority:=(p_cursor->>'priority')::integer;
      v_cursor_sort_at:=(p_cursor->>'sort_at')::timestamptz;
      v_cursor_id:=(p_cursor->>'id')::uuid;
    exception when others then
      raise exception 'Cursor tindak lanjut tidak valid';
    end;
    if v_cursor_priority is null or v_cursor_sort_at is null or v_cursor_id is null then
      raise exception 'Cursor tindak lanjut tidak valid';
    end if;
  end if;

  select count(*) into v_total
  from public.spv_followups f
  where (p_view='history' and f.status='completed' or p_view<>'history' and f.status<>'completed')
    and (p_view<>'mine' or f.owner_id=v_actor)
    and (p_view<>'unassigned' or f.owner_id is null)
    and (p_view<>'overdue' or f.due_at is not null and f.due_at<v_now)
    and (p_outlet_id is null or f.outlet_id=p_outlet_id)
    and (p_from is null or f.work_date>=p_from)
    and (p_to is null or f.work_date<=p_to);

  with filtered as (
    select f.*,
      case when f.status<>'completed' and f.due_at is not null and f.due_at<v_now then 0 else 1 end as _priority,
      case when f.status='completed' then f.updated_at else coalesce(f.due_at,f.created_at) end as _sort_at
    from public.spv_followups f
    where (p_view='history' and f.status='completed' or p_view<>'history' and f.status<>'completed')
      and (p_view<>'mine' or f.owner_id=v_actor)
      and (p_view<>'unassigned' or f.owner_id is null)
      and (p_view<>'overdue' or f.due_at is not null and f.due_at<v_now)
      and (p_outlet_id is null or f.outlet_id=p_outlet_id)
      and (p_from is null or f.work_date>=p_from)
      and (p_to is null or f.work_date<=p_to)
  ), page_rows as (
    select * from filtered f
    where p_cursor is null or (f._priority,f._sort_at,f.id)>(v_cursor_priority,v_cursor_sort_at,v_cursor_id)
    order by f._priority,f._sort_at,f.id
    limit v_size+1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p._priority,p._sort_at,p.id),'[]'::jsonb)
    into v_raw from page_rows p;

  v_has_more:=jsonb_array_length(v_raw)>v_size;
  select coalesce(jsonb_agg(value-'_priority'-'_sort_at' order by ordinality),'[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_raw) with ordinality
    where ordinality<=v_size;
  if jsonb_array_length(v_items)>0 then
    v_next:=jsonb_build_object(
      'priority',(v_raw->(jsonb_array_length(v_items)-1)->>'_priority')::integer,
      'sort_at',v_raw->(jsonb_array_length(v_items)-1)->>'_sort_at',
      'id',v_raw->(jsonb_array_length(v_items)-1)->>'id'
    );
  end if;
  return jsonb_build_object('items',v_items,'total',v_total,'has_more',v_has_more,
    'next_cursor',case when v_has_more then v_next else null end,'as_of',v_now);
end;
$$;

create function public.spv_followup_update_v2(
  p_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_status text,
  p_owner_id uuid,
  p_note text,
  p_resolution_note text,
  p_due_at timestamptz,
  p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=private.require_hr();
  v_before public.spv_followups;
  v_row public.spv_followups;
  v_receipt private.spv_followup_receipts;
  v_hash text;
  v_result jsonb;
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if p_idempotency_key is null then raise exception 'Kunci penyimpanan tindak lanjut wajib diisi'; end if;
  v_hash:=md5(jsonb_build_object('id',p_id,'expected_revision',p_expected_revision,'status',p_status,
    'owner_id',p_owner_id,'note',coalesce(p_note,''),'resolution_note',coalesce(p_resolution_note,''),
    'due_at',p_due_at,'reason',v_reason)::text);
  insert into private.spv_followup_receipts(actor_employee_id,idempotency_key,request_hash)
    values(v_actor,p_idempotency_key,v_hash)
    on conflict(actor_employee_id,idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into strict v_receipt from private.spv_followup_receipts
      where actor_employee_id=v_actor and idempotency_key=p_idempotency_key for update;
    if v_receipt.request_hash<>v_hash then raise exception 'Kunci tindak lanjut sudah dipakai untuk perubahan lain'; end if;
    if v_receipt.result is null then raise exception 'Penyimpanan tindak lanjut sebelumnya belum selesai'; end if;
    return v_receipt.result;
  end if;

  select * into strict v_before from public.spv_followups where id=p_id for update;
  if p_expected_revision is null or v_before.revision<>p_expected_revision then
    raise exception 'Tindak lanjut berubah sejak dibuka. Tinjau nilai terbaru sebelum menyimpan' using errcode='40001';
  end if;
  if p_status is null or p_status not in ('new','in_progress','completed') then raise exception 'Status tindak lanjut tidak valid'; end if;
  if v_before.status='completed' and p_status<>'completed' then raise exception 'Gunakan Buka lagi setelah kondisi sumber muncul kembali'; end if;
  if p_owner_id is not null and not exists(
    select 1 from public.employees e join public.employee_roles r on r.employee_id=e.id
    where e.id=p_owner_id and e.status='active' and e.account_status='active' and r.role='admin_hr'
  ) then raise exception 'Penanggung jawab harus Admin HR aktif'; end if;
  if p_status='in_progress' and p_owner_id is null then raise exception 'Pilih penanggung jawab sebelum memproses kasus'; end if;
  if p_status='completed' and length(trim(coalesce(p_resolution_note,'')))<5 then raise exception 'Catatan penyelesaian minimal 5 karakter'; end if;
  if length(coalesce(p_note,''))>2000 or length(coalesce(p_resolution_note,''))>2000 then raise exception 'Catatan maksimal 2.000 karakter'; end if;
  if (p_owner_id is distinct from v_before.owner_id or p_due_at is distinct from v_before.due_at)
    and length(v_reason)<5 then raise exception 'Alasan perubahan PIC atau tenggat minimal 5 karakter'; end if;

  update public.spv_followups set status=p_status,owner_id=p_owner_id,note=trim(coalesce(p_note,'')),
    resolution_note=case when p_status='completed' then trim(coalesce(p_resolution_note,'')) else '' end,
    due_at=p_due_at,updated_by=v_actor,updated_at=clock_timestamp()
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('spv_followup',v_row.id,v_actor,case when p_status='completed' then 'completed' else 'updated' end,
      coalesce(nullif(v_reason,''),nullif(trim(coalesce(p_resolution_note,'')),''),nullif(trim(coalesce(p_note,'')),''),'Tindak lanjut diperbarui'),
      to_jsonb(v_before),to_jsonb(v_row));

  -- A reminder already queued for an older revision remains an audit fact in
  -- the inbox, while undelivered external pushes are made stale atomically.
  update private.push_outbox o set abandoned_at=clock_timestamp(),lease_until=null,lease_token=null
    where o.delivered_at is null and o.abandoned_at is null and exists(
      select 1 from private.spv_followup_reminders r
      where r.notification_id=o.notification_id and r.followup_id=v_row.id and r.revision<v_row.revision
    );
  if p_owner_id is distinct from v_before.owner_id and p_owner_id is not null and p_owner_id<>v_actor then
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(p_owner_id,'spv_followup',v_row.id,'Tindak lanjut ditugaskan',
        'Ada tindak lanjut baru untuk Anda. Buka aplikasi untuk melihat rincian.',
        '/supervisor?case='||v_row.id::text);
  end if;
  v_result:=to_jsonb(v_row);
  update private.spv_followup_receipts set result=v_result where id=v_receipt.id;
  return v_result;
end;
$$;

-- Old tabs cannot provide an expected revision. Fail closed so an outdated
-- client asks for reload instead of silently overwriting another supervisor.
create or replace function public.spv_followup_update(
  p_id uuid,p_status text,p_owner_id uuid,p_note text,p_resolution_note text
) returns public.spv_followups language plpgsql security definer set search_path='' as $$
begin
  perform private.require_hr();
  raise exception 'Versi aplikasi tindak lanjut sudah diperbarui. Muat ulang aplikasi sebelum menyimpan' using errcode='40001';
end;
$$;

create function private.dispatch_spv_followup_due(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare v_case public.spv_followups; v_notification uuid; v_count integer:=0;
begin
  for v_case in
    select f.* from public.spv_followups f
    join public.employees e on e.id=f.owner_id
    where f.status<>'completed' and f.due_at is not null and f.due_at<=clock_timestamp()
      and e.status='active' and e.account_status='active'
      and not exists(select 1 from private.spv_followup_reminders r
        where r.followup_id=f.id and r.revision=f.revision and r.employee_id=f.owner_id)
    order by f.due_at,f.id
    limit least(greatest(coalesce(p_limit,100),1),500)
    for update of f skip locked
  loop
    insert into public.notifications(employee_id,entity_type,entity_id,title,body,href)
      values(v_case.owner_id,'spv_followup',v_case.id,'Tindak lanjut melewati tenggat',
        'Ada tindak lanjut yang memerlukan perhatian. Buka aplikasi untuk melihat rincian.',
        '/supervisor?case='||v_case.id::text) returning id into v_notification;
    insert into private.spv_followup_reminders(followup_id,revision,employee_id,due_at,notification_id)
      values(v_case.id,v_case.revision,v_case.owner_id,v_case.due_at,v_notification)
      on conflict do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end;
$$;

create or replace function private.dispatch_push_tick() returns void
language plpgsql security definer set search_path='' as $$
declare v_row record;
begin
  perform private.dispatch_spv_followup_due(100);
  for v_row in select a.id,a.employee_id from public.attendance a join public.employees e on e.id=a.employee_id
    where a.clock_out is null and a.clock_in<=clock_timestamp()-interval '8 hours' and a.clock_in>clock_timestamp()-interval '36 hours'
      and e.status='active' and e.account_status='active' and not exists(select 1 from private.attendance_reminders r where r.attendance_id=a.id) loop
    perform 1 from public.employees where id=v_row.employee_id for no key update;
    if not exists(select 1 from public.attendance where id=v_row.id and clock_out is null and clock_in<=clock_timestamp()-interval '8 hours') then continue; end if;
    insert into private.attendance_reminders(attendance_id) values(v_row.id) on conflict do nothing;
    if found then
      insert into public.notifications(employee_id,entity_id,entity_type,title,body,href)
        values(v_row.employee_id,v_row.id,'attendance_reminder','Periksa clock out','Durasi kerja sudah mencapai 8 jam. Periksa catatan absensi Anda.','/attendance?record='||v_row.id::text);
    end if;
  end loop;
  if exists(select 1 from private.push_outbox where delivered_at is null and abandoned_at is null and next_attempt_at<=clock_timestamp()) then perform private.wake_push_worker(); end if;
  delete from private.biometric_receipts where expires_at<clock_timestamp()-interval '1 day' and consumed_at is null;
  insert into private.biometric_cleanup(image_path)
    select m.image_path from private.biometric_material m join public.biometric_references r on r.id=m.reference_id
    where r.status in ('rejected','revoked') and coalesce(r.reviewed_at,r.created_at)<clock_timestamp()-interval '30 days' on conflict do nothing;
  delete from private.biometric_material m using public.biometric_references r where r.id=m.reference_id and r.status in ('rejected','revoked') and coalesce(r.reviewed_at,r.created_at)<clock_timestamp()-interval '30 days';
  if exists(select 1 from private.biometric_cleanup) then perform private.wake_push_worker(); end if;
end;
$$;

revoke all on function public.spv_followup_page(text,uuid,date,date,integer,jsonb),
  public.spv_followup_update_v2(uuid,bigint,uuid,text,uuid,text,text,timestamptz,text),
  private.dispatch_spv_followup_due(integer) from public,anon,authenticated;
grant execute on function public.spv_followup_page(text,uuid,date,date,integer,jsonb),
  public.spv_followup_update_v2(uuid,bigint,uuid,text,uuid,text,text,timestamptz,text) to authenticated;
