-- Preview-only CATALOG probe for the exact ordered 25-migration baseline.
-- Independently verify project ref lypsqrwjzrmuyqtdcegr before running this
-- file as the migration owner. SQL cannot prove a Supabase project identity.
-- This transaction is read-only: no claims, operational fixture, Auth session,
-- factor, audit row, token, schema, or privilege is created/changed by it.
-- It proves deployment contracts; browser/real-session MFA workflows are a
-- separate gate and cannot be inferred from this result.
begin read only;

do $verify_mfa_readiness$
declare
  v_names text[];
  v_table text;
  v_signature text;
  v_oid oid;
  v_auth oid:=(select oid from pg_roles where rolname='authenticated');
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'MFA readiness requires migration history';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='supabase_migrations.schema_migrations'::regclass
      and attname='name' and not attisdropped) then
    raise exception 'MFA readiness requires ordered migration names; stop and inspect history';
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
    'privileged_account_mfa_enforcement'
  ]::text[] then
    raise exception 'Expected exact ordered MFA Preview baseline 25; stop and inspect history';
  end if;

  foreach v_signature in array array[
    'private.raw_employee_id()','private.employee_requires_mfa(uuid)',
    'private.session_access_context()','private.session_allowed()',
    'private.employee_id()','private.require_employee()','private.require_hr()',
    'public.auth_access_context()','public.auth_mfa_recovery_authorize(uuid,uuid,text)',
    'public.auth_mfa_recovery_complete(uuid,boolean)'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null or not exists(select 1 from pg_proc where oid=v_oid and prosecdef
      and exists(select 1 from unnest(proconfig) s where s in ('search_path=','search_path=""'))) then
      raise exception 'MFA helper/definer/search_path contract missing for %',v_signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE') then
      raise exception 'Anonymous EXECUTE is not permitted for %',v_signature;
    end if;
  end loop;
  if not has_function_privilege('authenticated','public.auth_access_context()','EXECUTE')
    or not has_function_privilege('authenticated','public.auth_mfa_recovery_authorize(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.auth_mfa_recovery_complete(uuid,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.auth_mfa_recovery_complete(uuid,boolean)','EXECUTE') then
    raise exception 'MFA public RPC grants differ from the authenticated/service boundary';
  end if;
  foreach v_signature in array array['private.raw_employee_id()','private.employee_requires_mfa(uuid)','private.session_access_context()'] loop
    if has_function_privilege('authenticated',v_signature,'EXECUTE') then
      raise exception 'Internal MFA helper is exposed: %',v_signature;
    end if;
  end loop;
  if not exists(select 1 from pg_proc where oid='private.employee_id()'::regprocedure and prosrc like '%private.session_allowed()%')
    or not exists(select 1 from pg_proc where oid='private.require_employee()'::regprocedure and prosrc like '%private.session_access_context()%')
    or not exists(select 1 from pg_proc where oid='private.require_hr()'::regprocedure and prosrc like '%private.require_employee()%') then
    raise exception 'Central actor/HR checks no longer depend on the session MFA guard';
  end if;
  foreach v_signature in array array['auth.sessions','auth.mfa_factors'] loop
    if to_regclass(v_signature) is null then raise exception 'Managed Auth table missing: %',v_signature;end if;
  end loop;
  if exists(select 1 from (values('sessions','id'),('sessions','user_id'),('sessions','factor_id'),
       ('sessions','aal'),('sessions','not_after'),('mfa_factors','id'),('mfa_factors','user_id'),
       ('mfa_factors','status'),('mfa_factors','factor_type')) expected(table_name,column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='auth'
      and c.table_name=expected.table_name and c.column_name=expected.column_name)) then
    raise exception 'Managed Auth session/factor schema differs from the MFA contract';
  end if;

  foreach v_table in array array[
    'departments','positions','outlets','employees','employee_roles','audit_events',
    'account_tokens','attendance','leave_requests','leave_adjustments','leave_ledger',
    'notifications','cashier_assignments','attendance_correction_requests','biometric_references',
    'staffing_requirements','cashier_roster_batches','spv_followups',
    'supervisor_issue_categories','supervisor_capabilities','supervisor_issue_routes',
    'outlet_issues','outlet_issue_events','shift_handovers','shift_handover_versions',
    'shift_handover_events','shift_exchange_requests','shift_exchange_events','staffing_interval_requirements'
  ] loop
    v_oid:=to_regclass('public.'||v_table);
    if v_oid is null or not exists(select 1 from pg_class where oid=v_oid and relrowsecurity) then
      raise exception 'Operational table/RLS missing: %',v_table;
    end if;
    if not exists(select 1 from pg_policy where polrelid=v_oid and polname='privileged_mfa_session'
      and not polpermissive and polroles=array[v_auth]
      and pg_get_expr(polqual,polrelid) like '%private.session_allowed()%'
      and pg_get_expr(polwithcheck,polrelid) like '%private.session_allowed()%') then
      raise exception 'Restrictive MFA policy missing or weakened on %',v_table;
    end if;
  end loop;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity)
    or not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='privileged_mfa_session'
      and not polpermissive and polroles=array[v_auth]
      and pg_get_expr(polqual,polrelid) like '%private.session_allowed()%'
      and pg_get_expr(polwithcheck,polrelid) like '%private.session_allowed()%') then
    raise exception 'Storage restrictive MFA session policy is missing or weakened';
  end if;

  foreach v_table in array array[
    'shift_handovers','shift_handover_versions','shift_handover_events',
    'shift_exchange_requests','shift_exchange_events','supervisor_issue_categories',
    'supervisor_capabilities','supervisor_issue_routes','outlet_issues','outlet_issue_events','staffing_interval_requirements'
  ] loop
    v_oid:=to_regclass('public.'||v_table);
    if has_table_privilege('anon',v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',v_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or not has_table_privilege('authenticated',v_oid,'SELECT') then
      raise exception 'Operational ACL differs from the hardened SELECT/RPC boundary: %',v_table;
    end if;
  end loop;
  foreach v_signature in array array['public.account_tokens','public.cashier_roster_batches','private.mfa_recovery_requests'] loop
    v_oid:=to_regclass(v_signature);
    if v_oid is null or not exists(select 1 from pg_class where oid=v_oid and relrowsecurity)
      or has_table_privilege('anon',v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Private workflow table is missing RLS or has public data access: %',v_signature;
    end if;
  end loop;

  -- pg_net is a separate OPEN managed-owner finding. Inspect it using
  -- inspect-network-extension-access.sql; passing this MFA probe does not
  -- assert that its grants were restricted by the application migration.
end;
$verify_mfa_readiness$;

commit;
