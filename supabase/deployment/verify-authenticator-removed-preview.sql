-- Read-only final contract probe for the password-only Preview baseline.
-- Project identity and migration-version mapping must be verified by the
-- deployment runner before this SQL is sent to a hosted project.
begin read only;

do $verify_authenticator_removed$
declare
  v_names text[];
  v_table text;
  v_signature text;
  v_oid oid;
  v_auth oid := (select oid from pg_roles where rolname = 'authenticated');
begin
  if v_auth is null then raise exception 'authenticated role is missing'; end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'Final password-only probe requires migration history';
  end if;
  select array_agg(name order by version) into v_names from supabase_migrations.schema_migrations;
  if v_names is distinct from array[
    'hr_foundation','auth_support','private_files','directory_manual_attendance',
    'attendance_correction_overlap','attendance_selfie_metadata','hr_api_service_role_reads',
    'hr_leave_workflows','hr_notifications','cashier_operational_workflows',
    'biometric_push_verification','push_subscription_status','cashier_spv_weekly_roster',
    'cashier_spv_audit_repairs','cashier_spv_followup_repair_log_index',
    'cashier_followup_context_consistency','cashier_followup_context_locking',
    'close_readiness_audit_findings','supervisor_followup_queue','supervisor_operations',
    'supervisor_planning_reports','supervisor_operational_hardening',
    'supervisor_configuration_concurrency','sensitive_operational_acl_hardening',
    'privileged_account_mfa_enforcement','retire_application_authenticator'
  ]::text[] then
    raise exception 'Final migration history is not the independently reviewed ordered 26-name contract';
  end if;
  if not exists(select 1 from supabase_migrations.schema_migrations
    where name='retire_application_authenticator' and version::bigint >= 20261030031318) then
    raise exception 'Authenticator retirement migration is missing or older than the local final baseline';
  end if;

  -- Every security helper is a private, fixed-search_path definer. The
  -- product no longer has an employee_requires_mfa guard.
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='employee_requires_mfa') then
    raise exception 'retired employee MFA gate still exists';
  end if;
  foreach v_signature in array array[
    'private.raw_employee_id()','private.session_access_context()','private.session_allowed()',
    'private.employee_id()','private.require_employee()','private.require_hr()',
    'public.auth_access_context()'
  ] loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null or not exists(select 1 from pg_proc p where p.oid=v_oid and p.prosecdef
      and coalesce(array_to_string(p.proconfig,';'),'') ~ '(^|;)search_path=(""|$)') then
      raise exception 'security helper/definer/search_path contract missing for %', v_signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE') then
      raise exception 'anonymous EXECUTE is not permitted for %', v_signature;
    end if;
  end loop;
  if not exists(select 1 from pg_proc where oid='private.employee_id()'::regprocedure and prosrc ~* 'session_allowed')
    or not exists(select 1 from pg_proc where oid='private.require_employee()'::regprocedure and prosrc ~* 'session_access_context')
    or not exists(select 1 from pg_proc where oid='private.require_hr()'::regprocedure and prosrc ~* 'require_employee')
    or not exists(select 1 from pg_proc where oid='public.auth_access_context()'::regprocedure and prosrc ~* 'session_access_context') then
    raise exception 'actor/HR helper chain no longer reaches the live-session context';
  end if;

  -- Public operational inventory: all exposed tables must retain RLS and the
  -- restrictive live-session policy. Predicate text is inspected as an
  -- expression, not by a weak substring-only requires_mfa check.
  foreach v_table in array array[
    'departments','positions','outlets','employees','employee_roles','audit_events',
    'account_tokens','attendance','leave_requests','leave_adjustments','leave_ledger',
    'notifications','cashier_assignments','attendance_correction_requests','biometric_references',
    'staffing_requirements','cashier_roster_batches','spv_followups',
    'supervisor_issue_categories','supervisor_capabilities','supervisor_issue_routes',
    'outlet_issues','outlet_issue_events','shift_handovers','shift_handover_versions',
    'shift_handover_events','shift_exchange_requests','shift_exchange_events','staffing_interval_requirements'
  ] loop
    v_oid := to_regclass('public.'||v_table);
    if v_oid is null or not exists(select 1 from pg_class where oid=v_oid and relrowsecurity) then
      raise exception 'public table/RLS missing: %',v_table;
    end if;
    if not exists(select 1 from pg_policy p where p.polrelid=v_oid and p.polname='privileged_mfa_session'
      and not p.polpermissive and v_auth=any(p.polroles)
      and pg_get_expr(p.polqual,p.polrelid) ~* 'private\.session_allowed\(\)'
      and pg_get_expr(p.polwithcheck,p.polrelid) ~* 'private\.session_allowed\(\)'
      and pg_get_expr(p.polqual,p.polrelid) !~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)'
      and pg_get_expr(p.polwithcheck,p.polrelid) !~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)') then
      raise exception 'restrictive live-session policy missing or weakened on %',v_table;
    end if;
    if exists(select 1 from pg_policy p where p.polrelid=v_oid and p.polname='privileged_mfa_session'
      and (p.polpermissive or pg_get_expr(p.polqual,p.polrelid) ~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)'
        or pg_get_expr(p.polwithcheck,p.polrelid) ~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)')) then
      raise exception 'live-session policy is permissive/always-true on %',v_table;
    end if;
  end loop;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity)
    or not exists(select 1 from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='privileged_mfa_session'
      and not p.polpermissive and v_auth=any(p.polroles)
      and pg_get_expr(p.polqual,p.polrelid) ~* 'private\.session_allowed\(\)'
      and pg_get_expr(p.polwithcheck,p.polrelid) ~* 'private\.session_allowed\(\)'
      and pg_get_expr(p.polqual,p.polrelid) !~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)'
      and pg_get_expr(p.polwithcheck,p.polrelid) !~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)') then
    raise exception 'Storage restrictive live-session policy is missing or weakened';
  end if;

  -- Direct DML remains closed on the eleven sensitive workflow tables while
  -- scoped SELECT/RPC access remains available to authenticated users.
  foreach v_table in array array[
    'shift_handovers','shift_handover_versions','shift_handover_events',
    'shift_exchange_requests','shift_exchange_events','supervisor_issue_categories',
    'supervisor_capabilities','supervisor_issue_routes','outlet_issues',
    'outlet_issue_events','staffing_interval_requirements'
  ] loop
    v_oid := to_regclass('public.'||v_table);
    if has_table_privilege('anon',v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',v_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or not has_table_privilege('authenticated',v_oid,'SELECT') then
      raise exception 'sensitive operational ACL differs from SELECT/RPC boundary: %',v_table;
    end if;
  end loop;
  foreach v_signature in array array['public.account_tokens','public.cashier_roster_batches','private.mfa_recovery_requests'] loop
    v_oid := to_regclass(v_signature);
    if v_oid is null or not exists(select 1 from pg_class where oid=v_oid and relrowsecurity)
      or has_table_privilege('anon',v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'private workflow table is missing RLS or has public data access: %',v_signature;
    end if;
  end loop;

  -- Both historical recovery names are tombstones. Checking all effective
  -- roles catches grants inherited through PUBLIC as well as direct grants.
  foreach v_signature in array array[
    'public.auth_mfa_recovery_authorize(uuid,uuid,text)',
    'public.auth_mfa_recovery_complete(uuid,boolean)'
  ] loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then raise exception 'retired recovery function missing: %',v_signature; end if;
    if has_function_privilege('anon',v_oid,'EXECUTE')
      or has_function_privilege('authenticated',v_oid,'EXECUTE')
      or has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'retired recovery function is executable through an effective grant: %',v_signature;
    end if;
  end loop;
  if not exists(select 1 from pg_class where oid='private.mfa_recovery_requests'::regclass) then
    raise exception 'historical recovery table was removed';
  end if;
  if not exists(select 1 from pg_proc where oid='private.session_access_context()'::regprocedure and prosrc ~* 'requires_mfa') then
    raise exception 'password-only context response contract is missing';
  end if;
end;
$verify_authenticator_removed$;

commit;
