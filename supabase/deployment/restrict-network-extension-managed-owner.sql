-- OPERATOR PROCEDURE, NOT AN APPLICATION MIGRATION.
-- Verify Preview project ref lypsqrwjzrmuyqtdcegr independently first.
-- Requires the managed net owner (supabase_admin) or a platform superuser.
-- Hosted postgres is not this owner and has no EXECUTE grant option; it must
-- not mark this procedure applied or silently claim network hardening passed.
-- Run only through an authorized managed-owner/platform-support procedure.
-- No migration history, HR data, audit, or push config is modified here.
--
-- pg_net 0.20.4 is non-relocatable on Preview. Its extension namespace is
-- public, but its callable HTTP/worker routines live in net. Keep the extension
-- installed and restrict direct access instead of attempting ALTER EXTENSION.
-- Preserve existing service access and the exact internal push dependency.
-- After any managed extension upgrade, rerun the catalog probe: an extension
-- update can recreate default PUBLIC function grants.
begin;
do $require_managed_owner$
declare v_actor oid:=current_user::regrole::oid;
begin
  if to_regnamespace('net') is null then
    raise exception 'Managed network operator procedure requires existing net schema';
  end if;
  if not exists(select 1 from pg_roles where oid=v_actor and rolsuper)
    and (not exists(select 1 from pg_namespace where nspname='net' and nspowner=v_actor)
      or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='net' and p.prokind='f' and p.proowner<>v_actor)) then
    raise exception 'Managed network owner required; hosted postgres cannot safely revoke extension grants';
  end if;
end;
$require_managed_owner$;

do $restrict_net$
declare
  v_function record;
  v_service_usage boolean;
  v_service_create boolean;
  v_wake_owner name;
  v_http_post oid;
begin
  v_service_usage:=has_schema_privilege('service_role','net','USAGE');
  v_service_create:=has_schema_privilege('service_role','net','CREATE');
  if v_service_usage then grant usage on schema net to service_role;end if;
  if v_service_create then grant create on schema net to service_role;end if;

  for v_function in
    select p.oid,p.oid::regprocedure as signature,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='net' and p.prokind='f'
  loop
    if v_function.service_execute then
      execute format('grant execute on function %s to service_role',v_function.signature);
    end if;
    execute format('revoke all on function %s from public,anon,authenticated',v_function.signature);
    if has_function_privilege('anon',v_function.oid,'EXECUTE')
      or has_function_privilege('authenticated',v_function.oid,'EXECUTE')
      or has_function_privilege('service_role',v_function.oid,'EXECUTE') is distinct from v_function.service_execute then
      raise exception 'Network function ACL could not be safely restricted: %',v_function.signature;
    end if;
  end loop;

  -- wake_push_worker is SECURITY DEFINER and calls this routine dynamically.
  -- Preserve its owner's effective access even if it previously came only
  -- from PUBLIC; do not grant callers access to the helper itself.
  v_http_post:=to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)');
  select r.rolname into v_wake_owner from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid=to_regprocedure('private.wake_push_worker()');
  if v_wake_owner is not null and v_http_post is not null then
    execute format('grant usage on schema net to %I',v_wake_owner);
    execute format('grant execute on function %s to %I',v_http_post::regprocedure,v_wake_owner);
  end if;
  revoke all on schema net from public,anon,authenticated;
  if has_schema_privilege('anon','net','USAGE,CREATE')
    or has_schema_privilege('authenticated','net','USAGE,CREATE')
    or has_schema_privilege('service_role','net','USAGE') is distinct from v_service_usage
    or has_schema_privilege('service_role','net','CREATE') is distinct from v_service_create then
    raise exception 'Network schema ACL could not be safely restricted';
  end if;
  if v_wake_owner is not null and v_http_post is not null
    and (not has_schema_privilege(v_wake_owner,'net','USAGE')
      or not has_function_privilege(v_wake_owner,v_http_post,'EXECUTE')) then
    raise exception 'Network hardening would break the internal push worker';
  end if;
end;
$restrict_net$;
commit;
