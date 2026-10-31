-- Read-only final contract probe for the password-only Preview baseline.
-- Project identity and migration-version mapping must be verified by the
-- deployment runner before this SQL is sent to a hosted project.
begin read only;

do $verify_authenticator_removed$
declare
  v_names text[];
  v_version_name_pairs text[];
  v_table text;
  v_signature text;
  v_oid oid;
  v_auth oid := (select oid from pg_roles where rolname = 'authenticated');
  v_normalized text;
  v_actual text;
  v_contract record;
  v_recovery_count bigint;
  v_recovery_count_after bigint;
  v_audit_count bigint;
  v_audit_count_after bigint;
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
  select array_agg(version||'/'||name order by version) into v_version_name_pairs
    from supabase_migrations.schema_migrations;
  if v_version_name_pairs is distinct from array[
    '202610030001/hr_foundation','202610030002/auth_support','202610030003/private_files',
    '202610040004/directory_manual_attendance','202610120005/attendance_correction_overlap',
    '202610120006/attendance_selfie_metadata','20261012094903/hr_api_service_role_reads',
    '20261016063305/hr_leave_workflows','20261016063418/hr_notifications',
    '20261018045749/cashier_operational_workflows','20261018045909/biometric_push_verification',
    '20261018162525/push_subscription_status','20261019061522/cashier_spv_weekly_roster',
    '20261020060745/cashier_spv_audit_repairs','20261020060913/cashier_spv_followup_repair_log_index',
    '20261020092014/cashier_followup_context_consistency','20261021154511/cashier_followup_context_locking',
    '20261022170000/close_readiness_audit_findings','20261023080451/supervisor_followup_queue',
    '20261023181824/supervisor_operations','20261023183130/supervisor_planning_reports',
    '20261024110000/supervisor_operational_hardening','20261024233053/supervisor_configuration_concurrency',
    '20261027090000/sensitive_operational_acl_hardening','20261027090100/privileged_account_mfa_enforcement',
    '20261030031318/retire_application_authenticator'
  ]::text[] and v_version_name_pairs is distinct from array[
    '202610030001/hr_foundation','202610030002/auth_support','202610030003/private_files',
    '202610040004/directory_manual_attendance','202610120005/attendance_correction_overlap',
    '202610120006/attendance_selfie_metadata','20261012094903/hr_api_service_role_reads',
    '20261016063305/hr_leave_workflows','20261016063418/hr_notifications',
    '20261018045749/cashier_operational_workflows','20261018045909/biometric_push_verification',
    '20261018162525/push_subscription_status','20261019061522/cashier_spv_weekly_roster',
    '20261020060745/cashier_spv_audit_repairs','20261020060913/cashier_spv_followup_repair_log_index',
    '20261020092014/cashier_followup_context_consistency','20261021154511/cashier_followup_context_locking',
    '20261022170000/close_readiness_audit_findings','20261025044841/supervisor_followup_queue',
    '20261025044859/supervisor_operations','20261025044910/supervisor_planning_reports',
    '20261025045641/supervisor_operational_hardening','20261025050057/supervisor_configuration_concurrency',
    '20261027031129/sensitive_operational_acl_hardening','20261029032121/privileged_account_mfa_enforcement',
    '20261030033256/retire_application_authenticator'
  ]::text[] then
    raise exception 'Final migration history differs from the independently reviewed ordered version-name contract';
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
    'private.employee_id()','private.has_role(text)','private.require_employee()','private.require_hr()',
    'public.auth_access_context()'
  ] loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null or not exists(select 1 from pg_proc p where p.oid=v_oid and p.prosecdef
      and coalesce(array_to_string(p.proconfig,';'),'') ~ '(^|;)search_path=(""|$)') then
      raise exception 'security helper/definer/search_path contract missing for %', v_signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE')
      and (split_part(v_signature,'.',1)<>'private' or v_signature<>'private.has_role(text)'
        or has_schema_privilege('anon','private','USAGE')) then
      raise exception 'anonymous EXECUTE is not permitted for %', v_signature;
    end if;
    if v_signature in ('private.raw_employee_id()','private.session_access_context()','private.require_employee()','private.require_hr()')
      and has_function_privilege('authenticated',v_oid,'EXECUTE') then
      raise exception 'internal helper EXECUTE is not permitted for authenticated: %', v_signature;
    end if;
  end loop;
  if not has_function_privilege('authenticated','private.employee_id()'::regprocedure,'EXECUTE')
    or not has_function_privilege('authenticated','private.session_allowed()'::regprocedure,'EXECUTE')
    or not has_function_privilege('authenticated','public.auth_access_context()'::regprocedure,'EXECUTE') then
    raise exception 'password-only identity helper grants are missing';
  end if;
  -- Compare each security helper with independently reviewed source contracts.
  -- Only leading/trailing body whitespace is removed; literals, internal
  -- whitespace, comments, operators and identifier case remain byte-sensitive.
  -- Keep each source body aligned with the final migration/foundation contract.
  for v_contract in
    select * from (values
      ('private.raw_employee_id()', $helper$select e.id from public.employees e
  where e.auth_user_id=auth.uid() and e.status='active' and e.account_status='active';$helper$),
      ('private.session_access_context()', $helper$declare
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
end;$helper$),
      ('private.session_allowed()', $helper$select (private.session_access_context()->>'allowed')::boolean;$helper$),
      ('private.employee_id()', $helper$select case when private.session_allowed() then private.raw_employee_id() else null end;$helper$),
      ('private.has_role(text)', $helper$select exists(select 1 from public.employee_roles where employee_id = private.employee_id() and role = p_role);$helper$),
      ('private.require_employee()', $helper$declare v_context jsonb:=private.session_access_context();
begin
  if v_context->>'reason'='session_revoked' then
    raise exception 'Sesi tidak berlaku. Silakan login kembali' using errcode='42501';
  elsif not (v_context->>'allowed')::boolean then
    raise exception 'Akun karyawan tidak aktif' using errcode='42501';
  end if;
  return (v_context->>'employee_id')::uuid;
end;$helper$),
      ('private.require_hr()', $helper$declare v_actor uuid:=private.require_employee();
begin
  if not private.has_role('admin_hr') then
    raise exception 'Akses Admin HR diperlukan' using errcode='42501';
  end if;
  return v_actor;
end;$helper$),
      ('public.auth_access_context()', $helper$select private.session_access_context();$helper$)
    ) as expected(signature, source)
  loop
    select regexp_replace(p.prosrc, '^\s+|\s+$', '', 'g')
      into v_actual from pg_proc p where p.oid=to_regprocedure(v_contract.signature);
    if v_actual is distinct from regexp_replace(v_contract.source, '^\s+|\s+$', '', 'g') then
      raise exception 'helper definition differs from independent reviewed contract: %', v_contract.signature;
    end if;
  end loop;

  if not exists(select 1 from pg_proc where oid='private.raw_employee_id()'::regprocedure
      and prosrc ~* 'auth\.uid\(\)' and prosrc ~* 'status\s*=\s*''active'''
      and prosrc ~* 'account_status\s*=\s*''active''' and prosrc !~* 'select\s+true')
    or not exists(select 1 from pg_proc where oid='private.session_access_context()'::regprocedure
      and prosrc ~* 'auth\.sessions' and prosrc ~* 'auth\.uid\(\)'
      and prosrc ~* 'not_after' and prosrc ~* 'session_revoked'
      and prosrc ~* 'requires_mfa' and prosrc ~* 'v_reason\s+is\s+null'
      and prosrc !~* '''allowed''\s*,\s*true' and prosrc !~* 'allowed\s*:=\s*true')
    or not exists(select 1 from pg_proc where oid='private.session_allowed()'::regprocedure
      and prosrc ~* 'session_access_context' and prosrc ~* 'allowed' and prosrc ~* '::boolean'
      and prosrc !~* '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)'
      and prosrc !~* '\m(or|coalesce|case|when)\M')
    or not exists(select 1 from pg_proc where oid='private.employee_id()'::regprocedure and prosrc ~* 'session_allowed')
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
      and not p.polpermissive and p.polcmd='*' and p.polroles = array[v_auth]::oid[]
      and regexp_replace(lower(coalesce(pg_get_expr(p.polqual,p.polrelid),'')),'\s+','','g') = '(selectprivate.session_allowed()assession_allowed)'
      and regexp_replace(lower(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')),'\s+','','g') = '(selectprivate.session_allowed()assession_allowed)') then
      raise exception 'restrictive live-session policy missing or weakened on %',v_table;
    end if;
    if exists(select 1 from pg_policy p where p.polrelid=v_oid and p.polname='privileged_mfa_session'
      and (p.polpermissive or p.polcmd<>'*' or p.polroles <> array[v_auth]::oid[]
        or regexp_replace(lower(coalesce(pg_get_expr(p.polqual,p.polrelid),'')),'\s+','','g') <> '(selectprivate.session_allowed()assession_allowed)'
        or regexp_replace(lower(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')),'\s+','','g') <> '(selectprivate.session_allowed()assession_allowed)')) then
      raise exception 'live-session policy is permissive/always-true on %',v_table;
    end if;
  end loop;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity)
    or not exists(select 1 from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='privileged_mfa_session'
      and not p.polpermissive and p.polcmd='*' and p.polroles = array[v_auth]::oid[]
      and regexp_replace(lower(coalesce(pg_get_expr(p.polqual,p.polrelid),'')),'\s+','','g') = '(selectprivate.session_allowed()assession_allowed)'
      and regexp_replace(lower(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')),'\s+','','g') = '(selectprivate.session_allowed()assession_allowed)') then
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
    if not exists(select 1 from pg_proc p where p.oid=v_oid and p.prosecdef and p.prorettype='jsonb'::regtype
      and p.prolang=(select oid from pg_language where lanname='plpgsql')
      and coalesce(array_to_string(p.proconfig,';'),'') ~ '(^|;)search_path=(""|$)') then
      raise exception 'retired recovery tombstone metadata differs from contract: %',v_signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE')
      or has_function_privilege('authenticated',v_oid,'EXECUTE')
      or has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'retired recovery function is executable through an effective grant: %',v_signature;
    end if;
  end loop;
  if exists(
    select 1 from (values
      ('public.auth_mfa_recovery_authorize(uuid,uuid,text)'::text,
       $tombstone$begin
  raise exception 'Pemulihan autentikator sudah dihentikan. Login menggunakan nomor karyawan dan kata sandi.' using errcode='0A000';
end;$tombstone$),
      ('public.auth_mfa_recovery_complete(uuid,boolean)'::text,
       $tombstone$begin
  raise exception 'Pemulihan autentikator sudah dihentikan.' using errcode='0A000';
end;$tombstone$)
    ) expected(signature,source)
    join pg_proc p on p.oid=to_regprocedure(expected.signature)
    where regexp_replace(p.prosrc, '^\s+|\s+$', '', 'g')
      is distinct from regexp_replace(expected.source, '^\s+|\s+$', '', 'g')
  ) then
    raise exception 'retired recovery tombstone body differs from exact contract';
  end if;
  -- Invoke both owner-only tombstones inside exception subtransactions. Their
  -- exact bodies raise 0A000 before any recovery/audit side effect.
  select count(*) into v_recovery_count from private.mfa_recovery_requests;
  select count(*) into v_audit_count from public.audit_events;
  begin
    perform public.auth_mfa_recovery_authorize(null,null,'contract probe');
    raise exception 'recovery authorize tombstone returned instead of raising 0A000';
  exception when feature_not_supported then null;
  end;
  begin
    perform public.auth_mfa_recovery_complete(null,false);
    raise exception 'recovery complete tombstone returned instead of raising 0A000';
  exception when feature_not_supported then null;
  end;
  select count(*) into v_recovery_count_after from private.mfa_recovery_requests;
  select count(*) into v_audit_count_after from public.audit_events;
  if v_recovery_count_after <> v_recovery_count or v_audit_count_after <> v_audit_count then
    raise exception 'recovery tombstone changed recovery or audit history';
  end if;
  if not exists(select 1 from pg_class where oid='private.mfa_recovery_requests'::regclass) then
    raise exception 'historical recovery table was removed';
  end if;
  if not exists(select 1 from pg_proc where oid='private.session_access_context()'::regprocedure and prosrc ~* 'requires_mfa') then
    raise exception 'password-only context response contract is missing';
  end if;
end;
$verify_authenticator_removed$;

commit;
