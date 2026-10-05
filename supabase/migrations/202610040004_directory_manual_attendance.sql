-- Approvers need team relationships, never private identity/contact fields.
drop function public.employee_directory();
create function public.employee_directory() returns table(
  id uuid,employee_number text,full_name text,department_id uuid,position_id uuid,outlet_id uuid,
  approver_employee_id uuid,approval_mode text,status text,can_clock boolean,can_middle_shift boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_employee();
  return query select e.id,e.employee_number,e.full_name,e.department_id,e.position_id,e.outlet_id,
    e.approver_employee_id,e.approval_mode,e.status,e.can_clock,e.can_middle_shift
    from public.employees e where e.status='active';
end;
$$;
revoke all on function public.employee_directory() from public,anon,authenticated;
grant execute on function public.employee_directory() to authenticated;

-- A failed camera/GPS attempt has no clock-in row to correct. HR may create an
-- explicitly manual record, preserving that no selfie/location was verified.
alter table public.attendance add column source text not null default 'clock'
  check(source in ('clock','manual'));
alter table public.attendance alter column outlet_latitude drop not null;
alter table public.attendance alter column outlet_longitude drop not null;
alter table public.attendance alter column in_latitude drop not null;
alter table public.attendance alter column in_longitude drop not null;
alter table public.attendance alter column in_accuracy_m drop not null;
alter table public.attendance alter column in_distance_m drop not null;
alter table public.attendance alter column selfie_path drop not null;
alter table public.attendance add constraint attendance_clock_evidence check(
  source='manual' or (outlet_latitude is not null and outlet_longitude is not null
    and in_latitude is not null and in_longitude is not null and in_accuracy_m is not null
    and in_distance_m is not null and selfie_path is not null));

create function public.attendance_record_manual(p_employee_id uuid,p_shift text,p_clock_in timestamptz,
  p_clock_out timestamptz default null,p_reason text default null)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_outlet public.outlets;
  v_date date; v_expected timestamptz; v_row public.attendance;
begin
  if v_actor=p_employee_id then raise exception 'Catatan absensi sendiri tidak boleh dibuat manual'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Alasan pencatatan manual wajib diisi'; end if;
  if p_clock_in is null or not isfinite(p_clock_in) or p_clock_in>now()
    or p_clock_out>now() or p_clock_out<p_clock_in or not isfinite(p_clock_out) then
    raise exception 'Waktu pencatatan manual tidak valid'; end if;
  if p_shift is null or p_shift not in ('morning','afternoon','middle') then raise exception 'Shift tidak valid'; end if;
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for update;
  if not v_employee.can_clock then raise exception 'Pencatatan absensi hanya untuk kasir yang diizinkan'; end if;
  if p_shift='middle' and not v_employee.can_middle_shift then raise exception 'Shift Middle belum diizinkan oleh SPV'; end if;
  select * into strict v_outlet from public.outlets where id=v_employee.outlet_id;
  v_date:=(p_clock_in at time zone 'Asia/Jakarta')::date;
  v_expected:=case p_shift when 'morning' then (v_date+v_outlet.morning_starts_at) at time zone 'Asia/Jakarta'
    when 'afternoon' then (v_date+v_outlet.afternoon_starts_at) at time zone 'Asia/Jakarta' else null end;
  if exists(select 1 from public.attendance a where a.employee_id=p_employee_id
    and tstzrange(a.clock_in,a.clock_out,'[)') && tstzrange(p_clock_in,p_clock_out,'[)')) then
    raise exception 'Waktu absensi bertabrakan dengan catatan yang sudah ada'; end if;
  insert into public.attendance(employee_id,outlet_id,work_date,shift,expected_in,expected_out,
    morning_starts_at,afternoon_starts_at,tolerance_minutes,outlet_latitude,outlet_longitude,radius_m,
    clock_in,clock_out,late_minutes,worked_minutes,corrected,source)
  values(v_employee.id,v_outlet.id,v_date,p_shift,v_expected,coalesce(v_expected,p_clock_in)+interval '8 hours',
    v_outlet.morning_starts_at,v_outlet.afternoon_starts_at,v_outlet.late_tolerance_minutes,
    v_outlet.latitude,v_outlet.longitude,v_outlet.radius_m,p_clock_in,p_clock_out,
    case when v_expected is null or p_clock_in<=v_expected+make_interval(mins=>v_outlet.late_tolerance_minutes) then 0
      else ceil(extract(epoch from(p_clock_in-v_expected))/60)::integer end,
    case when p_clock_out is null then null else floor(extract(epoch from(p_clock_out-p_clock_in))/60)::integer end,
    true,'manual') returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
    values('attendance',v_row.id,v_actor,'recorded_manual',trim(p_reason),to_jsonb(v_row));
  return v_row;
exception when unique_violation then
  raise exception 'Absensi tanggal tersebut sudah tercatat atau clock out sebelumnya belum selesai';
end;
$$;
revoke all on function public.attendance_record_manual(uuid,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.attendance_record_manual(uuid,text,timestamptz,timestamptz,text) to authenticated;

-- One relevant time is sufficient for late arrival/early departure. Temporary
-- exit needs both departure and return; validate proposed changes at submission.
create function private.assert_leave_period(p_extent text,p_starts_on date,p_ends_on date,
  p_starts_at time,p_ends_at time) returns void language plpgsql immutable set search_path='' as $$
begin
  if p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on or p_ends_on>p_starts_on+366 then
    raise exception 'Tanggal pengajuan tidak valid'; end if;
  if p_extent<>'full_day' and (p_starts_on<>p_ends_on or (p_starts_at is null and p_ends_at is null)) then
    raise exception 'Izin sebagian hari memerlukan satu tanggal dan jam izin'; end if;
  if p_extent='temporary_exit' and (p_starts_at is null or p_ends_at is null) then
    raise exception 'Izin keluar sementara memerlukan jam keluar dan kembali'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at<=p_starts_at then
    raise exception 'Jam kembali harus setelah jam keluar'; end if;
end;
$$;
create function private.check_leave_period() returns trigger language plpgsql security definer set search_path='' as $$
declare v_extent text;
begin
  if tg_table_name='leave_requests' then
    perform private.assert_leave_period(new.extent,new.starts_on,new.ends_on,new.starts_at,new.ends_at);
  elsif new.type='change' then
    select extent into strict v_extent from public.leave_requests where id=new.leave_request_id;
    perform private.assert_leave_period(v_extent,new.starts_on,new.ends_on,new.starts_at,new.ends_at);
  end if;
  return new;
end;
$$;
create trigger leave_period_valid before insert or update on public.leave_requests
  for each row execute function private.check_leave_period();
create trigger adjustment_period_valid before insert or update on public.leave_adjustments
  for each row execute function private.check_leave_period();

-- Failed uploads can be cleaned up by their owner. The reference lookup bypasses
-- table RLS so invisible HR/other-profile references never permit deletion.
create function private.upload_is_unreferenced(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select case p_bucket
    when 'attendance-selfies' then not exists(select 1 from public.attendance where selfie_path=p_path)
    when 'leave-attachments' then not exists(select 1 from public.leave_requests where attachment_path=p_path)
    when 'profile-photos' then not exists(select 1 from public.employees where photo_path=p_path)
    else false end;
$$;
revoke all on function private.upload_is_unreferenced(text,text) from public,anon,authenticated;
grant execute on function private.upload_is_unreferenced(text,text) to authenticated;
create policy unused_upload_delete on storage.objects for delete to authenticated using(
  bucket_id in ('attendance-selfies','leave-attachments','profile-photos')
  and (storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null
  and private.upload_is_unreferenced(bucket_id,name));

-- A crashed worker must not permanently prevent HR from replacing an expired
-- invitation. Claim replacement matches the existing five-minute takeover lease.
create or replace function public.issue_account_token(p_employee_id uuid,p_purpose text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee public.employees; v_token public.account_tokens;
begin
  select * into strict v_employee from public.employees where id=p_employee_id and status='active' for update;
  if p_purpose='activation' and v_employee.auth_user_id is not null then raise exception 'Akun sudah diaktifkan'; end if;
  if p_purpose='reset' and v_employee.auth_user_id is null then raise exception 'Akun belum diaktifkan'; end if;
  if exists(select 1 from public.account_tokens where employee_id=p_employee_id
    and claimed_at>now()-interval '5 minutes' and expires_at>now()
    and consumed_at is null and revoked_at is null) then
    raise exception 'Aktivasi sedang diproses. Coba kembali sebentar lagi'; end if;
  update public.account_tokens set revoked_at=now() where employee_id=p_employee_id and consumed_at is null and revoked_at is null;
  insert into public.account_tokens(employee_id,purpose,token_hash,created_by)
    values(p_employee_id,p_purpose,p_token_hash,v_actor) returning * into v_token;
  if p_purpose='activation' then update public.employees set account_status='pending' where id=p_employee_id; end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action)
    values('employee',p_employee_id,v_actor,p_purpose||'_issued');
  return jsonb_build_object('id',v_token.id,'employee_id',p_employee_id,'employee_number',v_employee.employee_number,
    'full_name',v_employee.full_name,'expires_at',v_token.expires_at);
end;
$$;
