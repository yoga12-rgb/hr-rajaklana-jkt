-- Rajaklana Jabodetabek: database-owned authorization, timestamps and balances.
-- Apply through Supabase migrations. No credentials or operational employee data.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create sequence public.employee_number_seq;
create sequence public.outlet_code_seq;
create function private.next_employee_number() returns text language sql volatile set search_path='' as $$
  select 'RK'||case when length(n::text)<6 then lpad(n::text,6,'0') else n::text end from(select nextval('public.employee_number_seq') n) s;
$$;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  name text not null check (length(trim(name)) between 2 and 100),
  is_cashier boolean not null default false,
  active boolean not null default true,
  unique(department_id, name)
);
create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('OUT' || lpad(nextval('public.outlet_code_seq')::text, 4, '0')),
  name text not null unique check (length(trim(name)) between 2 and 100),
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  radius_m integer not null default 100 check (radius_m between 20 and 1000),
  max_accuracy_m integer not null default 100 check (max_accuracy_m between 10 and 500),
  opens_at time not null default '07:00',
  closes_at time not null default '23:00',
  morning_starts_at time not null default '07:00',
  afternoon_starts_at time not null default '15:00',
  late_tolerance_minutes integer not null default 0 check (late_tolerance_minutes between 0 and 60),
  production_location boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique default private.next_employee_number(),
  auth_user_id uuid unique references auth.users(id),
  full_name text not null check (length(trim(full_name)) between 2 and 150),
  whatsapp text not null check (length(whatsapp) between 8 and 30),
  department_id uuid not null references public.departments(id),
  position_id uuid not null references public.positions(id),
  outlet_id uuid not null references public.outlets(id),
  approver_employee_id uuid references public.employees(id),
  approval_mode text not null default 'internal' check (approval_mode in ('internal', 'external')),
  starts_on date not null,
  employment_type text not null default 'permanent' check (employment_type = 'permanent'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  account_status text not null default 'uninvited' check (account_status in ('uninvited', 'pending', 'active', 'disabled')),
  ends_on date,
  exit_reason text,
  can_clock boolean not null default false,
  can_middle_shift boolean not null default false,
  weekly_off_days integer[] not null default '{0}',
  birthday date,
  gender text check (gender in ('male', 'female', 'unspecified')),
  address text,
  emergency_name text,
  emergency_phone text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approver_employee_id is distinct from id),
  check (weekly_off_days <@ array[0,1,2,3,4,5,6] and cardinality(weekly_off_days) < 7),
  check (ends_on is null or ends_on >= starts_on)
);
create table public.employee_roles (
  employee_id uuid not null references public.employees(id),
  role text not null check (role in ('employee', 'admin_hr', 'head_baker')),
  primary key(employee_id, role)
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id uuid not null,
  actor_employee_id uuid references public.employees(id),
  action text not null,
  reason text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.account_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  purpose text not null check (purpose in ('activation', 'reset')),
  token_hash text not null unique check (length(token_hash) = 64),
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  revoked_at timestamptz,
  claimed_at timestamptz,
  claim_id uuid,
  consumed_at timestamptz
);

create function private.employee_id() returns uuid language sql stable security definer
set search_path = '' as $$
  select id from public.employees where auth_user_id = auth.uid()
    and status = 'active' and account_status = 'active';
$$;
create function private.has_role(p_role text) returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.employee_roles where employee_id = private.employee_id() and role = p_role);
$$;
create function private.require_employee() returns uuid language plpgsql stable security definer
set search_path = '' as $$
declare v_id uuid := private.employee_id();
begin
  if v_id is null then raise exception 'Akun karyawan tidak aktif' using errcode='42501'; end if;
  return v_id;
end;
$$;
create function private.require_hr() returns uuid language plpgsql stable security definer
set search_path = '' as $$
begin
  if not private.has_role('admin_hr') then raise exception 'Akses Admin HR diperlukan' using errcode='42501'; end if;
  return private.require_employee();
end;
$$;
create function private.require_service() returns void language plpgsql stable security definer
set search_path = '' as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server only' using errcode='42501'; end if;
end;
$$;
create function private.assert_approver(p_employee_id uuid) returns uuid language plpgsql stable security definer
set search_path = '' as $$
declare v_actor uuid := private.require_employee(); v_employee public.employees;
begin
  select * into strict v_employee from public.employees where id = p_employee_id;
  if v_actor = p_employee_id then raise exception 'Pengajuan sendiri tidak boleh diproses'; end if;
  if v_employee.approval_mode = 'external' then
    perform private.require_hr();
  elsif v_employee.approver_employee_id is distinct from v_actor then
    raise exception 'Anda bukan pemberi persetujuan pengajuan ini' using errcode='42501';
  end if;
  return v_actor;
end;
$$;
create function private.is_approver(p_employee_id uuid) returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.employees where id=p_employee_id and approver_employee_id=private.employee_id());
$$;
create function public.employee_directory() returns table(id uuid,employee_number text,full_name text,position_id uuid,outlet_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_employee();
  return query select e.id,e.employee_number,e.full_name,e.position_id,e.outlet_id from public.employees e where e.status='active';
end;
$$;

-- Only approved columns can be changed by the employee. Work data stays HR-owned.
create function public.update_my_profile(p_profile jsonb) returns public.employees
language plpgsql security definer set search_path='' as $$
declare v_row public.employees; v_id uuid := private.require_employee();
begin
  if exists(select 1 from jsonb_object_keys(p_profile) k where k not in
    ('address','emergency_name','emergency_phone','photo_path')) then raise exception 'Kolom profil tidak diizinkan'; end if;
  update public.employees set
    address=case when p_profile ? 'address' then p_profile->>'address' else address end,
    emergency_name=case when p_profile ? 'emergency_name' then p_profile->>'emergency_name' else emergency_name end,
    emergency_phone=case when p_profile ? 'emergency_phone' then p_profile->>'emergency_phone' else emergency_phone end,
    photo_path=case when p_profile ? 'photo_path' then p_profile->>'photo_path' else photo_path end,
    updated_at=now() where id=v_id returning * into v_row;
  return v_row;
end;
$$;

create function public.hr_save_employee(p_employee jsonb, p_id uuid default null, p_reason text default 'Pembaruan data karyawan')
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
    select * into strict v_before from public.employees where id=p_id for update;
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

create function public.hr_set_roles(p_employee_id uuid,p_roles text[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_actor uuid := private.require_hr();
begin
  if not p_roles <@ array['employee','admin_hr','head_baker'] then raise exception 'Hak akses tidak valid'; end if;
  if v_actor=p_employee_id then raise exception 'Hak akses sendiri tidak dapat diubah'; end if;
  perform 1 from public.employees where id=p_employee_id and status='active' for update;
  if not found then raise exception 'Karyawan aktif tidak ditemukan'; end if;
  delete from public.employee_roles where employee_id=p_employee_id;
  insert into public.employee_roles(employee_id,role) select p_employee_id, unnest(array_append(p_roles,'employee')) on conflict do nothing;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,after_data)
    values('employee',p_employee_id,v_actor,'roles_updated',jsonb_build_object('roles',p_roles));
end;
$$;

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  outlet_id uuid not null references public.outlets(id),
  work_date date not null,
  shift text not null check (shift in ('morning','afternoon','middle')),
  expected_in timestamptz,
  expected_out timestamptz not null,
  morning_starts_at time not null,
  afternoon_starts_at time not null,
  required_minutes integer not null default 480 check (required_minutes=480),
  tolerance_minutes integer not null,
  outlet_latitude double precision not null,
  outlet_longitude double precision not null,
  radius_m integer not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  in_latitude double precision not null,
  in_longitude double precision not null,
  in_accuracy_m double precision not null,
  in_distance_m double precision not null,
  out_latitude double precision,
  out_longitude double precision,
  out_accuracy_m double precision,
  out_distance_m double precision,
  selfie_path text not null,
  late_minutes integer not null default 0 check (late_minutes>=0),
  worked_minutes integer,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out >= clock_in)
);
create unique index attendance_one_open on public.attendance(employee_id) where clock_out is null;
create unique index attendance_one_per_day on public.attendance(employee_id,work_date);
create index attendance_outlet_date on public.attendance(outlet_id,work_date desc);
create function private.distance_m(p_lat1 double precision,p_lng1 double precision,p_lat2 double precision,p_lng2 double precision)
returns double precision language sql immutable set search_path='' as $$
  select 6371000 * 2 * asin(sqrt(least(1.0,greatest(0.0,
    power(sin(radians(p_lat2-p_lat1)/2),2) + cos(radians(p_lat1))*cos(radians(p_lat2))*power(sin(radians(p_lng2-p_lng1)/2),2)))));
$$;
create function private.validate_location(p_lat double precision,p_lng double precision,p_accuracy double precision,
  p_outlet_lat double precision,p_outlet_lng double precision,p_radius integer,p_max_accuracy integer)
returns double precision language plpgsql immutable set search_path='' as $$
declare v_distance double precision;
begin
  if p_lat is null or p_lng is null or p_accuracy is null or p_lat not between -90 and 90
    or p_lng not between -180 and 180 or p_accuracy<=0 or p_accuracy>p_max_accuracy then
    raise exception 'Lokasi belum cukup akurat. Aktifkan lokasi dan coba kembali'; end if;
  if p_outlet_lat is null or p_outlet_lng is null then raise exception 'Lokasi outlet belum diatur oleh HR'; end if;
  v_distance:=private.distance_m(p_lat,p_lng,p_outlet_lat,p_outlet_lng);
  if v_distance>p_radius then raise exception 'Anda berada di luar radius outlet'; end if;
  return v_distance;
end;
$$;
create function public.attendance_clock_in(p_shift text,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_selfie_path text) returns public.attendance
language plpgsql security definer set search_path='' as $$
declare v_employee public.employees; v_outlet public.outlets; v_now timestamptz:=clock_timestamp();
  v_date date:=(v_now at time zone 'Asia/Jakarta')::date; v_expected timestamptz;
  v_distance double precision; v_row public.attendance;
begin
  select * into strict v_employee from public.employees where id=private.require_employee() for update;
  if not v_employee.can_clock then raise exception 'Clock in hanya tersedia untuk kasir yang diizinkan'; end if;
  if p_shift not in ('morning','afternoon','middle') or p_shift is null then raise exception 'Shift tidak valid'; end if;
  if p_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan oleh SPV'; end if;
  select * into strict v_outlet from public.outlets where id=v_employee.outlet_id and active;
  v_distance:=private.validate_location(p_latitude,p_longitude,p_accuracy_m,v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,v_outlet.max_accuracy_m);
  if p_selfie_path is null or split_part(p_selfie_path,'/',1)<>auth.uid()::text
    or not exists(select 1 from storage.objects where bucket_id='attendance-selfies' and name=p_selfie_path) then
    raise exception 'Selfie wajib diunggah sebelum clock in'; end if;
  if exists(select 1 from public.attendance where selfie_path=p_selfie_path) then raise exception 'Gunakan selfie baru untuk setiap clock in'; end if;
  v_expected:=case p_shift when 'morning' then (v_date+v_outlet.morning_starts_at) at time zone 'Asia/Jakarta'
    when 'afternoon' then (v_date+v_outlet.afternoon_starts_at) at time zone 'Asia/Jakarta' else null end;
  insert into public.attendance(employee_id,outlet_id,work_date,shift,expected_in,expected_out,morning_starts_at,afternoon_starts_at,tolerance_minutes,
    outlet_latitude,outlet_longitude,radius_m,clock_in,in_latitude,in_longitude,in_accuracy_m,in_distance_m,selfie_path,late_minutes)
  values(v_employee.id,v_outlet.id,v_date,p_shift,v_expected,coalesce(v_expected,v_now)+interval '8 hours',v_outlet.morning_starts_at,v_outlet.afternoon_starts_at,
    v_outlet.late_tolerance_minutes,v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,v_now,p_latitude,p_longitude,
    p_accuracy_m,v_distance,p_selfie_path,
    case when v_expected is null or v_now<=v_expected+make_interval(mins=>v_outlet.late_tolerance_minutes) then 0
    else ceil(extract(epoch from(v_now-v_expected))/60)::integer end) returning * into v_row;
  return v_row;
exception when unique_violation then raise exception 'Clock in hari ini sudah tercatat atau clock out sebelumnya belum selesai';
end;
$$;
create function public.attendance_clock_out(p_latitude double precision,p_longitude double precision,p_accuracy_m double precision)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.attendance; v_now timestamptz:=clock_timestamp();
  v_accuracy integer; v_distance double precision;
begin
  perform 1 from public.employees where id=v_actor for update;
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
create function public.attendance_correct(p_id uuid,p_clock_in timestamptz,p_clock_out timestamptz,p_reason text,p_shift text default null)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.attendance; v_row public.attendance; v_shift text; v_expected timestamptz;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Alasan koreksi wajib diisi'; end if;
  select * into strict v_before from public.attendance where id=p_id for update;
  if v_actor=v_before.employee_id then raise exception 'Catatan absensi sendiri tidak boleh dikoreksi'; end if;
  if p_clock_in is null or p_clock_in>now() or p_clock_out>now() or p_clock_out<p_clock_in then raise exception 'Waktu koreksi tidak valid'; end if;
  if (p_clock_in at time zone 'Asia/Jakarta')::date<>v_before.work_date then raise exception 'Tanggal kerja tidak dapat diubah'; end if;
  v_shift:=coalesce(p_shift,v_before.shift);
  if v_shift not in ('morning','afternoon','middle') then raise exception 'Shift tidak valid'; end if;
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

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  kind text not null check (kind in ('annual','personal','sick')),
  extent text not null default 'full_day' check (extent in ('full_day','late_arrival','temporary_exit','early_departure')),
  starts_on date not null,
  ends_on date not null,
  starts_at time,
  ends_at time,
  reason text not null check (length(trim(reason)) between 3 and 2000),
  attachment_path text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled','needs_info')),
  decision_by uuid references public.employees(id),
  external_decider text,
  decided_at timestamptz,
  decision_note text,
  deductions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_on>=starts_on and ends_on<=starts_on+366),
  check(extent='full_day' or (starts_on=ends_on and (starts_at is not null or ends_at is not null))),
  check(starts_at is null or ends_at is null or ends_at>starts_at)
);
create index leave_employee_date on public.leave_requests(employee_id,starts_on desc);
create table public.leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id),
  type text not null check(type in ('change','cancel')),
  starts_on date,
  ends_on date,
  starts_at time,
  ends_at time,
  reason text not null check(length(trim(reason)) between 3 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decision_by uuid references public.employees(id),
  external_decider text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check(type='cancel' or (starts_on is not null and ends_on is not null and ends_on>=starts_on and ends_on<=starts_on+366))
);
create unique index leave_one_pending_adjustment on public.leave_adjustments(leave_request_id) where status='pending';
create table public.leave_ledger (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id),
  year integer not null check(year between 2000 and 2200),
  leave_request_id uuid not null references public.leave_requests(id),
  event_key text not null,
  amount numeric(6,2) not null check(amount<>0),
  actor_employee_id uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  unique(event_key,year)
);
create index leave_ledger_employee_year on public.leave_ledger(employee_id,year);
create function private.allowance(p_employee_id uuid,p_year integer,p_as_of date default (now() at time zone 'Asia/Jakarta')::date)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare v_eligible date;
begin
  select (starts_on+interval '3 months')::date into strict v_eligible from public.employees where id=p_employee_id;
  if p_year<extract(year from v_eligible)::integer or p_as_of<v_eligible then return 0; end if;
  if p_year=extract(year from v_eligible)::integer then return 13-extract(month from v_eligible)::integer; end if;
  return 12;
end;
$$;
create function public.leave_balance(p_employee_id uuid default null,p_year integer default extract(year from(now() at time zone 'Asia/Jakarta'))::integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_id uuid:=coalesce(p_employee_id,v_actor); v_allowance numeric; v_used numeric;
begin
  if v_id<>v_actor and not private.has_role('admin_hr') and not exists(select 1 from public.employees where id=v_id and approver_employee_id=v_actor) then
    raise exception 'Tidak berhak melihat saldo karyawan ini' using errcode='42501'; end if;
  v_allowance:=private.allowance(v_id,p_year);
  select -coalesce(sum(amount),0) into v_used from public.leave_ledger where employee_id=v_id and year=p_year;
  return jsonb_build_object('year',p_year,'allowance',v_allowance,'used',v_used,'remaining',v_allowance-v_used,
    'expired',p_year<extract(year from(now() at time zone 'Asia/Jakarta'))::integer);
end;
$$;
create function public.leave_submit(p_kind text,p_starts_on date,p_ends_on date,p_reason text,p_extent text default 'full_day',
  p_starts_at time default null,p_ends_at time default null,p_attachment_path text default null)
returns public.leave_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.leave_requests;
begin
  if p_starts_on<(now() at time zone 'Asia/Jakarta')::date then raise exception 'Gunakan koreksi HR untuk tanggal lampau'; end if;
  if p_kind='annual' and private.allowance(v_actor,extract(year from p_starts_on)::integer)=0 then raise exception 'Hak cuti belum tersedia'; end if;
  insert into public.leave_requests(employee_id,kind,starts_on,ends_on,reason,extent,starts_at,ends_at,attachment_path)
    values(v_actor,p_kind,p_starts_on,p_ends_on,p_reason,p_extent,p_starts_at,p_ends_at,p_attachment_path) returning * into v_row;
  return v_row;
end;
$$;

-- Every approval locks the employee before changing the ledger, including reversals.
-- Explicit year -> days allocation prevents refunds in December becoming usable in January.
create function private.set_deductions(p_leave public.leave_requests,p_new jsonb,p_event_key text,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_item record; v_old numeric; v_new numeric; v_remaining numeric; v_year integer;
begin
  if p_new is null or jsonb_typeof(p_new)<>'object' then raise exception 'Potongan harus berupa tahun dan jumlah hari'; end if;
  perform 1 from public.employees where id=p_leave.employee_id for update;
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
create function public.leave_decide(p_id uuid,p_decision text,p_deductions jsonb default '{}',p_note text default null,p_external_decider text default null)
returns public.leave_requests language plpgsql security definer set search_path='' as $$
declare v_row public.leave_requests; v_actor uuid; v_external boolean;
begin
  select * into strict v_row from public.leave_requests where id=p_id for update;
  v_actor:=private.assert_approver(v_row.employee_id);
  if v_row.status not in ('pending','needs_info') then raise exception 'Pengajuan sudah diproses'; end if;
  if p_decision not in ('approved','rejected','needs_info') then raise exception 'Keputusan tidak valid'; end if;
  select approval_mode='external' into v_external from public.employees where id=v_row.employee_id;
  if v_external and length(trim(coalesce(p_external_decider,'')))<3 then raise exception 'Nama pemberi keputusan eksternal wajib diisi'; end if;
  if p_decision<>'approved' and length(trim(coalesce(p_note,'')))<3 then raise exception 'Catatan keputusan wajib diisi'; end if;
  if p_decision='approved' then perform private.set_deductions(v_row,p_deductions,'approve:'||p_id::text,v_actor); end if;
  update public.leave_requests set status=p_decision,decision_by=v_actor,external_decider=case when v_external then p_external_decider else null end,
    decided_at=now(),decision_note=p_note,deductions=case when p_decision='approved' then p_deductions else '{}'::jsonb end,updated_at=now()
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('leave',p_id,v_actor,p_decision,p_note,to_jsonb(v_row));
  return v_row;
end;
$$;
create function public.leave_request_change(p_id uuid,p_starts_on date,p_ends_on date,p_reason text,p_starts_at time default null,p_ends_at time default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.leave_requests; v_adjustment public.leave_adjustments; v_before jsonb;
begin
  select * into strict v_row from public.leave_requests where id=p_id and employee_id=v_actor for update;
  if p_starts_on<(now() at time zone 'Asia/Jakarta')::date or v_row.starts_on<(now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Cuti yang sudah dijalani hanya dapat dikoreksi HR'; end if;
  if v_row.status in ('pending','needs_info') then
    v_before:=to_jsonb(v_row);
    update public.leave_requests set starts_on=p_starts_on,ends_on=p_ends_on,starts_at=p_starts_at,ends_at=p_ends_at,
      reason=p_reason,status='pending',updated_at=now() where id=p_id returning * into v_row;
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
      values('leave',p_id,v_actor,'edited',p_reason,v_before,to_jsonb(v_row));
    return jsonb_build_object('request',to_jsonb(v_row),'adjustment',null);
  elsif v_row.status='approved' then
    insert into public.leave_adjustments(leave_request_id,type,starts_on,ends_on,starts_at,ends_at,reason)
      values(p_id,'change',p_starts_on,p_ends_on,p_starts_at,p_ends_at,p_reason) returning * into v_adjustment;
    return jsonb_build_object('request',to_jsonb(v_row),'adjustment',to_jsonb(v_adjustment));
  end if;
  raise exception 'Pengajuan ini tidak dapat diubah';
end;
$$;
create function public.leave_request_cancel(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.leave_requests; v_adjustment public.leave_adjustments;
begin
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Alasan pembatalan wajib diisi'; end if;
  select * into strict v_row from public.leave_requests where id=p_id and employee_id=v_actor for update;
  if v_row.status in ('pending','needs_info') then
    update public.leave_requests set status='cancelled',updated_at=now() where id=p_id returning * into v_row;
    return jsonb_build_object('request',to_jsonb(v_row),'adjustment',null);
  elsif v_row.status='approved' and v_row.starts_on>=(now() at time zone 'Asia/Jakarta')::date then
    insert into public.leave_adjustments(leave_request_id,type,reason) values(p_id,'cancel',p_reason) returning * into v_adjustment;
    return jsonb_build_object('request',to_jsonb(v_row),'adjustment',to_jsonb(v_adjustment));
  end if;
  raise exception 'Pembatalan tanggal lampau harus dikoreksi HR';
end;
$$;
create function public.leave_decide_adjustment(p_id uuid,p_approved boolean,p_deductions jsonb default '{}',p_note text default null,p_external_decider text default null)
returns public.leave_adjustments language plpgsql security definer set search_path='' as $$
declare v_adjustment public.leave_adjustments; v_leave public.leave_requests; v_new public.leave_requests; v_actor uuid; v_external boolean;
begin
  select * into strict v_adjustment from public.leave_adjustments where id=p_id;
  -- Lock parent first, matching all other request mutations; avoid opposite lock order.
  select * into strict v_leave from public.leave_requests where id=v_adjustment.leave_request_id for update;
  select * into strict v_adjustment from public.leave_adjustments where id=p_id for update;
  v_actor:=private.assert_approver(v_leave.employee_id);
  if p_approved is null then raise exception 'Keputusan wajib diisi'; end if;
  if v_adjustment.status<>'pending' or v_leave.status<>'approved' then raise exception 'Perubahan sudah diproses'; end if;
  select approval_mode='external' into v_external from public.employees where id=v_leave.employee_id;
  if v_external and length(trim(coalesce(p_external_decider,'')))<3 then raise exception 'Nama pemberi keputusan eksternal wajib diisi'; end if;
  if not p_approved and length(trim(coalesce(p_note,'')))<3 then raise exception 'Alasan penolakan wajib diisi'; end if;
  if p_approved then
    v_new:=v_leave;
    if v_adjustment.type='change' then
      v_new.starts_on:=v_adjustment.starts_on; v_new.ends_on:=v_adjustment.ends_on;
      v_new.starts_at:=v_adjustment.starts_at; v_new.ends_at:=v_adjustment.ends_at;
      perform private.set_deductions(v_new,p_deductions,'adjust:'||p_id::text,v_actor);
      update public.leave_requests set starts_on=v_new.starts_on,ends_on=v_new.ends_on,starts_at=v_new.starts_at,ends_at=v_new.ends_at,
        deductions=p_deductions,updated_at=now() where id=v_leave.id;
    else
      perform private.set_deductions(v_leave,'{}','adjust:'||p_id::text,v_actor);
      update public.leave_requests set status='cancelled',deductions='{}',updated_at=now() where id=v_leave.id;
    end if;
  end if;
  update public.leave_adjustments set status=case when p_approved then 'approved' else 'rejected' end,
    decision_by=v_actor,external_decider=case when v_external then p_external_decider else null end,
    decided_at=now(),decision_note=p_note where id=p_id returning * into v_adjustment;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('leave',v_leave.id,v_actor,'adjustment_'||v_adjustment.status,p_note,to_jsonb(v_leave),to_jsonb(v_adjustment));
  return v_adjustment;
end;
$$;

-- Account token RPCs. Only the Edge Function sees hashes, consumes tokens and links Auth.
create function public.issue_account_token(p_employee_id uuid,p_purpose text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_token public.account_tokens;
begin
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for update;
  if p_purpose='activation' and v_employee.auth_user_id is not null then raise exception 'Akun sudah diaktifkan'; end if;
  if p_purpose='reset' and v_employee.auth_user_id is null then raise exception 'Akun belum diaktifkan'; end if;
  if exists(select 1 from public.account_tokens where employee_id=p_employee_id and claimed_at is not null and consumed_at is null and revoked_at is null) then
    raise exception 'Aktivasi sedang diproses. Coba kembali sebentar lagi'; end if;
  update public.account_tokens set revoked_at=now() where employee_id=p_employee_id and consumed_at is null and revoked_at is null;
  insert into public.account_tokens(employee_id,purpose,token_hash,created_by) values(p_employee_id,p_purpose,p_token_hash,v_actor) returning * into v_token;
  if p_purpose='activation' then update public.employees set account_status='pending' where id=p_employee_id; end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action) values('employee',p_employee_id,v_actor,p_purpose||'_issued');
  return jsonb_build_object('id',v_token.id,'employee_id',p_employee_id,'employee_number',v_employee.employee_number,'full_name',v_employee.full_name,'expires_at',v_token.expires_at);
end;
$$;
create function public.claim_account_token(p_token_hash text,p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_token public.account_tokens; v_employee public.employees;
begin
  perform private.require_service();
  select * into v_token from public.account_tokens where token_hash=p_token_hash for update;
  if not found or v_token.expires_at<=now() or v_token.revoked_at is not null or v_token.consumed_at is not null or v_token.claimed_at is not null then
    raise exception 'Tautan tidak berlaku atau sudah digunakan'; end if;
  select * into strict v_employee from public.employees where id=v_token.employee_id and status='active' for update;
  update public.account_tokens set claimed_at=now(),claim_id=p_claim_id where id=v_token.id;
  return jsonb_build_object('token_id',v_token.id,'purpose',v_token.purpose,'employee_id',v_employee.id,
    'employee_number',v_employee.employee_number,'full_name',v_employee.full_name,'auth_user_id',v_employee.auth_user_id);
end;
$$;
create function public.finish_account_token(p_token_id uuid,p_claim_id uuid,p_auth_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_token public.account_tokens;
begin
  perform private.require_service();
  select * into strict v_token from public.account_tokens where id=p_token_id and claim_id=p_claim_id and consumed_at is null and revoked_at is null for update;
  update public.employees set auth_user_id=p_auth_user_id,account_status='active',updated_at=now() where id=v_token.employee_id and status='active';
  if not found then raise exception 'Karyawan nonaktif'; end if;
  update public.account_tokens set consumed_at=now() where id=p_token_id;
end;
$$;
create function public.release_account_token(p_token_id uuid,p_claim_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_service();
  update public.account_tokens set claimed_at=null,claim_id=null where id=p_token_id and claim_id=p_claim_id and consumed_at is null;
end;
$$;

-- RLS remains effective even when disabled users retain a previously issued JWT.
alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.outlets enable row level security;
alter table public.employees enable row level security;
alter table public.employee_roles enable row level security;
alter table public.audit_events enable row level security;
alter table public.account_tokens enable row level security;
alter table public.attendance enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_adjustments enable row level security;
alter table public.leave_ledger enable row level security;
create policy master_read on public.departments for select to authenticated using(private.employee_id() is not null);
create policy master_insert on public.departments for insert to authenticated with check(private.has_role('admin_hr'));
create policy master_update on public.departments for update to authenticated using(private.has_role('admin_hr')) with check(private.has_role('admin_hr'));
create policy master_read on public.positions for select to authenticated using(private.employee_id() is not null);
create policy master_insert on public.positions for insert to authenticated with check(private.has_role('admin_hr'));
create policy master_update on public.positions for update to authenticated using(private.has_role('admin_hr')) with check(private.has_role('admin_hr'));
create policy master_read on public.outlets for select to authenticated using(private.employee_id() is not null);
create policy master_insert on public.outlets for insert to authenticated with check(private.has_role('admin_hr'));
create policy master_update on public.outlets for update to authenticated using(private.has_role('admin_hr')) with check(private.has_role('admin_hr'));
create policy employee_read on public.employees for select to authenticated using(id=private.employee_id() or private.has_role('admin_hr'));
create policy role_read on public.employee_roles for select to authenticated using(employee_id=private.employee_id() or private.has_role('admin_hr'));
create policy audit_read on public.audit_events for select to authenticated using(private.has_role('admin_hr'));
create policy attendance_read on public.attendance for select to authenticated using(employee_id=private.employee_id() or private.has_role('admin_hr'));
create policy leave_read on public.leave_requests for select to authenticated using(employee_id=private.employee_id() or private.has_role('admin_hr') or private.is_approver(employee_id));
create policy adjustment_read on public.leave_adjustments for select to authenticated using(exists(select 1 from public.leave_requests r where r.id=leave_request_id));
create policy ledger_read on public.leave_ledger for select to authenticated using(employee_id=private.employee_id() or private.has_role('admin_hr'));

-- Public function execution is revoked first; expose only the intentional API.
revoke all on all tables in schema public from anon, authenticated;
grant select,insert,update on public.departments,public.positions,public.outlets to authenticated;
grant select on public.employees,public.employee_roles,public.audit_events,public.attendance,public.leave_requests,public.leave_adjustments,public.leave_ledger to authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.employee_directory(),public.update_my_profile(jsonb),public.hr_save_employee(jsonb,uuid,text),public.hr_set_roles(uuid,text[]),
  public.attendance_clock_in(text,double precision,double precision,double precision,text),
  public.attendance_clock_out(double precision,double precision,double precision),public.attendance_correct(uuid,timestamptz,timestamptz,text,text),
  public.leave_balance(uuid,integer),public.leave_submit(text,date,date,text,text,time,time,text),
  public.leave_decide(uuid,text,jsonb,text,text),public.leave_request_change(uuid,date,date,text,time,time),
  public.leave_request_cancel(uuid,text),public.leave_decide_adjustment(uuid,boolean,jsonb,text,text),
  public.issue_account_token(uuid,text,text) to authenticated;
grant execute on function public.claim_account_token(text,uuid),public.finish_account_token(uuid,uuid,uuid),public.release_account_token(uuid,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('attendance-selfies','attendance-selfies',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy selfie_upload on storage.objects for insert to authenticated with check(bucket_id='attendance-selfies'
  and (storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null);
create policy selfie_read on storage.objects for select to authenticated using(bucket_id='attendance-selfies'
  and ((storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null or private.has_role('admin_hr')));
-- No overwrite/delete: a photo referenced by an attendance record stays immutable.

alter publication supabase_realtime add table public.departments,public.positions,public.outlets,public.employees,
  public.employee_roles,public.attendance,public.leave_requests,public.leave_adjustments,public.leave_ledger;
