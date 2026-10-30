-- Forward-only retirement of the application authenticator.
-- Migration 20261027090100 remains immutable. This migration deliberately
-- keeps its live-session and restrictive policy controls while removing the
-- AAL/factor dependency and retiring the old recovery surface.

create or replace function private.session_access_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=private.raw_employee_id();
  v_claims jsonb;
  v_level text;
  v_session uuid;
  v_reason text;
begin
  begin
    v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then
    v_claims:='{}'::jsonb;
  end;
  -- AAL remains informational for compatibility with old tabs. It is not an
  -- authorization input after the product decision to use password-only login.
  v_level:=case when v_claims->>'aal'='aal2' then 'aal2' else 'aal1' end;
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
    end if;
  end if;
  return jsonb_build_object(
    'employee_id',v_actor,
    'requires_mfa',false,
    'current_level',v_level,
    'allowed',v_reason is null,
    'reason',v_reason
  );
end;
$$;

create or replace function private.employee_id()
returns uuid language sql stable security definer set search_path='' as $$
  select case when private.session_allowed() then private.raw_employee_id() else null end;
$$;

create or replace function private.require_employee()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb:=private.session_access_context();
begin
  if v_context->>'reason'='session_revoked' then
    raise exception 'Sesi tidak berlaku. Silakan login kembali' using errcode='42501';
  elsif not (v_context->>'allowed')::boolean then
    raise exception 'Akun karyawan tidak aktif' using errcode='42501';
  end if;
  return (v_context->>'employee_id')::uuid;
end;
$$;

create or replace function public.auth_access_context()
returns jsonb language sql stable security definer set search_path='' as $$
  select private.session_access_context();
$$;

-- Keep the historical recovery rows/audit immutable, but make both RPC names
-- an explicit tombstone while old clients drain. No actor or service role can
-- invoke factor deletion through the application surface anymore.
create or replace function public.auth_mfa_recovery_authorize(p_employee_id uuid,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Pemulihan autentikator sudah dihentikan. Login menggunakan nomor karyawan dan kata sandi.' using errcode='0A000';
end;
$$;

create or replace function public.auth_mfa_recovery_complete(p_request_id uuid,p_succeeded boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Pemulihan autentikator sudah dihentikan.' using errcode='0A000';
end;
$$;

revoke all on function public.auth_mfa_recovery_authorize(uuid,uuid,text),public.auth_mfa_recovery_complete(uuid,boolean)
from public,anon,authenticated,service_role;

drop function if exists private.employee_requires_mfa(uuid);
