-- Forward-only fixes for account lifecycle findings APP-04/05/06.
-- Previously applied migrations remain unchanged.

create or replace function public.hr_save_employee(
  p_employee jsonb,
  p_id uuid default null,
  p_reason text default 'Pembaruan data karyawan'
) returns public.employees
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := private.require_hr();
  v_before public.employees;
  v_row public.employees;
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
    select * into strict v_before from public.employees where id=p_id for no key update;
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
      account_status=case
        when v_candidate.status='inactive' then 'disabled'
        when v_candidate.status='active' and v_before.status='inactive' and v_before.auth_user_id is not null then 'active'
        else account_status end,
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
    raise exception 'Atasan harus merupakan karyawan aktif';
  end if;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
  values('employee',v_row.id,v_actor,case when p_id is null then 'created' else 'updated' end,p_reason,
    case when p_id is null then null else to_jsonb(v_before) end,to_jsonb(v_row));
  return v_row;
end;
$$;

-- Keep employee fields, account state and role changes in one PostgreSQL transaction.
create or replace function public.hr_save_employee_with_roles(
  p_employee jsonb,
  p_id uuid,
  p_roles text[],
  p_reason text default 'Pembaruan data karyawan'
) returns public.employees
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := private.require_hr();
  v_before_roles text[];
  v_after_roles text[];
  v_row public.employees;
begin
  if p_roles is null or not p_roles <@ array['employee','admin_hr','head_baker'] then
    raise exception 'Hak akses tidak valid';
  end if;
  if p_id is not null then
    perform 1 from public.employees where id=p_id for no key update;
    if not found then raise exception 'Karyawan tidak ditemukan'; end if;
    select coalesce(array_agg(role order by role),array[]::text[]) into v_before_roles
      from public.employee_roles where employee_id=p_id;
  end if;
  select array(select distinct unnest(array_append(p_roles,'employee')) order by 1) into v_after_roles;
  if p_id=v_actor and v_before_roles is distinct from v_after_roles then
    raise exception 'Hak akses sendiri tidak dapat diubah';
  end if;

  v_row := public.hr_save_employee(p_employee,p_id,p_reason);
  if p_id is null or v_before_roles is distinct from v_after_roles then
    delete from public.employee_roles where employee_id=v_row.id;
    insert into public.employee_roles(employee_id,role)
      select v_row.id, unnest(v_after_roles) on conflict do nothing;
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,after_data)
      values('employee',v_row.id,v_actor,'roles_updated',jsonb_build_object('roles',v_after_roles));
  end if;
  return v_row;
end;
$$;

revoke all on function public.hr_save_employee_with_roles(jsonb,uuid,text[],text) from public,anon;
grant execute on function public.hr_save_employee_with_roles(jsonb,uuid,text[],text) to authenticated;

create or replace function public.inspect_account_token(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_token public.account_tokens;
  v_employee public.employees;
begin
  perform private.require_service();
  select * into v_token from public.account_tokens
  where token_hash=p_token_hash and expires_at>now() and revoked_at is null and consumed_at is null
    and (claimed_at is null or claimed_at<=now()-interval '5 minutes');
  if not found then raise exception 'Tautan tidak berlaku atau sudah digunakan'; end if;
  select * into strict v_employee from public.employees where id=v_token.employee_id and status='active';
  return jsonb_build_object('purpose',v_token.purpose,'employee_number',v_employee.employee_number,
    'full_name',v_employee.full_name,'expires_at',v_token.expires_at);
end;
$$;
