-- Preview-only verification after the forward supervisor upgrade through
-- migration 23 (20261024233053). The deployed Preview baseline is migration
-- 18; this probe must run only after 18→23 succeeds, never as a shortcut for
-- the distinct historical 13-migration preflight path.
-- The caller MUST independently verify project ref lypsqrwjzrmuyqtdcegr before
-- executing this file. SQL cannot establish the Supabase project identity.
-- Run as the SQL editor/migration owner, never through an application session.
-- No schema/object is created or dropped. All probe writes (including audit and
-- trigger effects) are rolled back by the mandatory inner sentinel exception.
-- Row locks live until this statement finishes. If safe existing fixtures cannot
-- be selected, fail closed; do not create users, tokens, or operational fixtures.

do $verify_readiness$
declare
  v_admin public.employees;
  v_subject public.employees;
  v_result public.employees;
  v_before_employee jsonb;
  v_before_roles text[];
  v_probe_roles text[];
  v_before_audit jsonb;
  v_before_followups jsonb;
  v_before_notifications jsonb;
  v_before_counts bigint[];
  v_after_counts bigint[];
  v_before_current_user text := current_user;
  v_before_sub text := nullif(current_setting('request.jwt.claim.sub', true), '');
  v_before_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_before_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_history text[];
  v_migration_names text[];
  v_has_migration_names boolean;
  v_inspect text;
  v_claim text;
  v_message text;
  v_rolled_back boolean := false;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null
    or (select count(*) from supabase_migrations.schema_migrations) <> 23 then
    raise exception 'Expected exact Preview baseline 18 plus supervisor migrations 19–23; stop and inspect migration history';
  end if;
  select exists(
    select 1 from pg_attribute
    where attrelid='supabase_migrations.schema_migrations'::regclass
      and attname='name' and not attisdropped
  ) into v_has_migration_names;
  if v_has_migration_names then
    execute 'select array_agg(name order by version) from supabase_migrations.schema_migrations' into v_migration_names;
    if v_migration_names is distinct from array[
      'hr_foundation','auth_support','private_files','directory_manual_attendance',
      'attendance_correction_overlap','attendance_selfie_metadata','hr_api_service_role_reads',
      'hr_leave_workflows','hr_notifications','cashier_operational_workflows',
      'biometric_push_verification','push_subscription_status','cashier_spv_weekly_roster',
      'cashier_spv_audit_repairs','cashier_spv_followup_repair_log_index',
      'cashier_followup_context_consistency','cashier_followup_context_locking',
      'close_readiness_audit_findings','supervisor_followup_queue',
      'supervisor_operations','supervisor_planning_reports','supervisor_operational_hardening',
      'supervisor_configuration_concurrency'
    ]::text[] then
      raise exception 'Preview migration names are not the ordered 18→23 supervisor upgrade; stop and inspect history';
    end if;
  else
    select array_agg(version order by version) into v_history from supabase_migrations.schema_migrations;
    if v_history is distinct from array[
      '202610030001','202610030002','202610030003','202610040004',
      '202610120005','202610120006','20261012094903','20261016063305',
      '20261016063418','20261018045749','20261018045909','20261018162525',
      '20261019061522','20261020060745','20261020060913','20261020092014',
      '20261021154511','20261022170000','20261023080451','20261023181824',
      '20261023183130','20261024110000','20261024233053'
    ]::text[] then
      raise exception 'Preview migration versions are not the ordered 18→23 supervisor upgrade; stop and inspect history';
    end if;
  end if;

  if to_regprocedure('public.hr_save_employee_with_roles(jsonb,uuid,text[],text)') is null then
    raise exception 'Readiness employee RPC is absent';
  end if;
  if not has_function_privilege('authenticated', 'public.hr_save_employee_with_roles(jsonb,uuid,text[],text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.hr_save_employee_with_roles(jsonb,uuid,text[],text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.inspect_account_token(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.inspect_account_token(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.inspect_account_token(text)', 'EXECUTE') then
    raise exception 'Readiness RPC execute privileges differ from the intended authenticated/service-only contract';
  end if;
  if not exists(select 1 from pg_proc where oid='public.hr_save_employee_with_roles(jsonb,uuid,text[],text)'::regprocedure
      and prosecdef and exists(select 1 from unnest(proconfig) as setting(value)
        where value in ('search_path=', 'search_path=""'))) then
    raise exception 'Employee RPC security-definer/search_path contract is absent';
  end if;

  -- These additive supervisor surfaces must stay behind authenticated RPC/RLS.
  -- This checks the deployed contract without reading operational content.
  if to_regprocedure('public.spv_followup_update_v2(uuid,bigint,uuid,text,uuid,text,text,timestamptz,text)') is null
    or to_regprocedure('public.outlet_issue_submit(uuid,uuid,text,text,text,uuid,uuid)') is null
    or to_regprocedure('public.shift_exchange_decide_v2(uuid,bigint,uuid,boolean,text)') is null
    or to_regprocedure('public.staffing_interval_requirement_save_v2(uuid,bigint,uuid,uuid,integer,time,time,integer,date,date,text)') is null
    or to_regprocedure('public.supervisor_interval_coverage(uuid,date)') is null
    or to_regprocedure('public.supervisor_report_page(date,date,uuid,uuid)') is null
    or to_regprocedure('public.shift_exchange_cancel_v2(uuid,bigint,uuid,text)') is null
    or to_regprocedure('public.shift_exchange_expire_stale_v2(uuid)') is null
    or to_regprocedure('public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean)') is null
    or to_regprocedure('public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean)') is null
    or to_regprocedure('public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean)') is null then
    raise exception 'Supervisor RPC contract is absent after migration 23';
  end if;
  if has_function_privilege('anon','public.spv_followup_update_v2(uuid,bigint,uuid,text,uuid,text,text,timestamptz,text)','EXECUTE')
    or has_function_privilege('anon','public.outlet_issue_submit(uuid,uuid,text,text,text,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.shift_exchange_decide_v2(uuid,bigint,uuid,boolean,text)','EXECUTE')
    or has_function_privilege('anon','public.staffing_interval_requirement_save_v2(uuid,bigint,uuid,uuid,integer,time,time,integer,date,date,text)','EXECUTE')
    or has_function_privilege('anon','public.supervisor_interval_coverage(uuid,date)','EXECUTE')
    or has_function_privilege('anon','public.supervisor_report_page(date,date,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.shift_exchange_cancel_v2(uuid,bigint,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.shift_exchange_expire_stale_v2(uuid)','EXECUTE')
    or has_function_privilege('anon','public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean)','EXECUTE')
    or has_function_privilege('anon','public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean)','EXECUTE')
    or has_function_privilege('anon','public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean)','EXECUTE')
    or not has_function_privilege('authenticated','public.spv_followup_update_v2(uuid,bigint,uuid,text,uuid,text,text,timestamptz,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.outlet_issue_submit(uuid,uuid,text,text,text,uuid,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.shift_exchange_decide_v2(uuid,bigint,uuid,boolean,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.staffing_interval_requirement_save_v2(uuid,bigint,uuid,uuid,integer,time,time,integer,date,date,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.supervisor_interval_coverage(uuid,date)','EXECUTE')
    or not has_function_privilege('authenticated','public.supervisor_report_page(date,date,uuid,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.shift_exchange_cancel_v2(uuid,bigint,uuid,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.shift_exchange_expire_stale_v2(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean)','EXECUTE')
    or not has_function_privilege('authenticated','public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean)','EXECUTE')
    or not has_function_privilege('authenticated','public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean)','EXECUTE') then
    raise exception 'Supervisor RPC execute grants differ from the intended authenticated-only contract';
  end if;
  if not exists(select 1 from pg_proc where oid='public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean)'::regprocedure
      and prosecdef and exists(select 1 from unnest(proconfig) as setting(value) where value in ('search_path=', 'search_path=""')))
    or not exists(select 1 from pg_proc where oid='public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean)'::regprocedure
      and prosecdef and exists(select 1 from unnest(proconfig) as setting(value) where value in ('search_path=', 'search_path=""')))
    or not exists(select 1 from pg_proc where oid='public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean)'::regprocedure
      and prosecdef and exists(select 1 from unnest(proconfig) as setting(value) where value in ('search_path=', 'search_path=""'))) then
    raise exception 'Configuration v2 RPC security-definer/search_path contract is absent';
  end if;
  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('supervisor_capabilities','supervisor_issue_categories','supervisor_issue_routes',
      'outlet_issues','outlet_issue_events','shift_handovers','shift_handover_versions','shift_handover_events',
      'shift_exchange_requests','shift_exchange_events','staffing_interval_requirements') and c.relkind='r' and not c.relrowsecurity
  ) then
    raise exception 'At least one exposed supervisor table lacks RLS';
  end if;
  if to_regclass('private.supervisor_configuration_receipts') is null
    or not exists(select 1 from pg_class where oid='private.supervisor_configuration_receipts'::regclass and relrowsecurity)
    or has_table_privilege('anon','private.supervisor_configuration_receipts','SELECT')
    or has_table_privilege('authenticated','private.supervisor_configuration_receipts','SELECT')
    or has_table_privilege('service_role','private.supervisor_configuration_receipts','SELECT') then
    raise exception 'Configuration receipt privacy/RLS contract is absent';
  end if;
  -- Keep the m23 target-recipient and replacement guards distinguishable from
  -- the older baseline: an Admin caller must not lend their own scope to a
  -- selected recipient, and a pending replacement must be rechecked before a
  -- final decision. These are definition-only checks; no operational case is
  -- created or modified by the readiness probe.
  if to_regprocedure('private.supervisor_target_has_capability(text,uuid,uuid,uuid)') is null
    or to_regprocedure('private.assert_shift_exchange_replacement_candidate(uuid,date,text)') is null
    or has_function_privilege('authenticated','private.supervisor_target_has_capability(text,uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.assert_shift_exchange_replacement_candidate(uuid,date,text)','EXECUTE') then
    raise exception 'Supervisor target/replacement private guard contract is absent or exposed';
  end if;
  select lower(prosrc) into strict v_inspect
    from pg_proc where oid='public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean)'::regprocedure;
  if position('private.supervisor_target_has_capability' in v_inspect)=0 then
    raise exception 'Route save no longer validates the selected recipient independently of the Admin caller';
  end if;
  select lower(prosrc) into strict v_inspect
    from pg_proc where oid='private.assert_shift_exchange_parties_available()'::regprocedure;
  if position('private.assert_shift_exchange_replacement_candidate' in v_inspect)=0 then
    raise exception 'Replacement eligibility is not rechecked by the pending/approved exchange trigger';
  end if;
  if exists(
    select 1 from unnest(array['outlet_issues','shift_handovers','shift_exchange_requests','staffing_interval_requirements']) expected(table_name)
    where not exists(
      select 1 from pg_catalog.pg_publication p
      join pg_catalog.pg_publication_rel pr on pr.prpubid=p.oid
      join pg_catalog.pg_class c on c.oid=pr.prrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where p.pubname='supabase_realtime' and n.nspname='public' and c.relname=expected.table_name
    )
  ) then
    raise exception 'Supervisor Realtime publication membership is incomplete';
  end if;

  -- Verify token policy from definitions only; no operational token is read,
  -- issued, claimed, changed, or consumed by this script.
  select lower(prosrc) into strict v_inspect from pg_proc where oid='public.inspect_account_token(text)'::regprocedure;
  select lower(prosrc) into strict v_claim from pg_proc where oid='public.claim_account_token(text,uuid)'::regprocedure;
  if position('private.require_service()' in v_inspect)=0
    or v_inspect !~ 'claimed_at\s*<=\s*now\(\)\s*-\s*interval\s*''5 minutes'''
    or v_inspect !~ 'expires_at\s*>\s*now\(\)'
    or v_inspect !~ 'revoked_at\s+is\s+null'
    or v_inspect !~ 'consumed_at\s+is\s+null'
    or v_claim !~ 'claimed_at\s*>\s*now\(\)\s*-\s*interval\s*''5 minutes''' then
    raise exception 'Inspect/claim abandoned-claim boundary or token exclusion predicates differ from migration 18';
  end if;

  select e.* into v_admin from public.employees e
    where e.status='active' and e.account_status='active' and e.auth_user_id is not null
      and exists(select 1 from public.employee_roles r where r.employee_id=e.id and r.role='admin_hr')
    order by e.employee_number limit 1 for no key update skip locked;
  if not found then raise exception 'No unlocked active linked Admin HR fixture; no writes were attempted'; end if;

  select e.* into v_subject from public.employees e
    where e.status='active' and e.account_status='active' and e.auth_user_id is not null and e.id<>v_admin.id
      and e.starts_on <= (now() at time zone 'Asia/Jakarta')::date
      and not exists(select 1 from public.employee_roles r where r.employee_id=e.id and r.role='admin_hr')
      and not exists(select 1 from public.employees d where d.approver_employee_id=e.id and d.status='active')
      and not exists(select 1 from public.account_tokens t where t.employee_id=e.id and t.consumed_at is null)
    order by e.employee_number limit 1 for no key update skip locked;
  if not found then
    raise exception 'No unlocked safe linked nonadmin fixture without active dependents/unconsumed tokens; no writes were attempted';
  end if;

  v_before_employee := to_jsonb(v_subject);
  select coalesce(array_agg(role order by role), array[]::text[]) into v_before_roles
    from public.employee_roles where employee_id=v_subject.id;
  if not 'employee'=any(v_before_roles) then raise exception 'Fixture lacks base employee role; no writes were attempted'; end if;
  v_probe_roles := case when 'head_baker'=any(v_before_roles) then array['employee']::text[]
    else array['employee','head_baker']::text[] end;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) into v_before_audit
    from public.audit_events a where a.entity_id=v_subject.id;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id), '[]'::jsonb) into v_before_followups
    from public.spv_followups f where f.employee_id=v_subject.id;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) into v_before_notifications
    from public.notifications n where n.employee_id=v_subject.id;
  select array[
    (select count(*) from public.employees where id=v_subject.id),
    (select count(*) from public.employee_roles where employee_id=v_subject.id),
    (select count(*) from public.audit_events where entity_id=v_subject.id),
    (select count(*) from public.account_tokens where employee_id=v_subject.id),
    (select count(*) from auth.users where id=v_subject.auth_user_id)
  ] into v_before_counts;

  begin
    perform set_config('request.jwt.claim.sub', v_admin.auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin.auth_user_id,'role','authenticated')::text, true);
    execute 'set local role authenticated';

    v_result := public.hr_save_employee_with_roles(
      jsonb_build_object('status','inactive','ends_on',(now() at time zone 'Asia/Jakarta')::date,
        'exit_reason','Probe migration 18: wajib rollback'),
      v_subject.id, v_probe_roles, 'Verifikasi Preview atomik; seluruh perubahan wajib rollback');
    if v_result.status<>'inactive' or v_result.account_status<>'disabled'
      or v_result.auth_user_id is distinct from v_subject.auth_user_id
      or v_result.employee_number is distinct from v_subject.employee_number
      or (select array_agg(role order by role) from public.employee_roles where employee_id=v_subject.id) is distinct from v_probe_roles then
      raise exception 'Disable/role replacement did not preserve identity and expected account state';
    end if;

    v_result := public.hr_save_employee_with_roles(
      jsonb_build_object('status','active','ends_on',v_subject.ends_on,'exit_reason',v_subject.exit_reason),
      v_subject.id, v_before_roles, 'Verifikasi reaktivasi identitas sama; wajib rollback');
    if v_result.status<>'active' or v_result.account_status<>'active'
      or v_result.auth_user_id is distinct from v_subject.auth_user_id
      or v_result.employee_number is distinct from v_subject.employee_number
      or (select array_agg(role order by role) from public.employee_roles where employee_id=v_subject.id) is distinct from v_before_roles then
      raise exception 'Reactivation/role restoration did not preserve the linked account identity';
    end if;
    if (select count(*) from public.audit_events where entity_id=v_subject.id) <= v_before_counts[3] then
      raise exception 'Employee probe did not write its required audit trail inside the rollback boundary';
    end if;

    -- Never remove this exception. It rolls back employee, role, audit, trigger,
    -- and SET LOCAL changes before any success is reported.
    raise exception 'READINESS_23_MANDATORY_ROLLBACK' using errcode='ZHR23';
  exception when sqlstate 'ZHR23' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'READINESS_23_MANDATORY_ROLLBACK' then raise; end if;
    v_rolled_back := true;
  end;

  if not v_rolled_back or current_user<>v_before_current_user
    or nullif(current_setting('request.jwt.claim.sub',true),'') is distinct from v_before_sub
    or nullif(current_setting('request.jwt.claim.role',true),'') is distinct from v_before_role
    or nullif(current_setting('request.jwt.claims',true),'') is distinct from v_before_claims then
    raise exception 'Mandatory rollback did not restore role/JWT context';
  end if;
  if (select to_jsonb(e) from public.employees e where e.id=v_subject.id) is distinct from v_before_employee
    or (select coalesce(array_agg(role order by role),array[]::text[]) from public.employee_roles where employee_id=v_subject.id) is distinct from v_before_roles
    or (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.audit_events a where a.entity_id=v_subject.id) is distinct from v_before_audit
    or (select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from public.spv_followups f where f.employee_id=v_subject.id) is distinct from v_before_followups
    or (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n where n.employee_id=v_subject.id) is distinct from v_before_notifications then
    raise exception 'Post-rollback employee/role/audit/followup/notification state differs; statement must abort';
  end if;
  select array[
    (select count(*) from public.employees where id=v_subject.id),
    (select count(*) from public.employee_roles where employee_id=v_subject.id),
    (select count(*) from public.audit_events where entity_id=v_subject.id),
    (select count(*) from public.account_tokens where employee_id=v_subject.id),
    (select count(*) from auth.users where id=v_subject.auth_user_id)
  ] into v_after_counts;
  if v_after_counts is distinct from v_before_counts then
    raise exception 'Post-rollback scoped row counts differ; statement must abort';
  end if;
end;
$verify_readiness$;

select 'PASS: Preview migrations 18→23 ACL/RLS contracts, private configuration receipts, Realtime membership, and authenticated employee lifecycle; mandatory rollback restored scoped state and JWT/role context' as verification;
