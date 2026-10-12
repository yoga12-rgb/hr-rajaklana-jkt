# Reviewed removal of the known legacy HR application

Operator script: [reset-known-legacy.sql](reset-known-legacy.sql). Verification: [reset-known-legacy.test.mjs](reset-known-legacy.test.mjs). These operator files are deliberately outside `migrations/`; they are not part of ordinary setup or a fresh Preview project.

The user explicitly authorized twice: “Hapus saja tabel dan data lama, lalu gunakan proyek ini untuk HR baru.” This replaces the earlier empty-only archive plan. The approved scope is removing the 13 inspected legacy HR tables and their data, plus two associated trigger functions, from Production project `iywvnopsooroediwawnd` in the Rajaklana organization. It does not authorize removing Auth accounts, Storage, the `public` schema, extensions, or Supabase's platform objects.

## Corrected existing-data findings

Compact table-list estimates initially reported zero rows; actual `count(*)` queries disproved those estimates. The parent confirmed: outlets 1, positions 3, profiles 1, employees 4, shifts 1, schedules 0, shift_swaps 0, attendances 1, leave_types 6, leave_balances 4, leaves 1, assessment_criteria 10, assessments 0. The empty-only guard correctly refused at `assessment_criteria`, and no archive/schema move or foundation migration completed in that failed attempt.

Two existing Auth users are preserved. The read-only inspection found zero Storage buckets and objects, no custom public types or public sequences, and no legacy publication membership. The existing trigger functions are `public.init_leave_balance()` and `public.update_leave_balance()`; their table triggers are `trigger_init_leave_balance` on `employees` and `trigger_update_leave_balance` on `leaves`. Internal legacy foreign keys and the outward `profiles` reference to `auth.users` were inspected. `public.rls_auto_enable()` remains in place.

## Removal boundaries

The script validates the exact known table and function inventory, takes exclusive `NOWAIT` locks on all 13 tables, and refuses partition/inheritance, unfamiliar relations or custom types, unowned sequences, unexpected triggers, inbound foreign keys, and dependent views. All 13 tables are named together in a single `DROP TABLE ... RESTRICT` statement, permitting their mutual internal foreign keys without extending the deletion to external objects. The two known trigger functions are then named explicitly in `DROP FUNCTION ... RESTRICT`. There is no `CASCADE` and no schema deletion.

Related indexes, constraints, table triggers, row types, and column-owned sequences are removed with their known tables. Unrelated objects are not selected for removal. Unexpected routine dependencies also cause PostgreSQL's `RESTRICT` backstop to reject the operation. The whole `DO` statement is atomic; a refusal rolls back earlier statements in it.

The operator must verify the hosted project identity before running the script as database administrator. **Combine the reset and the first new application migration in one transaction**, so failure while installing the replacement schema restores the old tables and rows. Apply subsequent migrations only after the atomic replacement succeeds. A failed attempt must not be reported as a successful reset or deployment. This script intentionally refuses repeated execution after the old schema is gone.

## Verification and execution status

Run after `npm ci`:

```text
node supabase/deployment/reset-known-legacy.test.mjs
```

The standalone PGlite test passed across 13 independent populated fixtures. It populates every known legacy table, includes interconnected foreign keys and serial/identity sequences, and executes both old triggers before the reset. It verifies removal of only the known application objects; preservation of Auth users, Storage rows, an unrelated extension-schema table, the `public` schema OID, and a functioning platform event trigger; safe reuse of table names; refusal with legacy data unchanged for unknown objects/dependencies; and rollback when a replacement statement fails in the same transaction.

Preparing and running this harness performs no hosted write and creates no hosted migration history. At the time this operator review was prepared, the new reset had not been applied by this agent; the parent separately owns any authorized hosted execution and its final verification. The fixture event trigger is a harmless stand-in, not Supabase's implementation. Avoid simultaneous operator DDL during the transition; table locks are not a general lock on all future schema creation.

PostgreSQL documents the `RESTRICT` behavior and related-object deletion for [`DROP TABLE`](https://www.postgresql.org/docs/current/sql-droptable.html) and [`DROP FUNCTION`](https://www.postgresql.org/docs/current/sql-dropfunction.html).
