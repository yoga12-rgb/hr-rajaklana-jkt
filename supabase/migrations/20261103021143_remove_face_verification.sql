-- Retire identity matching. Preserve old face evidence/history without exposing
-- it to app callers; do not remove or modify reference data in this migration.
revoke all on table public.biometric_references from public,anon,authenticated,service_role;
revoke all on function public.biometric_server_material(uuid,boolean,boolean),
  public.biometric_enroll_server(uuid,text,text,jsonb),public.biometric_stage_reference(uuid,text),
  public.biometric_selfie_object(uuid,text),
  public.biometric_issue_receipt(uuid,uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text),
  public.biometric_review(uuid,text,text),public.biometric_withdraw(),
  public.attendance_clock_in(text,double precision,double precision,double precision,text),
  public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text),
  public.attendance_clock_in_verified(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid)
  from public,anon,authenticated,service_role;
alter publication supabase_realtime drop table public.biometric_references;

create table private.attendance_selfie_receipts (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
  selfie_path text not null, selfie_sha256 text not null check(selfie_sha256~'^[0-9a-f]{64}$'),
  storage_object_id uuid not null, shift text not null, latitude double precision not null,
  longitude double precision not null, accuracy_m double precision not null,
  geo_captured_at timestamptz not null, selfie_captured_at timestamptz not null, selfie_outlet_name text not null,
  assignment_id uuid not null references public.cashier_assignments(id), outlet_id uuid not null references public.outlets(id),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default(clock_timestamp()+interval '90 seconds'),
  consumed_at timestamptz
);
alter table private.attendance_selfie_receipts enable row level security;
revoke all on private.attendance_selfie_receipts from public,anon,authenticated,service_role;
create index attendance_selfie_receipts_live_path on private.attendance_selfie_receipts(selfie_path) where consumed_at is null;

create function public.attendance_selfie_object(p_employee_id uuid,p_selfie_path text)
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
create function public.attendance_issue_selfie_receipt(p_employee_id uuid,p_storage_object_id uuid,p_selfie_path text,p_selfie_sha256 text,p_shift text,
  p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,p_geo_captured_at timestamptz,
  p_selfie_captured_at timestamptz,p_selfie_outlet_name text)
returns table(id uuid,expires_at timestamptz) language plpgsql security definer set search_path='' as $$
declare v_employee public.employees; v_assignment public.cashier_assignments; v_outlet public.outlets; v_object uuid;
begin
  perform private.require_service();
  select * into strict v_employee from public.employees where employees.id=p_employee_id and status='active' and account_status='active' for no key update;
  if not v_employee.can_clock then raise exception 'Akses absensi tidak aktif'; end if;
  perform private.assert_fresh_capture(p_geo_captured_at); perform private.assert_fresh_capture(p_selfie_captured_at);
  select * into v_assignment from public.cashier_assignments where employee_id=p_employee_id and work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date and status='active' for share;
  if not found or v_assignment.shift='off' or v_assignment.shift<>p_shift then raise exception 'Penugasan shift berubah. Muat ulang jadwal'; end if;
  select * into strict v_outlet from public.outlets where outlets.id=v_assignment.outlet_id and active;
  perform private.validate_location(p_latitude,p_longitude,p_accuracy_m,v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,v_outlet.max_accuracy_m);
  -- Match employee-first ordering in the Storage deletion trigger. Locking the
  -- Storage tuple here would invert that ordering with DELETE's tuple lock.
  select o.id into v_object from storage.objects o where o.id=p_storage_object_id and bucket_id='attendance-selfies' and name=p_selfie_path;
  if v_object is null or split_part(p_selfie_path,'/',1)<>v_employee.auth_user_id::text or p_selfie_sha256 is null or p_selfie_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Selfie belum terverifikasi'; end if;
  return query insert into private.attendance_selfie_receipts(employee_id,selfie_path,selfie_sha256,storage_object_id,shift,latitude,longitude,accuracy_m,
    geo_captured_at,selfie_captured_at,selfie_outlet_name,assignment_id,outlet_id)
    values(p_employee_id,p_selfie_path,p_selfie_sha256,v_object,p_shift,p_latitude,p_longitude,p_accuracy_m,
      p_geo_captured_at,p_selfie_captured_at,p_selfie_outlet_name,v_assignment.id,v_assignment.outlet_id)
    returning attendance_selfie_receipts.id,attendance_selfie_receipts.expires_at;
end; $$;
create function public.attendance_clock_in_selfie(p_shift text,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,
  p_selfie_path text,p_selfie_captured_at timestamptz,p_selfie_outlet_name text,p_geo_captured_at timestamptz,p_verification_token uuid)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_receipt private.attendance_selfie_receipts; v_row public.attendance;
begin
  perform 1 from public.employees where employees.id=v_actor for no key update;
  select * into v_receipt from private.attendance_selfie_receipts where id=p_verification_token and employee_id=v_actor for update;
  if not found or v_receipt.consumed_at is not null or v_receipt.expires_at<clock_timestamp() then raise exception 'Verifikasi selfie telah berakhir. Ambil selfie baru'; end if;
  if row(v_receipt.selfie_path,v_receipt.shift,v_receipt.latitude,v_receipt.longitude,v_receipt.accuracy_m,v_receipt.geo_captured_at,v_receipt.selfie_captured_at,v_receipt.selfie_outlet_name)
    is distinct from row(p_selfie_path,p_shift,p_latitude,p_longitude,p_accuracy_m,p_geo_captured_at,p_selfie_captured_at,p_selfie_outlet_name) then raise exception 'Data absensi berubah setelah verifikasi. Ambil selfie baru'; end if;
  perform private.assert_fresh_capture(p_geo_captured_at); perform private.assert_fresh_capture(p_selfie_captured_at);
  if not exists(select 1 from public.cashier_assignments a where a.id=v_receipt.assignment_id and a.employee_id=v_actor and a.work_date=(clock_timestamp() at time zone 'Asia/Jakarta')::date and a.status='active' and a.shift=p_shift and a.outlet_id=v_receipt.outlet_id)
    or not exists(select 1 from storage.objects o where o.id=v_receipt.storage_object_id and o.bucket_id='attendance-selfies' and o.name=p_selfie_path)
    then raise exception 'Penugasan atau foto selfie berubah. Ulangi pengambilan selfie'; end if;
  v_row:=public.attendance_clock_in(p_shift,p_latitude,p_longitude,p_accuracy_m,p_selfie_path,p_selfie_captured_at,p_selfie_outlet_name);
  update private.attendance_selfie_receipts set consumed_at=clock_timestamp() where id=v_receipt.id;
  update public.attendance set selfie_sha256=v_receipt.selfie_sha256 where attendance.id=v_row.id returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.attendance_selfie_object(uuid,text),
  public.attendance_issue_selfie_receipt(uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text),
  public.attendance_clock_in_selfie(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.attendance_selfie_object(uuid,text),
  public.attendance_issue_selfie_receipt(uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text) to service_role;
grant execute on function public.attendance_clock_in_selfie(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid) to authenticated;

create or replace function private.upload_is_unreferenced(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select case p_bucket
    when 'attendance-selfies' then not exists(select 1 from public.attendance where selfie_path=p_path)
      and not exists(select 1 from private.biometric_receipts where selfie_path=p_path and consumed_at is null and expires_at>=clock_timestamp())
      and not exists(select 1 from private.attendance_selfie_receipts where selfie_path=p_path and consumed_at is null and expires_at>=clock_timestamp())
    when 'leave-attachments' then not exists(select 1 from public.leave_requests where attachment_path=p_path)
    when 'profile-photos' then not exists(select 1 from public.employees where photo_path=p_path)
    else false end;
$$;
create or replace function private.protect_verified_selfie_delete() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_employee uuid;
begin
  if old.bucket_id<>'attendance-selfies' then return old; end if;
  select id into v_employee from public.employees where auth_user_id::text=split_part(old.name,'/',1);
  perform 1 from public.employees where id=v_employee for no key update;
  if exists(select 1 from public.attendance where selfie_path=old.name)
    or exists(select 1 from private.biometric_receipts where selfie_path=old.name and consumed_at is null and expires_at>=clock_timestamp())
    or exists(select 1 from private.attendance_selfie_receipts where selfie_path=old.name and consumed_at is null and expires_at>=clock_timestamp()) then
    raise exception 'Selfie masih digunakan untuk bukti atau verifikasi absensi';
  end if;
  return old;
end; $$;
