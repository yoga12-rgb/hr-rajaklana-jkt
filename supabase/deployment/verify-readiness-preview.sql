-- Preview-only verification for migration 18 (20261022170000).
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
  v_inspect text;
  v_claim text;
  v_message text;
  v_rolled_back boolean := false;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 18
    or (select max(version) from supabase_migrations.schema_migrations) <> '20261022170000'
    or not exists(select 1 from supabase_migrations.schema_migrations where version='20261021154511') then
    raise exception 'Expected exact Preview baseline 17 plus readiness migration 18; stop and inspect migration history';
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
    raise exception 'READINESS_18_MANDATORY_ROLLBACK' using errcode='ZHR18';
  exception when sqlstate 'ZHR18' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'READINESS_18_MANDATORY_ROLLBACK' then raise; end if;
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

select 'PASS: Preview migration 18 ACL/predicates and authenticated employee lifecycle; mandatory rollback restored scoped state and JWT/role context' as verification;
