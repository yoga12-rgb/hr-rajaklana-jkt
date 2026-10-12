-- DESTRUCTIVE OPERATOR SCRIPT: removes the 13 known legacy HR tables and rows.
-- Target reviewed: iywvnopsooroediwawnd / Rajaklana, 12 October 2026.
-- Authorization: user explicitly requested deleting old tables/data and reusing
-- this project for the new HR application. This is NOT a reusable migration.
-- Verify the target project externally; run with the first application migration
-- in ONE transaction so a failed replacement rolls back the removal.
-- public schema, Auth, Storage, extensions, and rls_auto_enable are preserved.
-- No CASCADE is used. Unknown dependencies cause refusal/transaction rollback.
DO $reset_known_legacy$
DECLARE
  expected_tables constant text[] := ARRAY[
    'assessment_criteria','assessments','attendances','employees','leave_balances',
    'leave_types','leaves','outlets','positions','profiles','schedules','shift_swaps','shifts'
  ];
  actual_tables text[];
  table_name text;
  table_list text;
  unexpected text;
  infrastructure_function oid := pg_catalog.to_regprocedure('public.rls_auto_enable()')::oid;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  IF pg_catalog.to_regnamespace('legacy_hr_20261012') IS NOT NULL THEN
    RAISE EXCEPTION 'Reset dihentikan: schema archive legacy sudah ada dan perlu ditinjau';
  END IF;
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO actual_tables
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','f')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');
  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'Reset dihentikan: inventaris tabel public tidak sesuai dengan 13 tabel legacy';
  END IF;

  FOREACH table_name IN ARRAY expected_tables LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE NOWAIT', table_name);
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid IN (i.inhrelid, i.inhparent)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(expected_tables)
  ) THEN
    RAISE EXCEPTION 'Reset dihentikan: partition atau inheritance tidak dikenali';
  END IF;

  -- Related indexes and column-owned sequences belong to these known tables.
  SELECT c.relname INTO unexpected FROM pg_catalog.pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    AND NOT (c.relkind = 'r' AND c.relname = ANY(expected_tables))
    AND NOT (c.relkind = 'i' AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
      WHERE i.indexrelid = c.oid AND t.relnamespace = 'public'::regnamespace AND t.relname = ANY(expected_tables)))
    AND NOT (c.relkind = 'S' AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class t ON t.oid = d.refobjid
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a','i')
        AND d.refobjsubid > 0 AND t.relnamespace = 'public'::regnamespace AND t.relname = ANY(expected_tables)))
  LIMIT 1;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'Reset dihentikan: relation public.% tidak dikenali', unexpected;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t WHERE t.typnamespace = 'public'::regnamespace
      AND ((t.typrelid = 0 AND t.typelem = 0) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  ) THEN
    RAISE EXCEPTION 'Reset dihentikan: tipe public tambahan tidak dikenali';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('init_leave_balance','update_leave_balance') AND p.pronargs = 0
      AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype) <> 2
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
        AND NOT (p.proname IN ('init_leave_balance','update_leave_balance') AND p.pronargs = 0
          AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype)
        AND NOT (p.proname = 'rls_auto_enable' AND p.pronargs = 0
          AND p.prokind = 'f' AND p.prorettype = 'event_trigger'::regtype)
    ) THEN
    RAISE EXCEPTION 'Reset dihentikan: inventaris fungsi public tidak sesuai';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) <> 2
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND (c.relnamespace = 'public'::regnamespace
        OR t.tgfoid IN ('public.init_leave_balance()'::regprocedure, 'public.update_leave_balance()'::regprocedure))
        AND NOT (c.relnamespace = 'public'::regnamespace AND (
          (c.relname = 'employees' AND t.tgname = 'trigger_init_leave_balance' AND t.tgfoid = 'public.init_leave_balance()'::regprocedure)
          OR (c.relname = 'leaves' AND t.tgname = 'trigger_update_leave_balance' AND t.tgfoid = 'public.update_leave_balance()'::regprocedure)))
    ) THEN
    RAISE EXCEPTION 'Reset dihentikan: inventaris trigger legacy tidak sesuai';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class target ON target.oid = fk.confrelid
    JOIN pg_catalog.pg_class source ON source.oid = fk.conrelid
    WHERE fk.contype = 'f' AND target.relnamespace = 'public'::regnamespace AND target.relname = ANY(expected_tables)
      AND NOT (source.relnamespace = 'public'::regnamespace AND source.relname = ANY(expected_tables))
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class target ON target.oid = d.refobjid
    WHERE d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.refclassid = 'pg_catalog.pg_class'::regclass
      AND target.relnamespace = 'public'::regnamespace AND target.relname = ANY(expected_tables)
  ) THEN
    RAISE EXCEPTION 'Reset dihentikan: dependensi eksternal pada tabel legacy tidak dikenali';
  END IF;

  SELECT string_agg(format('public.%I', name), ', ' ORDER BY name) INTO table_list
  FROM unnest(expected_tables) AS known(name);
  -- A single list permits mutual legacy foreign keys without reaching other objects.
  EXECUTE 'DROP TABLE ' || table_list || ' RESTRICT';
  DROP FUNCTION public.init_leave_balance(), public.update_leave_balance() RESTRICT;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(expected_tables))
    OR pg_catalog.to_regprocedure('public.init_leave_balance()') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.update_leave_balance()') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.rls_auto_enable()')::oid IS DISTINCT FROM infrastructure_function THEN
    RAISE EXCEPTION 'Reset dihentikan: postcondition penggantian legacy tidak sesuai';
  END IF;
  RAISE NOTICE '13 tabel legacy beserta datanya dan 2 fungsi lama dihapus; Auth, Storage, schema public, dan fungsi Supabase dipertahankan';
END;
$reset_known_legacy$;
