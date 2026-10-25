-- Run only after migrations 19–21 are applied and before applying
-- 20261024110000_supervisor_operational_hardening. This is a read-only,
-- fail-closed gate for the two partial unique indexes in that migration.
-- It never cancels, expires, deletes, or rewrites operational requests.

begin;

do $$
declare v_history text[];v_names text[];v_has_names boolean;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'Migration history is unavailable; do not run this preflight';
  end if;
  select array_agg(version order by version) into v_history from supabase_migrations.schema_migrations;
  select exists(
    select 1 from pg_attribute
    where attrelid='supabase_migrations.schema_migrations'::regclass
      and attname='name' and not attisdropped
  ) into v_has_names;
  -- The normal CLI preserves filename versions. The managed deployment
  -- connector writes a deployment timestamp as `version` but retains the
  -- migration `name`. Both forms are safe only when the complete ordered
  -- baseline is exactly 1–21, so do not use a mere count/max check.
  if v_has_names then
    execute 'select array_agg(name order by version) from supabase_migrations.schema_migrations' into v_names;
    if v_names is distinct from array[
      'hr_foundation','auth_support','private_files','directory_manual_attendance',
      'attendance_correction_overlap','attendance_selfie_metadata','hr_api_service_role_reads',
      'hr_leave_workflows','hr_notifications','cashier_operational_workflows',
      'biometric_push_verification','push_subscription_status','cashier_spv_weekly_roster',
      'cashier_spv_audit_repairs','cashier_spv_followup_repair_log_index',
      'cashier_followup_context_consistency','cashier_followup_context_locking',
      'close_readiness_audit_findings','supervisor_followup_queue',
      'supervisor_operations','supervisor_planning_reports'
    ]::text[] then
      raise exception 'Preflight applies only after the ordered Preview migration names 1–21 and before supervisor hardening';
    end if;
  elsif v_history is distinct from array[
    '202610030001','202610030002','202610030003','202610040004',
    '202610120005','202610120006','20261012094903','20261016063305',
    '20261016063418','20261018045749','20261018045909','20261018162525',
    '20261019061522','20261020060745','20261020060913','20261020092014',
    '20261021154511','20261022170000','20261023080451','20261023181824',
    '20261023183130'
  ]::text[] then
    raise exception 'Preflight applies only after Preview migrations 1–21 and before supervisor hardening';
  end if;
  if to_regclass('public.shift_exchange_requests') is null then
    raise exception 'Expected shift_exchange_requests source table was not found';
  end if;
  if exists(
    select 1 from public.shift_exchange_requests
    where status in ('pending_peer','pending_spv')
    group by requester_assignment_id having count(*)>1
  ) then
    raise exception 'Duplicate active exchange requests share a requester assignment; no data was changed';
  end if;
  if exists(
    select 1 from public.shift_exchange_requests
    where status in ('pending_peer','pending_spv')
    group by peer_employee_id,work_date having count(*)>1
  ) then
    raise exception 'Duplicate active exchange requests share a peer and work date; no data was changed';
  end if;
end;
$$;

commit;
