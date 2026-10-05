-- Public unauthenticated account operations are only exposed through hr-api.
create table private.request_limits (
  key_hash text not null,
  bucket_start timestamptz not null,
  attempts integer not null default 1,
  primary key(key_hash,bucket_start)
);
create function public.auth_rate_limit(p_key_hash text,p_limit integer default 15) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_count integer; v_bucket timestamptz:=date_trunc('hour',now())+floor(extract(minute from now())/10)*interval '10 minutes';
begin
  perform private.require_service();
  if length(p_key_hash)<>64 or p_limit not between 1 and 100 then raise exception 'Invalid limit'; end if;
  insert into private.request_limits(key_hash,bucket_start) values(p_key_hash,v_bucket)
    on conflict(key_hash,bucket_start) do update set attempts=private.request_limits.attempts+1 returning attempts into v_count;
  delete from private.request_limits where bucket_start<now()-interval '1 day';
  return v_count<=p_limit;
end;
$$;
create function public.inspect_account_token(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_token public.account_tokens; v_employee public.employees;
begin
  perform private.require_service();
  select * into v_token from public.account_tokens where token_hash=p_token_hash and expires_at>now()
    and revoked_at is null and consumed_at is null and claimed_at is null;
  if not found then raise exception 'Tautan tidak berlaku atau sudah digunakan'; end if;
  select * into strict v_employee from public.employees where id=v_token.employee_id and status='active';
  return jsonb_build_object('purpose',v_token.purpose,'employee_number',v_employee.employee_number,
    'full_name',v_employee.full_name,'expires_at',v_token.expires_at);
end;
$$;
-- Idempotent recovery after an Edge worker stopped between Auth creation and linking.
-- A claim cannot be replaced within five minutes; old claims are invalidated by takeover.
create or replace function public.claim_account_token(p_token_hash text,p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_token public.account_tokens; v_employee public.employees; v_auth_id uuid;
begin
  perform private.require_service();
  select * into v_token from public.account_tokens where token_hash=p_token_hash;
  if not found then raise exception 'Tautan tidak berlaku atau sudah digunakan'; end if;
  select * into strict v_employee from public.employees where id=v_token.employee_id and status='active' for update;
  select * into strict v_token from public.account_tokens where id=v_token.id for update;
  if v_token.expires_at<=now() or v_token.revoked_at is not null or v_token.consumed_at is not null
    or (v_token.claimed_at is not null and v_token.claimed_at>now()-interval '5 minutes') then
    raise exception 'Tautan tidak berlaku, sedang diproses, atau sudah digunakan'; end if;
  select id into v_auth_id from auth.users where lower(email)=lower(v_employee.employee_number)||'@login.rajaklana.internal';
  update public.account_tokens set claimed_at=now(),claim_id=p_claim_id where id=v_token.id;
  return jsonb_build_object('token_id',v_token.id,'purpose',v_token.purpose,'employee_id',v_employee.id,
    'employee_number',v_employee.employee_number,'full_name',v_employee.full_name,
    'auth_user_id',coalesce(v_employee.auth_user_id,v_auth_id));
end;
$$;
create or replace function public.finish_account_token(p_token_id uuid,p_claim_id uuid,p_auth_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_token public.account_tokens; v_employee_id uuid;
begin
  perform private.require_service();
  select employee_id into strict v_employee_id from public.account_tokens where id=p_token_id;
  perform 1 from public.employees where id=v_employee_id and status='active' for update;
  if not found then raise exception 'Karyawan nonaktif'; end if;
  select * into strict v_token from public.account_tokens where id=p_token_id and claim_id=p_claim_id and revoked_at is null for update;
  -- Same claim finalization can be retried after an HTTP timeout.
  if v_token.consumed_at is not null then return; end if;
  if not exists(select 1 from auth.users u join public.employees e on e.id=v_employee_id
    where u.id=p_auth_user_id and lower(u.email)=lower(e.employee_number)||'@login.rajaklana.internal') then
    raise exception 'Identitas Auth tidak sesuai'; end if;
  update public.employees set auth_user_id=p_auth_user_id,account_status='active',updated_at=now() where id=v_employee_id;
  update public.account_tokens set consumed_at=now() where id=p_token_id;
end;
$$;

create function public.reserve_employee_number() returns text language plpgsql security definer set search_path='' as $$
begin
  perform private.require_service();
  return private.next_employee_number();
end;
$$;
create function public.bootstrap_admin(p_auth_user_id uuid,p_full_name text,p_whatsapp text,p_outlet_name text)
returns public.employees language plpgsql security definer set search_path='' as $$
declare v_department uuid; v_position uuid; v_outlet uuid; v_row public.employees; v_number text;
begin
  perform private.require_service();
  perform pg_advisory_xact_lock(71948331);
  if exists(select 1 from public.employee_roles where role='admin_hr') then raise exception 'Admin awal sudah dibuat'; end if;
  select upper(split_part(email,'@',1)) into v_number from auth.users where id=p_auth_user_id
    and lower(email) ~ '^rk[0-9]{6,}@login\.rajaklana\.internal$';
  if v_number is null then raise exception 'Identitas akun admin awal tidak sesuai'; end if;
  insert into public.departments(name) values('Penjualan & SDM') on conflict(name) do update set active=true returning id into v_department;
  insert into public.positions(department_id,name) values(v_department,'Supervisor Penjualan & SDM')
    on conflict(department_id,name) do update set active=true returning id into v_position;
  insert into public.outlets(name) values(p_outlet_name) returning id into v_outlet;
  insert into public.employees(employee_number,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,approval_mode,auth_user_id,account_status)
    values(v_number,p_full_name,p_whatsapp,v_department,v_position,v_outlet,(now() at time zone 'Asia/Jakarta')::date,'external',p_auth_user_id,'active')
    returning * into v_row;
  insert into public.employee_roles(employee_id,role) values(v_row.id,'employee'),(v_row.id,'admin_hr');
  insert into public.audit_events(entity,entity_id,actor_employee_id,action) values('employee',v_row.id,v_row.id,'bootstrap');
  return v_row;
end;
$$;

revoke all on function public.auth_rate_limit(text,integer),public.inspect_account_token(text),public.bootstrap_admin(uuid,text,text,text),public.reserve_employee_number() from public,anon,authenticated;
grant execute on function public.auth_rate_limit(text,integer),public.inspect_account_token(text),public.bootstrap_admin(uuid,text,text,text),public.reserve_employee_number() to service_role;

-- Starting structure only; Admin HR may add/rename/deactivate these records.
insert into public.departments(name) values('Produksi'),('Administrasi'),('Penjualan & SDM'),('Sarana, Prasarana & Keuangan'),('Distribusi & Persediaan Produk') on conflict(name) do nothing;
insert into public.positions(department_id,name,is_cashier)
select d.id,v.position,v.cashier from (values
  ('Produksi','Head Baker',false),('Produksi','Asisten Baker',false),('Produksi','Helper Produksi',false),
  ('Produksi','Staf Premix',false),('Produksi','Stock Keeper Bahan Produksi',false),
  ('Administrasi','Admin Operasional & Produksi',false),('Penjualan & SDM','Kasir',true),
  ('Penjualan & SDM','Supervisor Penjualan & SDM',false),
  ('Sarana, Prasarana & Keuangan','Supervisor Sarpras & Keuangan',false),
  ('Distribusi & Persediaan Produk','Staf Distribusi',false),
  ('Distribusi & Persediaan Produk','Supervisor Persediaan Produk Outlet',false)
) v(department,position,cashier) join public.departments d on d.name=v.department on conflict(department_id,name) do nothing;
