-- Forward-only MFA enforcement. Existing business RPC bodies, versions,
-- receipts, and transaction boundaries are intentionally retained.
--
-- PostgREST populates request.jwt.claims from its verified JWT. Neither
-- user_metadata nor a client-supplied employee id controls assurance/roles.
create function private.raw_employee_id()
returns uuid language sql stable security definer set search_path='' as $$
  select e.id from public.employees e
  where e.auth_user_id=auth.uid() and e.status='active' and e.account_status='active';
$$;

create function private.employee_requires_mfa(p_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_employee_id is not null and (
    exists(select 1 from public.employee_roles r where r.employee_id=p_employee_id and r.role in ('admin_hr','head_baker'))
    or exists(select 1 from public.employees e where e.approver_employee_id=p_employee_id and e.status='active')
    or exists(select 1 from public.supervisor_capabilities c where c.employee_id=p_employee_id and c.capability<>'issue_report')
  );
$$;

create function private.session_access_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=private.raw_employee_id();
  v_claims jsonb;
  v_level text;
  v_required boolean;
  v_session uuid;
  v_reason text;
begin
  begin v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then v_claims:='{}'::jsonb; end;
  v_level:=case when v_claims->>'aal'='aal2' then 'aal2' else 'aal1' end;
  v_required:=private.employee_requires_mfa(v_actor);
  if v_actor is null then
    v_reason:='inactive';
  else
    begin v_session:=(v_claims->>'session_id')::uuid;
    exception when others then v_session:=null; end;
    if v_session is null or not exists(
      select 1 from auth.sessions s
      where s.id=v_session and s.user_id=auth.uid()
        and (s.not_after is null or s.not_after>statement_timestamp())
    ) then
      v_reason:='session_revoked';
    elsif v_required and v_level<>'aal2' then
      v_reason:='mfa_required';
    elsif v_required and not exists(
      select 1 from auth.sessions s
      join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.id=v_session and s.user_id=auth.uid() and s.aal::text='aal2'
        and f.status::text='verified' and f.factor_type::text='totp'
    ) then
      -- A still-valid aal2 JWT cannot outlive deletion of its session/factor.
      v_reason:='session_revoked';
    end if;
  end if;
  return jsonb_build_object('employee_id',v_actor,'requires_mfa',v_required,
    'current_level',v_level,'allowed',v_reason is null,'reason',v_reason);
end;
$$;

create function private.session_allowed()
returns boolean language sql stable security definer set search_path='' as $$
  select (private.session_access_context()->>'allowed')::boolean;
$$;

-- All pre-existing privileged checks flow through employee_id/require_employee.
-- Hiding an unverified privileged actor also closes SELECTs and capability
-- predicates that use employee_id rather than require_hr.
create or replace function private.employee_id()
returns uuid language sql stable security definer set search_path='' as $$
  select case when private.session_allowed() then private.raw_employee_id() else null end;
$$;

create or replace function private.require_employee()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb:=private.session_access_context();
begin
  if v_context->>'reason'='mfa_required' then
    raise exception 'Verifikasi dua langkah diperlukan. Selesaikan verifikasi akun terlebih dahulu' using errcode='42501';
  elsif v_context->>'reason'='session_revoked' then
    raise exception 'Sesi tidak berlaku. Silakan login kembali' using errcode='42501';
  elsif not (v_context->>'allowed')::boolean then
    raise exception 'Akun karyawan tidak aktif' using errcode='42501';
  end if;
  return (v_context->>'employee_id')::uuid;
end;
$$;

create or replace function private.require_hr()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee();
begin
  if not private.has_role('admin_hr') then
    raise exception 'Akses Admin HR diperlukan' using errcode='42501';
  end if;
  return v_actor;
end;
$$;

-- This is the only aal1 identity endpoint: no role list, directory, profile,
-- factor seed, session id, or HR data is returned. It routes enrollment/login.
create function public.auth_access_context()
returns jsonb language sql stable security definer set search_path='' as $$
  select private.session_access_context();
$$;

revoke all on function private.raw_employee_id(),private.employee_requires_mfa(uuid),
  private.session_access_context(),private.session_allowed(),private.employee_id(),
  private.require_employee(),private.require_hr(),public.auth_access_context()
from public,anon,authenticated;
grant execute on function private.employee_id(),private.session_allowed(),public.auth_access_context() to authenticated;

-- Defense in depth for direct table/Storage access. Restrictive policies are
-- ANDed with every existing permissive policy; no business scope is widened.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'departments','positions','outlets','employees','employee_roles','audit_events',
    'account_tokens','attendance','leave_requests','leave_adjustments','leave_ledger',
    'notifications','cashier_assignments','attendance_correction_requests','biometric_references',
    'staffing_requirements','cashier_roster_batches','spv_followups',
    'supervisor_issue_categories','supervisor_capabilities','supervisor_issue_routes',
    'outlet_issues','outlet_issue_events','shift_handovers','shift_handover_versions',
    'shift_handover_events','shift_exchange_requests','shift_exchange_events',
    'staffing_interval_requirements'
  ] loop
    execute format('create policy privileged_mfa_session on public.%I as restrictive to authenticated using ((select private.session_allowed())) with check ((select private.session_allowed()))',v_table);
  end loop;
end;
$$;
create policy privileged_mfa_session on storage.objects as restrictive to authenticated
  using((select private.session_allowed())) with check((select private.session_allowed()));

-- Recovery authorizes removal of an immutable snapshot of factor IDs. It
-- never downgrades the database MFA requirement and cannot recover oneself.
create table private.mfa_recovery_requests (
  request_id uuid primary key,
  actor_employee_id uuid not null references public.employees(id),
  employee_id uuid not null references public.employees(id),
  auth_user_id uuid not null references auth.users(id),
  factor_ids uuid[] not null,
  reason text not null check(length(trim(reason)) between 10 and 1000),
  status text not null default 'pending' check(status in ('pending','failed','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table private.mfa_recovery_requests enable row level security;
revoke all on table private.mfa_recovery_requests from public,anon,authenticated,service_role;

create function public.auth_mfa_recovery_authorize(p_employee_id uuid,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr();v_row private.mfa_recovery_requests;v_auth uuid;v_reason text:=trim(coalesce(p_reason,''));
begin
  if p_request_id is null or p_employee_id is null or length(v_reason) not between 10 and 1000 then
    raise exception 'Karyawan, id permintaan, dan alasan pemulihan minimal 10 karakter diperlukan';
  end if;
  if p_employee_id=v_actor then raise exception 'Pemulihan MFA sendiri tidak diizinkan' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('mfa-recovery:'||p_request_id::text,0));
  select * into v_row from private.mfa_recovery_requests where request_id=p_request_id for update;
  if found then
    if v_row.actor_employee_id<>v_actor or v_row.employee_id<>p_employee_id or v_row.reason<>v_reason then
      raise exception 'Id permintaan pemulihan sudah digunakan untuk data lain';
    end if;
  else
    select auth_user_id into v_auth from public.employees
      where id=p_employee_id and status='active' and account_status='active' for no key update;
    if v_auth is null or not private.employee_requires_mfa(p_employee_id) then
      raise exception 'Pemulihan hanya tersedia untuk akun petugas aktif yang memerlukan MFA';
    end if;
    insert into private.mfa_recovery_requests(request_id,actor_employee_id,employee_id,auth_user_id,factor_ids,reason)
      values(p_request_id,v_actor,p_employee_id,v_auth,
        coalesce((select array_agg(f.id order by f.id) from auth.mfa_factors f where f.user_id=v_auth),'{}'::uuid[]),v_reason)
      returning * into v_row;
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
      values('auth_mfa',p_employee_id,v_actor,'mfa_recovery_authorized',v_reason,
        jsonb_build_object('request_id',p_request_id,'factor_count',cardinality(v_row.factor_ids),'status','pending'));
  end if;
  return jsonb_build_object('request_id',v_row.request_id,'employee_id',v_row.employee_id,
    'auth_user_id',v_row.auth_user_id,'factor_ids',to_jsonb(v_row.factor_ids),'status',v_row.status);
end;
$$;

create function public.auth_mfa_recovery_complete(p_request_id uuid,p_succeeded boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row private.mfa_recovery_requests;v_status text;
begin
  perform private.require_service();
  if p_request_id is null or p_succeeded is null then raise exception 'Hasil pemulihan tidak valid';end if;
  select * into strict v_row from private.mfa_recovery_requests where request_id=p_request_id for update;
  v_status:=case when p_succeeded then 'completed' else 'failed' end;
  if v_row.status<>'completed' and v_row.status<>v_status then
    update private.mfa_recovery_requests set status=v_status,
      completed_at=case when p_succeeded then now() else null end where request_id=p_request_id returning * into v_row;
    insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,after_data)
      values('auth_mfa',v_row.employee_id,v_row.actor_employee_id,'mfa_recovery_'||v_status,v_row.reason,
        jsonb_build_object('request_id',p_request_id,'factor_count',cardinality(v_row.factor_ids),'status',v_status));
  end if;
  return jsonb_build_object('request_id',v_row.request_id,'employee_id',v_row.employee_id,'status',v_row.status);
end;
$$;
revoke all on function public.auth_mfa_recovery_authorize(uuid,uuid,text),public.auth_mfa_recovery_complete(uuid,boolean)
from public,anon,authenticated;
grant execute on function public.auth_mfa_recovery_authorize(uuid,uuid,text) to authenticated;
grant execute on function public.auth_mfa_recovery_complete(uuid,boolean) to service_role;
