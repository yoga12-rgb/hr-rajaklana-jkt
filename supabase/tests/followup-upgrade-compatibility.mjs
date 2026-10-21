// Run from the maintained database suite. Exercises the exact Preview and
// pre-20261020060745 upgrade paths without touching a hosted database.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
const preflight = await readFile(new URL('../deployment/preflight-followup-off-compatibility.sql', import.meta.url), 'utf8');
const migrationVersion = name => name.slice(0, name.indexOf('_'));
const idx = version => migrationNames.findIndex(name => name.startsWith(version));

const createDb = async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key, email text unique, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true); $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    alter default privileges in schema public revoke all on tables from service_role;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/'); $$;
    create publication supabase_realtime;
  `);
  return db;
};
const apply = async (db, from, to) => {
  for (const name of migrationNames.slice(from, to + 1)) {
    let sql = await readFile(new URL(name, migrationDir), 'utf8');
    sql = sql.replace('create extension if not exists pgcrypto with schema extensions;', '');
    await db.exec(sql);
    if (await scalar(db, "select to_regclass('supabase_migrations.schema_migrations') is not null as present").then(row => row.present)) {
      await db.query('insert into supabase_migrations.schema_migrations(version) values($1) on conflict do nothing', [migrationVersion(name)]);
    }
  }
};
const scalar = async (db, sql, params=[]) => (await db.query(sql, params)).rows[0];
const setupHistory = async (db, sourceShift='off') => {
  const department = await scalar(db, "insert into public.departments(name) values('Upgrade Fixture') returning id");
  const position = await scalar(db, "insert into public.positions(department_id,name,is_cashier) values($1,'Kasir Upgrade Fixture',true) returning id", [department.id]);
  const outlets = await db.query("insert into public.outlets(name) values('Outlet Upgrade A'),('Outlet Upgrade B') returning id");
  const employee = await scalar(db, `insert into public.employees(full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,can_clock)
    values('Kasir Upgrade Fixture','081200009999',$1,$2,$3,'2020-01-01','active',true) returning id`, [department.id,position.id,outlets.rows[0].id]);
  const authUser='10000000-0000-4000-8000-000000000099';
  await db.query("insert into auth.users(id,email) values($1,'hr-upgrade-fixture@login.rajaklana.internal')",[authUser]);
  const admin=await scalar(db, `insert into public.employees(auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,can_clock)
    values($1,'Admin Upgrade Fixture','081200009998',$2,$3,$4,'2020-01-01','active',false) returning id`,
    [authUser,department.id,position.id,outlets.rows[0].id]);
  await db.query("insert into public.employee_roles(employee_id,role) values($1,'employee'),($1,'admin_hr'),($2,'employee')",[admin.id,employee.id]);
  const assignment = await scalar(db, `insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by)
    values($1,'2026-10-15',$2,$3,'Fixture aktif untuk migrasi Libur',$4) returning id`, [employee.id,outlets.rows[1].id,sourceShift,admin.id]);
  const rosterAssignment=await scalar(db, `insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by)
    values($1,'2026-10-16',$2,'morning','Fixture assignment untuk konteks roster',$3) returning id`,[employee.id,outlets.rows[1].id,admin.id]);
  const activeCase = await scalar(db, `insert into public.spv_followups(case_key,issue_type,source_type,source_id,work_date,outlet_id,employee_id,shift,status,owner_id,note,created_by,updated_by)
    values('missing_clockin:upgrade-fixture','missing_clockin','assignment',$1,'2026-10-15',$2,$3,$4,'in_progress',$3,'Catatan yang harus dipertahankan',$5,$5) returning id`,
    [assignment.id,outlets.rows[0].id,employee.id,sourceShift==='off'?'morning':sourceShift,admin.id]);
  const completedCase = await scalar(db, `insert into public.spv_followups(case_key,issue_type,source_type,source_id,work_date,outlet_id,employee_id,shift,status,owner_id,note,resolution_note,created_by,updated_by)
    values('completed:upgrade-fixture','missing_clockin','assignment',$1,'2026-10-15',$2,$3,'afternoon','completed',$3,'Riwayat selesai','Terselesaikan sebelumnya',$4,$4) returning id`,
    [assignment.id,outlets.rows[0].id,employee.id,admin.id]);
  const rosterCase = await scalar(db, `insert into public.spv_followups(case_key,issue_type,source_type,work_date,outlet_id,employee_id,shift,status,note,created_by,updated_by)
    values('unassigned:upgrade-fixture','unassigned','roster','2026-10-16',$1,$2,null,'new','Periksa penempatan outlet',$2,$2) returning id`,
    [outlets.rows[0].id,employee.id]);
  const completedRoster = await scalar(db, `insert into public.spv_followups(case_key,issue_type,source_type,work_date,outlet_id,employee_id,shift,status,resolution_note,created_by,updated_by)
    values('completed-roster:upgrade-fixture','unassigned','roster','2026-10-17',$1,$2,null,'completed','Snapshot lama selesai',$2,$2) returning id`,
    [outlets.rows[0].id,employee.id]);
  return {employee:employee.id,admin:admin.id,authUser,assignment:assignment.id,rosterAssignment:rosterAssignment.id,outletA:outlets.rows[0].id,outletB:outlets.rows[1].id,
    activeCase:activeCase.id,completedCase:completedCase.id,rosterCase:rosterCase.id,completedRoster:completedRoster.id};
};

// Preview-style upgrade: the known 15-migration baseline is upgraded through
// both forward corrections. Existing open and completed cases are present.
{
  const db = await createDb();
  try {
    assert.equal(idx('20261020060913'),14,'Preview baseline must contain exactly 15 migrations');
    await apply(db,0,14);
    const ids=await setupHistory(db,'morning');
    let open = await scalar(db,'select id,status,shift,outlet_id,owner_id,note,resolution_note from public.spv_followups where id=$1',[ids.activeCase]);
    assert.equal(open.shift,'morning');
    let done = await scalar(db,'select status,shift,outlet_id,resolution_note from public.spv_followups where id=$1',[ids.completedCase]);
    assert.equal(done.status,'completed');
    let staleRoster = await scalar(db,'select outlet_id from public.spv_followups where id=$1',[ids.rosterCase]);
    assert.equal(staleRoster.outlet_id,ids.outletA);
    let sql=await readFile(new URL(migrationNames[15],migrationDir),'utf8');
    sql=sql.replace('create extension if not exists pgcrypto with schema extensions;','');
    await db.exec(sql);
    sql=await readFile(new URL(migrationNames[16],migrationDir),'utf8');
    await db.exec(sql);
    const rosterSync=await scalar(db,"select prosrc from pg_proc where oid='private.sync_roster_followup_context(uuid,date,uuid,text)'::regprocedure");
    assert.match(rosterSync.prosrc,/for update of f/i,'context refresh locks target cases before capturing audit snapshots');
    assert.match(rosterSync.prosrc,/f\.status\s*<>\s*'completed'/i,'context refresh rechecks completed status under the row lock');
    const sourceSync=await scalar(db,"select prosrc from pg_proc where oid='private.sync_spv_followup_source_context()'::regprocedure");
    assert.match(sourceSync.prosrc,/for update of f/i,'source trigger locks target cases before capturing audit snapshots');
    open = await scalar(db,'select id,status,shift,outlet_id,owner_id,note,resolution_note from public.spv_followups where id=$1',[ids.activeCase]);
    assert.equal(open.shift,'morning');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)`,[ids.authUser]);
    await db.exec('set role authenticated');
    await db.query("select public.cashier_assignment_save($1,'2026-10-15',$2,'off','Uji Libur setelah upgrade',$3,false)",
      [ids.employee,ids.outletB,ids.assignment]);
    await db.exec('reset role');
    assert.equal((await scalar(db,'select shift from public.spv_followups where id=$1',[ids.activeCase])).shift,'off',
      'Preview upgraded trigger records Libur without losing its active case');
    open = await scalar(db,'select id,status,shift,outlet_id,owner_id,note,resolution_note from public.spv_followups where id=$1',[ids.activeCase]);
    assert.deepEqual(open,{id:ids.activeCase,status:'in_progress',shift:'off',outlet_id:ids.outletB,owner_id:ids.employee,
      note:'Catatan yang harus dipertahankan',resolution_note:''},'Preview upgrade carries Libur into the existing actionable case');
    done = await scalar(db,'select status,shift,outlet_id,resolution_note from public.spv_followups where id=$1',[ids.completedCase]);
    assert.deepEqual(done,{status:'completed',shift:'afternoon',outlet_id:ids.outletA,resolution_note:'Terselesaikan sebelumnya'},
      'Preview upgrade preserves the completed historical snapshot');
    staleRoster = await scalar(db,'select id,outlet_id,status,note from public.spv_followups where id=$1',[ids.rosterCase]);
    assert.deepEqual(staleRoster,{id:ids.rosterCase,outlet_id:ids.outletB,status:'new',note:'Periksa penempatan outlet'},
      'Preview upgrade repairs the same open roster case to the active assignment outlet');
    assert.equal((await scalar(db,'select outlet_id from public.spv_followups where id=$1',[ids.completedRoster])).outlet_id,ids.outletA,
      'Preview upgrade does not rewrite a completed roster snapshot');
    assert.equal((await scalar(db,"select count(*)::int as count from private.spv_followup_context_repair_log where migration_key='20261020081916_cashier_followup_context_consistency'")).count,1,
      'Preview upgrade records one private before/after repair');
    console.log('Preview 15→17 upgrade OK: open/off case, completed snapshot, roster outlet repair and locked audit snapshots');
  } finally { await db.close(); }
}

// Historical upgrade: prove migration 14 fails before a later correction could
// run, then apply the bounded preflight and complete the upgrade without resets.
{
  const db = await createDb();
  try {
    const m14=idx('20261020060745');
    assert.equal(m14,13,'Historical fixture must stop after 13 migrations');
    await apply(db,0,m14-1);
    const ids=await setupHistory(db,'off');
    await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');
    for (const name of migrationNames.slice(0,m14)) {
      await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[migrationVersion(name)]);
    }
    let sql=await readFile(new URL(migrationNames[m14],migrationDir),'utf8');
    sql=sql.replace('create extension if not exists pgcrypto with schema extensions;','');
    await db.exec('begin');
    await assert.rejects(db.exec(sql),error=>error.message.includes('spv_followups_shift_check'),
      'historical migration must reproduce the CHECK failure before a new migration can execute');
    await db.exec('rollback');
    assert.equal((await scalar(db,'select shift from public.spv_followups where id=$1',[ids.activeCase])).shift,'morning',
      'failed historical migration leaves its fixture and case untouched');
    await db.exec(preflight);
    await db.exec(preflight);
    assert.match((await scalar(db,"select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.spv_followups'::regclass and conname='spv_followups_shift_check'")).definition,/'off'/,
      'bounded preflight adds off and is idempotent');
    await db.exec(sql);
    await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[migrationVersion(migrationNames[m14])]);
    for (const name of migrationNames.slice(m14+1)) {
      let next=await readFile(new URL(name,migrationDir),'utf8');
      next=next.replace('create extension if not exists pgcrypto with schema extensions;','');
      await db.exec(next);
      await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[migrationVersion(name)]);
    }
    assert.equal((await scalar(db,'select id from public.spv_followups where id=$1 and shift=\'off\'',[ids.activeCase])).id,ids.activeCase,
      'preflight allows the historical backfill to complete and retain the case ID');
    assert.equal((await scalar(db,"select count(*)::int as count from private.spv_followup_context_repair_log where migration_key='20261020052932_cashier_spv_audit_repairs' and followup_id=$1",[ids.activeCase])).count,1,
      'historical backfill records the original before/after context');
    await assert.rejects(db.exec(preflight),error=>error.message.includes('before later migrations'),
      'preflight refuses a database after migration 13');
    await db.exec('rollback');
    assert.equal((await scalar(db,'select shift from public.spv_followups where id=$1',[ids.activeCase])).shift,'off',
      'refusing an out-of-scope preflight does not change the migrated case');
    console.log('Historical 13→17 upgrade OK: preflight absence reproduced; bounded preflight applied twice; migrations 14–17 completed');
  } finally { await db.close(); }
}
