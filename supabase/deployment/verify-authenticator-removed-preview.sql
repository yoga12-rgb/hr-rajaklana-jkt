-- Read-only final probe for the password-only Preview contract.
-- Run as a transaction with no DML or fake JWT claims.
do $verify_authenticator_removed$
declare
  v_count integer;
  v_policy_count integer;
begin
  select count(*) into v_count from supabase_migrations.schema_migrations;
  if v_count <> 26 then
    raise exception 'Expected Preview final baseline of 26 migrations, found %',v_count;
  end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where name='retire_application_authenticator' and version>'20261029032121') then
    raise exception 'Authenticator retirement migration is missing from history or is not newer than the Preview baseline';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='employee_requires_mfa' and pg_get_function_identity_arguments(p.oid)='p_employee_id uuid') then
    raise exception 'MFA employee gate still exists';
  end if;
  if exists(select 1 from pg_proc where oid='public.auth_mfa_recovery_authorize(uuid,uuid,text)'::regprocedure and has_function_privilege('authenticated',oid,'EXECUTE'))
    or exists(select 1 from pg_proc where oid='public.auth_mfa_recovery_complete(uuid,boolean)'::regprocedure and has_function_privilege('service_role',oid,'EXECUTE')) then
    raise exception 'Retired MFA recovery RPC still has an executable grant';
  end if;
  if not exists(select 1 from pg_proc where oid='private.session_access_context()'::regprocedure and prosrc like '%requires_mfa%') then
    raise exception 'Session access context contract is missing';
  end if;
  select count(*) into v_policy_count from pg_policy where polrelid='storage.objects'::regclass and not polpermissive and polname='privileged_mfa_session';
  if v_policy_count <> 1 then
    raise exception 'Storage restrictive live-session policy missing or weakened';
  end if;
  if not exists(select 1 from pg_class where oid='private.mfa_recovery_requests'::regclass) then
    raise exception 'Historical recovery table was removed';
  end if;
  raise notice 'Password-only Preview probe OK: migration26, session-only guard, recovery tombstones, restrictive Storage policy, and historical table retained';
end;
$verify_authenticator_removed$;
