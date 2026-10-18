-- Face references are explicitly consented, reviewed by a different HR employee,
-- and never exposed as browser-readable descriptors. Matching runs on the server.
create table public.biometric_references (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
  consent_version text not null check(consent_version='2026-10-18'),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.employees(id), reviewed_at timestamptz, review_note text,
  check(reviewed_by is distinct from employee_id)
);
create unique index biometric_one_pending on public.biometric_references(employee_id) where status='pending';
create unique index biometric_one_approved on public.biometric_references(employee_id) where status='approved';
alter table public.biometric_references enable row level security;
revoke all on public.biometric_references from public,anon,authenticated;
grant select on public.biometric_references to authenticated;
create policy biometric_reference_read on public.biometric_references for select to authenticated
  using(employee_id=(select private.employee_id()) or (select private.has_role('admin_hr')));
alter publication supabase_realtime add table public.biometric_references;
create table private.biometric_material (
  reference_id uuid primary key references public.biometric_references(id) on delete cascade,
  descriptor jsonb not null check(jsonb_typeof(descriptor)='array' and jsonb_array_length(descriptor)=128),
  image_path text not null, image_sha256 text not null check(image_sha256~'^[0-9a-f]{64}$'),
  model_id text not null check(model_id='face-api-1.7.15-v1')
);
alter table private.biometric_material enable row level security;
create table private.biometric_cleanup(image_path text primary key,queued_at timestamptz not null default now(),not_before timestamptz not null default now());
alter table private.biometric_cleanup enable row level security;
revoke all on private.biometric_cleanup from public,anon,authenticated,service_role;
create table private.biometric_receipts (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
  reference_id uuid not null references public.biometric_references(id),
  selfie_path text not null, selfie_sha256 text not null check(selfie_sha256~'^[0-9a-f]{64}$'),
  storage_object_id uuid not null, shift text not null, latitude double precision not null,
  longitude double precision not null, accuracy_m double precision not null,
  geo_captured_at timestamptz not null, selfie_captured_at timestamptz not null, selfie_outlet_name text not null,
  assignment_id uuid not null references public.cashier_assignments(id), outlet_id uuid not null references public.outlets(id),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default(clock_timestamp()+interval '90 seconds'),
  consumed_at timestamptz
);
alter table private.biometric_receipts enable row level security;
revoke all on private.biometric_material,private.biometric_receipts from public,anon,authenticated,service_role;
alter table public.attendance add column biometric_reference_id uuid references public.biometric_references(id),
  add column biometric_model_id text, add column selfie_sha256 text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('biometric-references','biometric-references',false,2097152,array['image/jpeg'])
  on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg'];
-- No Storage policy grants reference-image access to clients. The authenticated
-- API creates short-lived signed URLs only for a different active HR reviewer.

create function public.biometric_server_material(p_employee_id uuid,p_pending boolean default false,p_all boolean default false)
returns table(id uuid,employee_id uuid,status text,descriptor jsonb,image_path text,model_id text)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_service();
  return query select r.id,r.employee_id,r.status,m.descriptor,m.image_path,m.model_id
    from public.biometric_references r join private.biometric_material m on m.reference_id=r.id
    where r.employee_id=p_employee_id and (p_all or r.status='approved' or (p_pending and r.status='pending'))
    order by r.created_at desc;
end; $$;
create function public.biometric_enroll_server(p_employee_id uuid,p_image_path text,p_image_sha256 text,p_descriptor jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_user uuid;
begin
  perform private.require_service();
  select auth_user_id into strict v_user from public.employees where id=p_employee_id and status='active' and account_status='active' for no key update;
  if p_image_path not like v_user::text||'/%' or not exists(select 1 from storage.objects where bucket_id='biometric-references' and name=p_image_path) then raise exception 'Foto referensi belum tersimpan'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_descriptor) x where x::double precision not between -10 and 10) then raise exception 'Descriptor tidak valid'; end if;
  insert into public.biometric_references(employee_id,consent_version) values(p_employee_id,'2026-10-18') returning id into v_id;
  insert into private.biometric_material(reference_id,descriptor,image_path,image_sha256,model_id)
    values(v_id,p_descriptor,p_image_path,p_image_sha256,'face-api-1.7.15-v1');
  delete from private.biometric_cleanup where image_path=p_image_path;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason)
    values('biometric_reference',v_id,p_employee_id,'submitted','Persetujuan penggunaan referensi wajah versi 2026-10-18');
  return v_id;
end; $$;
create function public.biometric_stage_reference(p_employee_id uuid,p_image_path text)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
  perform private.require_service();
  select auth_user_id into strict v_user from public.employees where id=p_employee_id and status='active' and account_status='active';
  if p_image_path not like v_user::text||'/%' then raise exception 'Lokasi referensi tidak valid'; end if;
  -- Stage before uploading. Successful enrollment removes this row in the same
  -- transaction as material insertion; an ambiguous failure cannot orphan a file
  -- or accidentally delete a reference whose commit actually succeeded.
  insert into private.biometric_cleanup(image_path,not_before) values(p_image_path,clock_timestamp()+interval '10 minutes') on conflict do nothing;
end; $$;
create function public.biometric_review(p_id uuid,p_decision text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_row public.biometric_references; v_employee uuid;
begin
  select employee_id into strict v_employee from public.biometric_references where id=p_id;
  perform 1 from public.employees where id=v_employee for no key update;
  select * into strict v_row from public.biometric_references where id=p_id for update;
  if v_row.employee_id=v_actor then raise exception 'Referensi wajah sendiri harus ditinjau HR lain'; end if;
  if v_row.status<>'pending' then raise exception 'Referensi sudah diproses'; end if;
  if p_decision not in ('approved','rejected') or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Keputusan dan alasan tinjauan wajib diisi'; end if;
  if p_decision='approved' then
    update public.biometric_references set status='revoked' where employee_id=v_row.employee_id and status='approved';
  end if;
  update public.biometric_references set status=p_decision,reviewed_by=v_actor,reviewed_at=now(),review_note=btrim(p_reason) where id=p_id;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason)
    values('biometric_reference',p_id,v_actor,p_decision,btrim(p_reason));
end; $$;
create function public.biometric_withdraw()
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee();
begin
  perform 1 from public.employees where id=v_actor for no key update;
  update public.biometric_references set status='revoked' where employee_id=v_actor and status in ('pending','approved');
  insert into private.biometric_cleanup(image_path) select image_path from private.biometric_material where reference_id in(select id from public.biometric_references where employee_id=v_actor) on conflict do nothing;
  delete from private.biometric_material where reference_id in(select id from public.biometric_references where employee_id=v_actor);
  delete from private.biometric_receipts where employee_id=v_actor and consumed_at is null;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason)
    values('employee',v_actor,v_actor,'biometric_consent_withdrawn','Persetujuan referensi wajah dicabut');
end; $$;
create function private.assert_fresh_capture(p_at timestamptz)
returns void language plpgsql volatile set search_path='' as $$
begin
  if p_at is null or not isfinite(p_at) or p_at<clock_timestamp()-interval '60 seconds' or p_at>clock_timestamp()+interval '10 seconds' then
    raise exception 'Foto atau lokasi sudah terlalu lama. Ambil lokasi dan selfie baru';
  end if;
end; $$;
create function public.biometric_selfie_object(p_employee_id uuid,p_selfie_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_object uuid; v_auth uuid;
begin
  perform private.require_service();
  select auth_user_id into strict v_auth from public.employees where id=p_employee_id and status='active' and account_status='active';
  if split_part(p_selfie_path,'/',1)<>v_auth::text then raise exception 'Selfie bukan milik akun ini'; end if;
  select id into v_object from storage.objects where bucket_id='attendance-selfies' and name=p_selfie_path;
  if v_object is null then raise exception 'Selfie belum tersimpan'; end if;
  return v_object;
end; $$;
create function public.biometric_issue_receipt(p_employee_id uuid,p_reference_id uuid,p_storage_object_id uuid,p_selfie_path text,p_selfie_sha256 text,p_shift text,
  p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,p_geo_captured_at timestamptz,
  p_selfie_captured_at timestamptz,p_selfie_outlet_name text)
returns table(id uuid,expires_at timestamptz) language plpgsql security definer set search_path='' as $$
declare v_employee public.employees; v_assignment public.cashier_assignments; v_outlet public.outlets; v_reference uuid; v_object uuid;
begin
  perform private.require_service();
  select * into strict v_employee from public.employees where employees.id=p_employee_id and status='active' and account_status='active' for no key update;
  if not v_employee.can_clock then raise exception 'Akses absensi tidak aktif'; end if;
  perform private.assert_fresh_capture(p_geo_captured_at); perform private.assert_fresh_capture(p_selfie_captured_at);
  select * into v_assignment from public.cashier_assignments where employee_id=p_employee_id and work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date and status='active' for share;
  if not found or v_assignment.shift='off' or v_assignment.shift<>p_shift then raise exception 'Penugasan shift berubah. Muat ulang jadwal'; end if;
  select * into strict v_outlet from public.outlets where outlets.id=v_assignment.outlet_id and active;
  perform private.validate_location(p_latitude,p_longitude,p_accuracy_m,v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,v_outlet.max_accuracy_m);
  select r.id into v_reference from public.biometric_references r where r.id=p_reference_id and r.employee_id=p_employee_id and r.status='approved' for share;
  if v_reference is null then raise exception 'Referensi wajah belum disetujui HR'; end if;
  -- The DELETE guard serializes on the employee and rechecks after waiting.
  -- Do not lock the Storage tuple here: DELETE obtains its tuple lock before
  -- its trigger runs, which would invert employee/Storage lock ordering.
  select o.id into v_object from storage.objects o where o.id=p_storage_object_id and bucket_id='attendance-selfies' and name=p_selfie_path;
  if v_object is null or split_part(p_selfie_path,'/',1)<>v_employee.auth_user_id::text or p_selfie_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Selfie belum terverifikasi'; end if;
  return query insert into private.biometric_receipts(employee_id,reference_id,selfie_path,selfie_sha256,storage_object_id,shift,latitude,longitude,accuracy_m,
    geo_captured_at,selfie_captured_at,selfie_outlet_name,assignment_id,outlet_id)
    values(p_employee_id,v_reference,p_selfie_path,p_selfie_sha256,v_object,p_shift,p_latitude,p_longitude,p_accuracy_m,
      p_geo_captured_at,p_selfie_captured_at,p_selfie_outlet_name,v_assignment.id,v_assignment.outlet_id)
    returning biometric_receipts.id,biometric_receipts.expires_at;
end; $$;
create function public.attendance_clock_in_verified(p_shift text,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,
  p_selfie_path text,p_selfie_captured_at timestamptz,p_selfie_outlet_name text,p_geo_captured_at timestamptz,p_verification_token uuid)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_receipt private.biometric_receipts; v_row public.attendance;
begin
  perform 1 from public.employees where employees.id=v_actor for no key update;
  select * into v_receipt from private.biometric_receipts where id=p_verification_token and employee_id=v_actor for update;
  if not found or v_receipt.consumed_at is not null or v_receipt.expires_at<clock_timestamp() then raise exception 'Verifikasi selfie telah berakhir. Ambil selfie baru'; end if;
  if row(v_receipt.selfie_path,v_receipt.shift,v_receipt.latitude,v_receipt.longitude,v_receipt.accuracy_m,v_receipt.geo_captured_at,v_receipt.selfie_captured_at,v_receipt.selfie_outlet_name)
    is distinct from row(p_selfie_path,p_shift,p_latitude,p_longitude,p_accuracy_m,p_geo_captured_at,p_selfie_captured_at,p_selfie_outlet_name) then raise exception 'Data absensi berubah setelah verifikasi. Ambil selfie baru'; end if;
  perform private.assert_fresh_capture(p_geo_captured_at); perform private.assert_fresh_capture(p_selfie_captured_at);
  if not exists(select 1 from public.cashier_assignments a where a.id=v_receipt.assignment_id and a.employee_id=v_actor and a.work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date and a.status='active' and a.shift=p_shift and a.outlet_id=v_receipt.outlet_id)
    or not exists(select 1 from public.biometric_references r where r.id=v_receipt.reference_id and r.status='approved')
    or not exists(select 1 from storage.objects o where o.id=v_receipt.storage_object_id and o.bucket_id='attendance-selfies' and o.name=p_selfie_path)
    then raise exception 'Penugasan atau referensi selfie berubah. Ulangi verifikasi'; end if;
  v_row:=public.attendance_clock_in(p_shift,p_latitude,p_longitude,p_accuracy_m,p_selfie_path,p_selfie_captured_at,p_selfie_outlet_name);
  update private.biometric_receipts set consumed_at=clock_timestamp() where id=v_receipt.id;
  update public.attendance set biometric_reference_id=v_receipt.reference_id,biometric_model_id='face-api-1.7.15-v1',selfie_sha256=v_receipt.selfie_sha256 where attendance.id=v_row.id returning * into v_row;
  return v_row;
end; $$;
create function public.attendance_clock_out_fresh(p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,p_geo_captured_at timestamptz)
returns public.attendance language plpgsql security definer set search_path='' as $$
begin perform private.require_employee(); perform private.assert_fresh_capture(p_geo_captured_at);
  return public.attendance_clock_out(p_latitude,p_longitude,p_accuracy_m);
end; $$;
revoke all on function public.attendance_clock_in(text,double precision,double precision,double precision,text),
  public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text),
  public.attendance_clock_out(double precision,double precision,double precision) from public,anon,authenticated;
revoke all on function public.biometric_server_material(uuid,boolean,boolean),public.biometric_enroll_server(uuid,text,text,jsonb),
  public.biometric_stage_reference(uuid,text),
  public.biometric_selfie_object(uuid,text),public.biometric_issue_receipt(uuid,uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text),
  public.biometric_review(uuid,text,text),public.biometric_withdraw(),private.assert_fresh_capture(timestamptz),
  public.attendance_clock_in_verified(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid),
  public.attendance_clock_out_fresh(double precision,double precision,double precision,timestamptz) from public,anon,authenticated;
grant execute on function public.biometric_server_material(uuid,boolean,boolean),public.biometric_enroll_server(uuid,text,text,jsonb),
  public.biometric_stage_reference(uuid,text),
  public.biometric_selfie_object(uuid,text),public.biometric_issue_receipt(uuid,uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text) to service_role;
grant execute on function public.biometric_review(uuid,text,text),public.biometric_withdraw(),
  public.attendance_clock_in_verified(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid),
  public.attendance_clock_out_fresh(double precision,double precision,double precision,timestamptz) to authenticated;
create function public.biometric_cleanup_claim()
returns table(image_path text) language plpgsql security definer set search_path='' as $$
begin perform private.require_service(); return query select q.image_path from private.biometric_cleanup q
  where q.not_before<=clock_timestamp() and not exists(select 1 from private.biometric_material m where m.image_path=q.image_path)
  order by q.queued_at limit 30; end; $$;
create function public.biometric_cleanup_complete(p_image_path text)
returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_service(); delete from private.biometric_cleanup where image_path=p_image_path; end; $$;
revoke all on function public.biometric_cleanup_claim(),public.biometric_cleanup_complete(text) from public,anon,authenticated;
grant execute on function public.biometric_cleanup_claim(),public.biometric_cleanup_complete(text) to service_role;

create or replace function private.upload_is_unreferenced(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select case p_bucket
    when 'attendance-selfies' then not exists(select 1 from public.attendance where selfie_path=p_path)
      and not exists(select 1 from private.biometric_receipts where selfie_path=p_path and consumed_at is null and expires_at>=clock_timestamp())
    when 'leave-attachments' then not exists(select 1 from public.leave_requests where attachment_path=p_path)
    when 'profile-photos' then not exists(select 1 from public.employees where photo_path=p_path)
    else false end;
$$;
create function private.protect_verified_selfie_delete() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_employee uuid;
begin
  if old.bucket_id<>'attendance-selfies' then return old; end if;
  select id into v_employee from public.employees where auth_user_id::text=split_part(old.name,'/',1);
  -- Lock ordering matches receipt issuance/consumption. Recheck after the lock,
  -- using a fresh PL/pgSQL command snapshot rather than the DELETE's RLS snapshot.
  perform 1 from public.employees where id=v_employee for no key update;
  if exists(select 1 from public.attendance where selfie_path=old.name)
    or exists(select 1 from private.biometric_receipts where selfie_path=old.name and consumed_at is null and expires_at>=clock_timestamp()) then
    raise exception 'Selfie masih digunakan untuk bukti atau verifikasi absensi';
  end if;
  return old;
end; $$;
revoke all on function private.protect_verified_selfie_delete() from public,anon,authenticated;
create trigger protect_verified_selfie_delete before delete on storage.objects for each row execute function private.protect_verified_selfie_delete();

-- Per-device opt-in, durable delivery queue, short claim leases and bounded
-- retries. All payloads delivered outside the app are intentionally generic.
create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),
  endpoint text not null unique,p256dh text not null,auth_key text not null,device text not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),disabled_at timestamptz
);
create table private.push_outbox (
  id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
  created_at timestamptz not null default now(),attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
  delivered_at timestamptz,abandoned_at timestamptz,last_error_code integer,
  unique(notification_id,subscription_id)
);
create index push_outbox_due on private.push_outbox(next_attempt_at) where delivered_at is null and abandoned_at is null;
create table private.push_worker_config(singleton boolean primary key default true check(singleton),url text not null,wake_secret text not null);
create table private.attendance_reminders(attendance_id uuid primary key references public.attendance(id),created_at timestamptz not null default now());
alter table private.push_subscriptions enable row level security;
alter table private.push_outbox enable row level security;
alter table private.push_worker_config enable row level security;
alter table private.attendance_reminders enable row level security;
revoke all on private.push_subscriptions,private.push_outbox,private.push_worker_config,private.attendance_reminders from public,anon,authenticated,service_role;

create function public.push_subscribe(p_endpoint text,p_p256dh text,p_auth text,p_device text default 'Browser')
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee();
begin
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]#@]+$'
    or length(p_endpoint)>2048 or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Langganan notifikasi tidak valid'; end if;
  if (select count(*) from private.push_subscriptions where employee_id=v_actor and disabled_at is null and endpoint<>p_endpoint)>=10 then raise exception 'Batas perangkat notifikasi tercapai'; end if;
  -- A shared browser may switch accounts: endpoint ownership moves atomically,
  -- and its old recipient queue is discarded before it can send to the new user.
  delete from private.push_outbox where subscription_id in(select id from private.push_subscriptions where endpoint=p_endpoint and employee_id<>v_actor);
  insert into private.push_subscriptions(employee_id,endpoint,p256dh,auth_key,device) values(v_actor,p_endpoint,p_p256dh,p_auth,left(coalesce(p_device,'Browser'),100))
    on conflict(endpoint) do update set employee_id=v_actor,p256dh=p_p256dh,auth_key=p_auth,device=excluded.device,disabled_at=null,updated_at=now();
end; $$;
create function public.push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee();
begin update private.push_subscriptions set disabled_at=now() where employee_id=v_actor and endpoint=p_endpoint; end; $$;

create function private.wake_push_worker() returns void language plpgsql security definer set search_path='' as $$
declare v_config private.push_worker_config;
begin
  select * into v_config from private.push_worker_config where singleton;
  if not found or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  -- Dedicated wake-only credential; never enqueue a service-role key or a VAPID
  -- private key in pg_net headers. Waking cannot create notifications or read HR.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using v_config.url,'{}'::jsonb,jsonb_build_object('Content-Type','application/json','x-hr-push-wake',v_config.wake_secret);
exception when others then
  -- Delivery is retried by cron; a push infrastructure failure must not roll
  -- back the employee's approved leave or attendance correction.
  null;
end; $$;
create function private.enqueue_notification_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.push_outbox(notification_id,subscription_id)
    select new.id,s.id from private.push_subscriptions s where s.employee_id=new.employee_id and s.disabled_at is null
    on conflict(notification_id,subscription_id) do nothing;
  if found then perform private.wake_push_worker(); end if;
  return new;
end; $$;
create trigger notification_push_outbox after insert on public.notifications for each row execute function private.enqueue_notification_push();
create function public.push_claim(p_limit integer default 30)
returns table(id uuid,lease_token uuid,endpoint text,p256dh text,auth_key text)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_service();
  update private.push_outbox set abandoned_at=clock_timestamp() where delivered_at is null and abandoned_at is null and attempts>=8 and (lease_until is null or lease_until<clock_timestamp());
  -- Skip notifications already read in the app and disabled/inactive recipients.
  update private.push_outbox o set abandoned_at=now() where delivered_at is null and abandoned_at is null and
    not exists(select 1 from public.notifications n join private.push_subscriptions s on s.id=o.subscription_id
      join public.employees e on e.id=n.employee_id where n.id=o.notification_id and n.read_at is null and n.employee_id=s.employee_id and s.disabled_at is null and e.status='active' and e.account_status='active');
  return query with claimed as (
    select o.id from private.push_outbox o where o.delivered_at is null and o.abandoned_at is null and o.next_attempt_at<=clock_timestamp()
      and (o.lease_until is null or o.lease_until<clock_timestamp()) and o.attempts<8 order by o.next_attempt_at limit least(greatest(p_limit,1),100) for update skip locked
  ), updated as (
    update private.push_outbox o set attempts=attempts+1,lease_until=clock_timestamp()+interval '90 seconds',lease_token=gen_random_uuid()
      from claimed c where o.id=c.id returning o.id,o.lease_token,o.subscription_id
  ) select u.id,u.lease_token,s.endpoint,s.p256dh,s.auth_key from updated u join private.push_subscriptions s on s.id=u.subscription_id;
end; $$;
create function public.push_complete(p_id uuid,p_lease_token uuid,p_status integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_row private.push_outbox;
begin
  perform private.require_service();
  select * into v_row from private.push_outbox where id=p_id and lease_token=p_lease_token and delivered_at is null and abandoned_at is null for update;
  if not found then return; end if;
  if p_status in (404,410) then update private.push_subscriptions set disabled_at=now() where id=v_row.subscription_id; end if;
  update private.push_outbox set lease_until=null,lease_token=null,last_error_code=p_status,
    delivered_at=case when p_status between 200 and 299 then clock_timestamp() else null end,
    abandoned_at=case when p_status in (400,404,410,413) or attempts>=8 then clock_timestamp() else null end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,15*power(2,attempts)::integer)) where push_outbox.id=v_row.id;
end; $$;
create function private.dispatch_push_tick() returns void language plpgsql security definer set search_path='' as $$
declare v_row record;
begin
  -- Remind once per currently open attendance, never alter clock-out times.
  for v_row in select a.id,a.employee_id from public.attendance a join public.employees e on e.id=a.employee_id
    where a.clock_out is null and a.clock_in<=clock_timestamp()-interval '8 hours' and a.clock_in>clock_timestamp()-interval '36 hours'
      and e.status='active' and e.account_status='active' and not exists(select 1 from private.attendance_reminders r where r.attendance_id=a.id) loop
    -- Clock mutations lock employee before attendance. Keep the same ordering,
    -- then recheck the current open state after waiting for concurrent clock-out.
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
end; $$;
create function public.push_configure_worker(p_url text,p_wake_secret text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_service();
  if p_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/push-dispatch$' or length(p_wake_secret)<32 then raise exception 'Invalid push worker configuration'; end if;
  insert into private.push_worker_config(singleton,url,wake_secret) values(true,p_url,p_wake_secret)
    on conflict(singleton) do update set url=excluded.url,wake_secret=excluded.wake_secret;
end; $$;
revoke all on function public.push_subscribe(text,text,text,text),public.push_unsubscribe(text),public.push_claim(integer),
  public.push_complete(uuid,uuid,integer),public.push_configure_worker(text,text),private.wake_push_worker(),private.enqueue_notification_push(),private.dispatch_push_tick() from public,anon,authenticated;
grant execute on function public.push_subscribe(text,text,text,text),public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_claim(integer),public.push_complete(uuid,uuid,integer),public.push_configure_worker(text,text) to service_role;
-- Hosted Supabase supplies these extensions. PGlite lacks them; all queue,
-- authorization, retry and reminder functions remain testable without networking.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_net') then execute 'create extension if not exists pg_net'; end if;
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.schedule('hr-push-minute','* * * * *','select private.dispatch_push_tick()');
  end if;
end $$;
