-- Run only when upgrading a database whose migration history ends at
-- 20261019061522_cashier_spv_weekly_roster, before applying
-- 20261020060745_cashier_spv_audit_repairs.
-- This adds the final shift value early so the historical backfill can complete.
-- It does not alter migration history or modify/delete application rows.

begin;

do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'Migration history is unavailable; do not run this preflight';
  end if;
  if (select array_agg(version order by version) from supabase_migrations.schema_migrations)
      is distinct from array[
        '202610030001','202610030002','202610030003','202610040004',
        '202610120005','202610120006','20261012094903','20261016063305',
        '20261016063418','20261018045749','20261018045909','20261018162525',
        '20261019061522'
      ]::text[] then
    raise exception 'Preflight applies only after cashier_spv_weekly_roster and before later migrations';
  end if;
  if to_regclass('public.spv_followups') is null or to_regclass('public.cashier_assignments') is null
    or not exists(select 1 from pg_constraint where conrelid='public.spv_followups'::regclass and conname='spv_followups_shift_check') then
    raise exception 'Expected Tahap A source schema was not found';
  end if;
end
$$;

alter table public.spv_followups drop constraint spv_followups_shift_check;
alter table public.spv_followups add constraint spv_followups_shift_check
  check (shift is null or shift in ('morning','afternoon','middle','off'));

commit;
