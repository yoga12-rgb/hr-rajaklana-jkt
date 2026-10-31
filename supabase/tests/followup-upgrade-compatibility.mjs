// Run from the maintained database suite. Exercises the exact Preview and
// pre-20261020060745 upgrade paths without touching a hosted database.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { installAuthSessionFixture, fixtureSession } from './auth-session-fixture.mjs';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
const preflight = await readFile(new URL('../deployment/preflight-followup-off-compatibility.sql', import.meta.url), 'utf8');
const hardeningPreflight = await readFile(new URL('../deployment/preflight-supervisor-operational-hardening.sql', import.meta.url), 'utf8');
const migrationVersion = name => name.slice(0, name.indexOf('_'));
const migrationName = name => name.slice(name.indexOf('_') + 1, -4);
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
  await installAuthSessionFixture(db);
  await db.exec('grant select on auth.sessions to authenticated');
  return db;
};
const apply = async (db, from, to) => {
  for (const name of migrationNames.slice(from, to + 1)) {
    let sql = await readFile(new URL(name, migrationDir), 'utf8');
    sql = sql.replace('create extension if not exists pgcrypto with schema extensions;', '');
    await db.exec(sql);
    if (await scalar(db, "select to_regclass('supabase_migrations.schema_migrations') is not null as present").then(row => row.present)) {
      await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2) on conflict (version) do nothing', [migrationVersion(name),migrationName(name)]);
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

// Preview-style upgrade: the known deployed 18-migration baseline receives
// only forward migrations 19–25. This is intentionally separate
// from the historical 13-migration path below: a current Preview must never
// run the legacy preflight intended for the migration-14 CHECK failure.
{
  const db = await createDb();
  try {
    const previewBaseline=idx('20261022170000');
    const hardening=idx('20261024110000');
    const target=idx('20261027090100');
    const final26=idx('20261030031318');
    assert.equal(previewBaseline,17,'Preview baseline must contain exactly 18 migrations');
    assert.notEqual(hardening,-1,'m22 operational hardening must remain present before m23');
    assert.equal(target,24,'the bounded Preview-style fixture starts with exactly 18 migrations and reaches baseline25');
    assert.equal(final26,target+1,'password-only retirement is the single forward step after baseline25');
    await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text)');
    await apply(db,0,previewBaseline);
    const ids=await setupHistory(db,'morning');
    let open = await scalar(db,'select id,status,shift,outlet_id,owner_id,note,resolution_note from public.spv_followups where id=$1',[ids.activeCase]);
    assert.equal(open.shift,'morning');
    let done = await scalar(db,'select status,shift,outlet_id,resolution_note from public.spv_followups where id=$1',[ids.completedCase]);
    assert.equal(done.status,'completed');
    let staleRoster = await scalar(db,'select outlet_id from public.spv_followups where id=$1',[ids.rosterCase]);
    assert.equal(staleRoster.outlet_id,ids.outletA);
    // Preview gets the additive module migrations first. Before m22 introduces
    // partial uniqueness, prove the separate preflight refuses bad legacy
    // operational rows without rewriting them, then allow the clean upgrade.
    await apply(db,previewBaseline+1,hardening-1);
    const requesterAssignment=await scalar(db,'select id,updated_at from public.cashier_assignments where id=$1',[ids.assignment]);
    const peer=await scalar(db,`insert into public.employees(full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,can_clock)
      select 'Rekan preflight hardening','081200009997',department_id,position_id,outlet_id,'2020-01-01','active',true from public.employees where id=$1 returning id`,[ids.employee]);
    await db.query("insert into public.employee_roles(employee_id,role) values($1,'employee')",[peer.id]);
    const peerAssignment=await scalar(db,`insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by)
      values($1,'2026-10-15',$2,'afternoon','Fixture duplicate preflight',$3) returning id,updated_at`,[peer.id,ids.outletB,ids.admin]);
    await db.query(`insert into public.shift_exchange_requests(request_type,work_date,requester_employee_id,peer_employee_id,requester_assignment_id,peer_assignment_id,requester_assignment_updated_at,peer_assignment_updated_at,reason)
      values('swap','2026-10-15',$1,$2,$3,$4,$5,$6,'Fixture duplicate active request')`,[ids.employee,peer.id,requesterAssignment.id,peerAssignment.id,requesterAssignment.updated_at,peerAssignment.updated_at]);
    await db.query(`insert into public.shift_exchange_requests(request_type,work_date,requester_employee_id,peer_employee_id,requester_assignment_id,peer_assignment_id,requester_assignment_updated_at,peer_assignment_updated_at,reason)
      values('swap','2026-10-15',$1,$2,$3,$4,$5,$6,'Fixture duplicate active request kedua')`,[ids.employee,peer.id,requesterAssignment.id,peerAssignment.id,requesterAssignment.updated_at,peerAssignment.updated_at]);
    await assert.rejects(db.exec(hardeningPreflight),/Duplicate active exchange requests share a requester assignment/,
      'the external hardening preflight must fail before changing duplicate operational rows');
    await db.exec('rollback');
    assert.equal((await scalar(db,"select count(*)::int as count from public.shift_exchange_requests where reason like 'Fixture duplicate active request%'" )).count,2,
      'the failed preflight never deletes or rewrites operational history');
    await db.exec('begin');
    await assert.rejects(apply(db,hardening,hardening),/Preflight supervisor hardening menemukan pengajuan pertukaran aktif ganda/,
      'm22 has the same fail-closed guard when a one-step push reaches its unique indexes');
    await db.exec('rollback');
    await db.query("delete from public.shift_exchange_requests where reason='Fixture duplicate active request kedua'");
    await db.exec(hardeningPreflight);
    await db.exec(hardeningPreflight);
    await apply(db,hardening,target);
    assert.equal((await scalar(db,"select count(*)::int as count from pg_attribute where attrelid='public.spv_followups'::regclass and attname='revision' and not attisdropped")).count,1,
      'Preview upgrade adds the explicit follow-up revision without replacing case history');
    assert.ok(await scalar(db,"select to_regclass('public.outlet_issues') is not null as present").then(row=>row.present),
      'Preview upgrade adds the scoped outlet issue model');
    assert.ok(await scalar(db,"select to_regclass('public.staffing_interval_requirements') is not null as present").then(row=>row.present),
      'Preview upgrade adds interval planning without rewriting legacy staffing rows');
    const rosterSync=await scalar(db,"select prosrc from pg_proc where oid='private.sync_roster_followup_context(uuid,date,uuid,text)'::regprocedure");
    assert.match(rosterSync.prosrc,/for update of f/i,'context refresh locks target cases before capturing audit snapshots');
    assert.match(rosterSync.prosrc,/f\.status\s*<>\s*'completed'/i,'context refresh rechecks completed status under the row lock');
    const sourceSync=await scalar(db,"select prosrc from pg_proc where oid='private.sync_spv_followup_source_context()'::regprocedure");
    assert.match(sourceSync.prosrc,/for update of f/i,'source trigger locks target cases before capturing audit snapshots');
    open = await scalar(db,'select id,status,shift,outlet_id,owner_id,note,resolution_note,revision from public.spv_followups where id=$1',[ids.activeCase]);
    assert.equal(open.shift,'morning');
    assert.equal(open.revision,1,'new revision begins at one for an existing Preview case');
    await fixtureSession(db,ids.authUser,'authenticated','aal2');
    await db.exec('set role authenticated');
    await db.query("select public.cashier_assignment_save($1,'2026-10-15',$2,'off','Uji Libur setelah upgrade',$3,false)",
      [ids.employee,ids.outletB,ids.assignment]);
    await db.exec('reset role');
    assert.equal((await scalar(db,'select shift from public.spv_followups where id=$1',[ids.activeCase])).shift,'off',
      'Preview upgraded trigger records Libur without losing its active case');
    open = await scalar(db,'select id,status,shift,outlet_id,owner_id,note,resolution_note,revision from public.spv_followups where id=$1',[ids.activeCase]);
    assert.deepEqual(open,{id:ids.activeCase,status:'in_progress',shift:'off',outlet_id:ids.outletB,owner_id:ids.employee,
      note:'Catatan yang harus dipertahankan',resolution_note:'',revision:2},'Preview upgrade carries Libur into the existing actionable case and advances its revision');
    done = await scalar(db,'select status,shift,outlet_id,resolution_note from public.spv_followups where id=$1',[ids.completedCase]);
    assert.deepEqual(done,{status:'completed',shift:'afternoon',outlet_id:ids.outletA,resolution_note:'Terselesaikan sebelumnya'},
      'Preview upgrade preserves the completed historical snapshot');
    staleRoster = await scalar(db,'select id,outlet_id,status,note from public.spv_followups where id=$1',[ids.rosterCase]);
    assert.deepEqual(staleRoster,{id:ids.rosterCase,outlet_id:ids.outletA,status:'new',note:'Periksa penempatan outlet'},
      'forward supervisor migration does not rewrite pre-existing case history without a source mutation');
    assert.equal((await scalar(db,'select outlet_id from public.spv_followups where id=$1',[ids.completedRoster])).outlet_id,ids.outletA,
      'Preview upgrade does not rewrite a completed roster snapshot');
    assert.equal((await scalar(db,"select count(*)::int as count from private.spv_followup_context_repair_log where migration_key='20261020081916_cashier_followup_context_consistency'")).count,0,
      '18→25 does not invoke the historical repair intended for the earlier 15→16 upgrade');

    // m23 is strictly forward-only on the Preview baseline: legacy
    // configuration rows acquire a version, a v2 receipt replays its original
    // response after a later v1 write, and the configuration snapshot exposes
    // the server revision needed for an optimistic client baseline.
    await fixtureSession(db,ids.authUser,'authenticated','aal2');
    await db.exec('set role authenticated');
    const configKey='30000000-0000-4000-8000-000000000093';
    const firstCategory=(await scalar(db,`select public.supervisor_issue_category_save_v2(
      null,null,$1,'preview_config_replay','Preview config replay',true) as result`,[configKey])).result;
    assert.equal(firstCategory.revision,1,'m23 starts a new category at revision one');
    const replayCategory=(await scalar(db,`select public.supervisor_issue_category_save_v2(
      null,null,$1,'preview_config_replay','Preview config replay',true) as result`,[configKey])).result;
    assert.deepEqual(replayCategory,firstCategory,'m23 replays the original category response for the same actor/key/payload');
    await db.query(`select public.supervisor_issue_category_save($1,'preview_config_replay','Preview config changed later',true)`,[firstCategory.id]);
    const replayAfterRevision=(await scalar(db,`select public.supervisor_issue_category_save_v2(
      null,null,$1,'preview_config_replay','Preview config replay',true) as result`,[configKey])).result;
    assert.deepEqual(replayAfterRevision,firstCategory,'m23 receipt survives a later configuration revision without replaying a second write');
    const configuration=(await scalar(db,'select public.supervisor_operation_configuration_page() as result')).result;
    const currentCategory=configuration.categories.find(category=>category.id===firstCategory.id);
    assert.equal(currentCategory.revision,2,'configuration snapshot exposes the newer revision after the legacy write');
    await db.exec('reset role');

    const employeeAuth='10000000-0000-4000-8000-000000000098';
    await db.query('insert into auth.users(id,email) values($1,$2)',[employeeAuth,'rk-upgrade-fixture@login.rajaklana.internal']);
    await db.query('update public.employees set auth_user_id=$1,account_status=\'active\' where id=$2',[employeeAuth,ids.employee]);
    await db.query("insert into public.employee_roles(employee_id,role) values($1,'head_baker')",[ids.employee]);
    await fixtureSession(db,ids.authUser,'authenticated','aal2');
    await db.exec('set role authenticated');
    await db.query(`select public.hr_save_employee_with_roles(
      jsonb_build_object('status','inactive','ends_on','2026-10-15'::date,'exit_reason','Uji upgrade lifecycle'),
      $1,array['employee']::text[],'Uji nonaktif atomik')`,[ids.employee]);
    await db.query(`select public.hr_save_employee_with_roles(
      jsonb_build_object('status','active','ends_on',null,'exit_reason',null),
      $1,array['employee']::text[],'Uji reaktivasi atomik')`,[ids.employee]);
    await db.exec('reset role');
    const reactivated=await scalar(db,'select status,account_status,auth_user_id from public.employees where id=$1',[ids.employee]);
    assert.deepEqual(reactivated,{status:'active',account_status:'active',auth_user_id:employeeAuth},
      'the new Preview migration reactivates an existing linked account');
    await fixtureSession(db,ids.authUser,'authenticated','aal2');
    await db.exec('set role authenticated');
    const issued=(await scalar(db,`select public.issue_account_token($1,'reset',$2) as token`,[ids.employee,'a'.repeat(64)])).token;
    await db.exec('reset role');
    await fixtureSession(db,'','service_role');
    await db.exec('set role service_role');
    const firstClaim=(await scalar(db,'select public.claim_account_token($1,$2) as token',['a'.repeat(64),'30000000-0000-4000-8000-000000000091'])).token;
    await db.exec('reset role');
    await db.query("update public.account_tokens set claimed_at=now()-interval '6 minutes' where id=$1",[issued.id]);
    await fixtureSession(db,'','service_role');
    await db.exec('set role service_role');
    assert.equal((await scalar(db,'select public.inspect_account_token($1) as token',['a'.repeat(64)])).token.purpose,'reset',
      'the activation page preflight accepts a safely abandoned claim');
    const retry=(await scalar(db,'select public.claim_account_token($1,$2) as token',['a'.repeat(64),'30000000-0000-4000-8000-000000000092'])).token;
    assert.equal(retry.token_id,firstClaim.token_id,'retry reclaims the original Preview token');
    await db.exec('reset role');
    const beforeRetirement=await scalar(db,`select jsonb_build_object(
      'cases',(select jsonb_agg(to_jsonb(f) order by id) from public.spv_followups f),
      'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.cashier_assignments a),
      'employees',(select jsonb_agg(to_jsonb(e) order by id) from public.employees e),
      'roles',(select jsonb_agg(to_jsonb(r) order by employee_id,role) from public.employee_roles r),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a),
      'configuration_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.supervisor_configuration_receipts r),
      'tokens',(select jsonb_agg(to_jsonb(t) order by id) from public.account_tokens t)
    ) as value`);
    await apply(db,final26,final26);
    assert.deepEqual(await scalar(db,`select jsonb_build_object(
      'cases',(select jsonb_agg(to_jsonb(f) order by id) from public.spv_followups f),
      'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.cashier_assignments a),
      'employees',(select jsonb_agg(to_jsonb(e) order by id) from public.employees e),
      'roles',(select jsonb_agg(to_jsonb(r) order by employee_id,role) from public.employee_roles r),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a),
      'configuration_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.supervisor_configuration_receipts r),
      'tokens',(select jsonb_agg(to_jsonb(t) order by id) from public.account_tokens t)
    ) as value`),beforeRetirement,'18→26 preserves every business, audit, configuration receipt and invitation token snapshot');
    assert.equal((await scalar(db,'select count(*)::int as count from supabase_migrations.schema_migrations')).count,26,'bounded 18→26 fixture reaches final migration26');
    await fixtureSession(db,ids.authUser,'authenticated','aal1');
    await db.exec('set role authenticated');
    assert.deepEqual((await scalar(db,'select public.auth_access_context() as value')).value,
      {employee_id:ids.admin,requires_mfa:false,current_level:'aal1',allowed:true,reason:null},'18→26 ends in password-only, no-factor access');
    await db.exec('reset role');
    console.log('Preview-style 18→26 upgrade OK: bounded18 baseline, m22 preflight, case/receipt/account snapshots, migration26 and final password-only aal1');
  } finally { await db.close(); }
}

// A separately simulated pre-retirement 24-migration baseline receives only
// forward migrations25 and26. The actual hosted Preview is already at26 and is
// verified read-only; this fixture does not claim to reproduce its live history.
{
  const db=await createDb();
  try {
    const baseline=idx('20261027090000');
    assert.equal(baseline,23,'actual Preview baseline must contain 24 migrations');
    await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text)');
    await apply(db,0,baseline);
    const ids=await setupHistory(db,'morning');
    const snapshot=async()=>(await scalar(db,`select jsonb_build_object(
      'cases',(select jsonb_agg(to_jsonb(f) order by id) from public.spv_followups f),
      'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.cashier_assignments a),
      'employees',(select jsonb_agg(to_jsonb(e) order by id) from public.employees e),
      'roles',(select jsonb_agg(to_jsonb(r) order by employee_id,role) from public.employee_roles r),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a)
    ) as value`)).value;
    const before=await snapshot();
    const finalTarget=idx('20261030031318');
    await apply(db,baseline+1,finalTarget);
    assert.deepEqual(await snapshot(),before,'actual Preview upgrade preserves all existing business snapshots/audit');
    assert.equal((await scalar(db,'select count(*)::integer as count from supabase_migrations.schema_migrations')).count,26);
    await fixtureSession(db,ids.authUser,'authenticated','aal1');
    await db.exec('set role authenticated');
    assert.deepEqual((await scalar(db,'select public.auth_access_context() as value')).value,
      {employee_id:ids.admin,requires_mfa:false,current_level:'aal1',allowed:true,reason:null});
    assert.ok((await db.query('select * from public.employee_directory()')).rows.length>0);
    await db.exec('reset role');
    await fixtureSession(db,ids.authUser,'authenticated','aal2');
    await db.exec('set role authenticated');
    assert.equal((await scalar(db,'select public.auth_access_context() as value')).value.allowed,true);
    assert.ok((await db.query('select * from public.employee_directory()')).rows.length>0);
    console.log('Actual Preview 24→26 upgrade OK: forward migrations only, no historical preflight, business/audit snapshot equality, password-only aal1 and legacy aal2 accepted');
  } finally {await db.close();}
}

// Populated migration25 → final26: recovery/audit/case/roster snapshots are
// captured before the authenticator retirement and must be byte-equivalent
// after the forward migration. This is separate from the hosted 24→26 path.
{
  const db = await createDb();
  try {
    const baseline25 = idx('20261027090100');
    const final26 = idx('20261030031318');
    assert.equal(final26, baseline25 + 1, 'final retirement must be the single forward migration after baseline25');
    await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text)');
    await apply(db, 0, baseline25);
    const ids = await setupHistory(db, 'morning');
    const cashierAuth='10000000-0000-4000-8000-000000000098';
    const peerAuth='10000000-0000-4000-8000-000000000097';
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',
      [cashierAuth,'cashier-replay@fixture.invalid',peerAuth,'peer-replay@fixture.invalid']);
    await db.query("update public.employees set auth_user_id=$1,account_status='active' where id=$2",[cashierAuth,ids.employee]);
    const peer=(await scalar(db,`insert into public.employees(auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,can_clock,can_middle_shift)
      select $1,'Kasir Rekan Replay','081200000097',department_id,position_id,outlet_id,'2020-01-01','active',true,true
      from public.employees where id=$2 returning id`,[peerAuth,ids.employee])).id;
    await db.query("insert into public.employee_roles(employee_id,role) values($1,'employee') on conflict do nothing",[peer]);
    const runRpc = async (authId, aal, sql, args=[]) => {
      await fixtureSession(db,authId,'authenticated',aal);
      await db.exec('set role authenticated');
      try { return await scalar(db,sql,args); }
      finally { await db.exec('reset role'); }
    };
    const recoveryRows = [
      ['60000000-0000-4000-8000-000000000001','pending',null,'pending'],
      ['60000000-0000-4000-8000-000000000002','failed',null,'failed'],
      ['60000000-0000-4000-8000-000000000003','completed',"'2026-10-20T10:00:00Z'",'completed']
    ];
    for (const [requestId,status,completedAt,label] of recoveryRows) {
      const timestamp = completedAt ? `,${completedAt}::timestamptz` : ',null';
      await db.query(`insert into private.mfa_recovery_requests(request_id,actor_employee_id,employee_id,auth_user_id,factor_ids,reason,status,completed_at)
        values($1,$2,$3,$4,array['70000000-0000-4000-8000-00000000000${label === 'pending' ? '1' : label === 'failed' ? '2' : '3'}']::uuid[],$5,$6${timestamp})`,
        [requestId, ids.admin, ids.employee, cashierAuth, `Historical cleanup ${label} fixture`, status]);
      await db.query(`insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
        values('auth_mfa',$1,$2,$3,'Historical cleanup evidence',jsonb_build_object('request_id',$4::text),jsonb_build_object('status',$5::text))`,
        [ids.employee, ids.admin, `recovery_${label}`, requestId, status]);
    }
    // Populate each immutable receipt through its real migration25 RPC. These
    // results are the original request/payload pair used for replay after26.
    const requests={};
    const adminSession=(authId,aal='aal2')=>runRpc(authId,aal,'select 1 as ready');
    await adminSession(ids.authUser);
    const followRevision=(await scalar(db,'select revision from public.spv_followups where id=$1',[ids.activeCase])).revision;
    requests.followup={id:ids.activeCase,revision:followRevision,key:'80000000-0000-4000-8000-000000000001',status:'in_progress',owner:ids.admin,
      note:'Receipt kasus tersimpan melalui RPC',resolution:'',due:'2026-10-31T23:30:00+07:00',reason:'Catat tindak lanjut receipt'};
    const followResult=(await runRpc(ids.authUser,'aal2',`select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
      [requests.followup.id,requests.followup.revision,requests.followup.key,requests.followup.status,requests.followup.owner,requests.followup.note,
        requests.followup.resolution,requests.followup.due,requests.followup.reason])).result;
    requests.configuration={key:'80000000-0000-4000-8000-000000000002',code:'receipt_upgrade25',name:'Konfigurasi receipt migrasi25'};
    const configurationResult=(await runRpc(ids.authUser,'aal2',
      "select public.supervisor_issue_category_save_v2(null,null,$1,$2,$3,true) as result",
      [requests.configuration.key,requests.configuration.code,requests.configuration.name])).result;

    await runRpc(ids.authUser,'aal2','select public.supervisor_capability_save($1,$2,$3,null,true)',
      [ids.admin,'coverage_configure',ids.outletA]);
    requests.planning={key:'80000000-0000-4000-8000-000000000003',outlet:ids.outletA,weekday:1,starts:'09:00',ends:'12:00',minimum:1,
      from:'2026-11-02',until:null,reason:'Kebutuhan interval untuk uji replay migrasi'};
    const planningResult=(await runRpc(ids.authUser,'aal2',
      'select public.staffing_interval_requirement_save_v2(null,null,$1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
      [requests.planning.key,requests.planning.outlet,requests.planning.weekday,requests.planning.starts,requests.planning.ends,
        requests.planning.minimum,requests.planning.from,requests.planning.until,requests.planning.reason])).result;

    await runRpc(ids.authUser,'aal2','select public.supervisor_capability_save($1,$2,$3,$4,true)',
      [ids.employee,'issue_report',ids.outletA,configurationResult.id]);
    requests.issue={outlet:ids.outletA,category:configurationResult.id,description:'Printer outlet perlu diperiksa setelah penutupan kas',
      urgency:'normal',key:'80000000-0000-4000-8000-000000000004'};
    const issueResult=(await runRpc(cashierAuth,'aal1',
      "select public.outlet_issue_submit($1,$2,$3,$4,null,null,$5) as result",
      [requests.issue.outlet,requests.issue.category,requests.issue.description,requests.issue.urgency,requests.issue.key])).result;

    const handoverDate=(await scalar(db,"select ((now() at time zone 'Asia/Jakarta')::date+2)::text as day")).day;
    const handoverSender=(await runRpc(ids.authUser,'aal2',
      "select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Assignment sumber receipt serah terima')) as result",
      [ids.employee,handoverDate,ids.outletA])).result;
    const handoverRecipient=(await runRpc(ids.authUser,'aal2',
      "select to_jsonb(public.cashier_assignment_save($1,$2,$3,'afternoon','Assignment penerima receipt serah terima')) as result",
      [peer,handoverDate,ids.outletA])).result;
    requests.handover={key:'80000000-0000-4000-8000-000000000005',outlet:ids.outletA,workDate:handoverDate,
      senderAssignment:handoverSender.id,recipient:peer,recipientAssignment:handoverRecipient.id,pendingWork:'Cek kas kecil',
      condition:'Mesin dan printer aman',notes:'Hitung stok setelah shift',reason:'Kirim receipt serah terima'};
    const handoverResult=(await runRpc(cashierAuth,'aal1',
      'select public.shift_handover_save_v2(null,null,$1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) as result',
      [requests.handover.key,requests.handover.outlet,requests.handover.workDate,requests.handover.senderAssignment,requests.handover.recipient,
        requests.handover.recipientAssignment,requests.handover.pendingWork,requests.handover.condition,requests.handover.notes,requests.handover.reason])).result;

    const exchangeDate=(await scalar(db,"select ((now() at time zone 'Asia/Jakarta')::date+3)::text as day")).day;
    const exchangeRequester=(await runRpc(ids.authUser,'aal2',
      "select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Assignment pemohon receipt pertukaran')) as result",
      [ids.employee,exchangeDate,ids.outletA])).result;
    await runRpc(ids.authUser,'aal2',
      "select public.cashier_assignment_save($1,$2,$3,'afternoon','Assignment rekan receipt pertukaran')",
      [peer,exchangeDate,ids.outletA]);
    requests.exchange={type:'swap',assignment:exchangeRequester.id,peer,reason:'Tukar shift untuk kebutuhan keluarga',key:'80000000-0000-4000-8000-000000000006'};
    const exchangeResult=(await runRpc(cashierAuth,'aal1',
      'select public.shift_exchange_submit($1,$2,$3,$4,$5) as result',
      [requests.exchange.type,requests.exchange.assignment,requests.exchange.peer,requests.exchange.reason,requests.exchange.key])).result;

    const rosterWeek=(await scalar(db,"select ((now() at time zone 'Asia/Jakarta')::date+(8-extract(isodow from now() at time zone 'Asia/Jakarta')::int))::text as day")).day;
    const rosterWorkDate=(await scalar(db,"select (($1::date+6)::text) as day",[rosterWeek])).day;
    requests.roster={week:rosterWeek,key:'80000000-0000-4000-8000-000000000007',changes:[{
      id:null,employee_id:ids.employee,work_date:rosterWorkDate,outlet_id:ids.outletA,shift:'morning',reason:'Roster receipt melalui RPC migration25',
      expected_updated_at:null,cancel:false
    }]};
    const rosterResult=(await runRpc(ids.authUser,'aal2',
      'select public.cashier_roster_batch_save($1,$2,$3::jsonb) as result',
      [requests.roster.week,requests.roster.key,JSON.stringify(requests.roster.changes)])).result;

    const originalResults={followup:followResult,configuration:configurationResult,planning:planningResult,issue:issueResult,
      handover:handoverResult,exchange:exchangeResult,roster:rosterResult};
    const snapshot = async () => (await scalar(db, `select jsonb_build_object(
      'cases',(select jsonb_agg(to_jsonb(f) order by id) from public.spv_followups f),
      'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.cashier_assignments a),
      'employees',(select jsonb_agg(to_jsonb(e) order by id) from public.employees e),
      'roles',(select jsonb_agg(to_jsonb(r) order by employee_id,role) from public.employee_roles r),
      'recovery',(select jsonb_agg(to_jsonb(r) order by request_id) from private.mfa_recovery_requests r),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a),
      'spv_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.spv_followup_receipts r),
      'configuration_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.supervisor_configuration_receipts r),
      'planning_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.supervisor_planning_receipts r),
      'issue_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.outlet_issue_receipts r),
      'handover_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.shift_handover_receipts r),
      'exchange_receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.shift_exchange_receipts r),
      'roster_batches',(select jsonb_agg(to_jsonb(r) order by id) from public.cashier_roster_batches r)
    ) as value`)).value;
    const before = await snapshot();
    for (const [label,query] of [
      ['recovery', 'select count(*)::int as count from private.mfa_recovery_requests'],
      ['spv receipt', 'select count(*)::int as count from private.spv_followup_receipts'],
      ['configuration receipt', 'select count(*)::int as count from private.supervisor_configuration_receipts'],
      ['planning receipt', 'select count(*)::int as count from private.supervisor_planning_receipts'],
      ['issue receipt', 'select count(*)::int as count from private.outlet_issue_receipts'],
      ['handover receipt', 'select count(*)::int as count from private.shift_handover_receipts'],
      ['exchange receipt', 'select count(*)::int as count from private.shift_exchange_receipts'],
      ['roster batch', 'select count(*)::int as count from public.cashier_roster_batches']
    ]) assert.ok((await scalar(db,query)).count > 0, `${label} fixture must be non-empty before migration26`);
    assert.deepEqual(await scalar(db,`select jsonb_build_object('employee_auth',e.auth_user_id,'auth_exists',u.id is not null,
      'session_user',s.user_id,'session_employee_auth',e.auth_user_id) as value
      from public.employees e left join auth.users u on u.id=e.auth_user_id
      left join auth.sessions s on s.user_id=e.auth_user_id where e.id=$1 limit 1`,[ids.employee]),
      {value:{employee_auth:cashierAuth,auth_exists:true,session_user:cashierAuth,session_employee_auth:cashierAuth}},
      'recovery target has its own employee/Auth/session linkage before the upgrade snapshot');
    assert.equal((await scalar(db,'select count(*)::int as count from private.mfa_recovery_requests where employee_id=$1 and auth_user_id=$2',[ids.employee,cashierAuth])).count,3,
      'all recovery states are linked to the target employee Auth user, not the Admin HR actor');
    await apply(db, final26, final26);
    assert.deepEqual(await snapshot(), before, 'migration26 preserves populated recovery, audit, case, roster and employee snapshots');
    assert.equal((await scalar(db,'select count(*)::int as count from supabase_migrations.schema_migrations')).count,26,
      'populated baseline25 advances exactly through final migration26');
    await fixtureSession(db,cashierAuth,'authenticated','aal1');
    await db.exec('set role authenticated');
    const cashierContext=(await scalar(db,'select public.auth_access_context() as value')).value;
    assert.deepEqual(cashierContext,{employee_id:ids.employee,requires_mfa:false,current_level:'aal1',allowed:true,reason:null},
      'populated25→26 target uses its own no-factor password session');
    assert.equal((await scalar(db,'select factor_id from auth.sessions where id=(current_setting(\'request.jwt.claims\',true)::jsonb->>\'session_id\')::uuid')).factor_id,null,
      'the final26 target session is aal1 with no factor linkage');
    await db.exec('reset role');

    const replayed={};
    replayed.followup=(await runRpc(ids.authUser,'aal1',
      'select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
      [requests.followup.id,requests.followup.revision,requests.followup.key,requests.followup.status,requests.followup.owner,requests.followup.note,
        requests.followup.resolution,requests.followup.due,requests.followup.reason])).result;
    replayed.configuration=(await runRpc(ids.authUser,'aal1',
      'select public.supervisor_issue_category_save_v2(null,null,$1,$2,$3,true) as result',
      [requests.configuration.key,requests.configuration.code,requests.configuration.name])).result;
    replayed.planning=(await runRpc(ids.authUser,'aal1',
      'select public.staffing_interval_requirement_save_v2(null,null,$1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
      [requests.planning.key,requests.planning.outlet,requests.planning.weekday,requests.planning.starts,requests.planning.ends,
        requests.planning.minimum,requests.planning.from,requests.planning.until,requests.planning.reason])).result;
    replayed.issue=(await runRpc(cashierAuth,'aal1',
      'select public.outlet_issue_submit($1,$2,$3,$4,null,null,$5) as result',
      [requests.issue.outlet,requests.issue.category,requests.issue.description,requests.issue.urgency,requests.issue.key])).result;
    replayed.handover=(await runRpc(cashierAuth,'aal1',
      'select public.shift_handover_save_v2(null,null,$1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) as result',
      [requests.handover.key,requests.handover.outlet,requests.handover.workDate,requests.handover.senderAssignment,requests.handover.recipient,
        requests.handover.recipientAssignment,requests.handover.pendingWork,requests.handover.condition,requests.handover.notes,requests.handover.reason])).result;
    replayed.exchange=(await runRpc(cashierAuth,'aal1',
      'select public.shift_exchange_submit($1,$2,$3,$4,$5) as result',
      [requests.exchange.type,requests.exchange.assignment,requests.exchange.peer,requests.exchange.reason,requests.exchange.key])).result;
    replayed.roster=(await runRpc(ids.authUser,'aal1',
      'select public.cashier_roster_batch_save($1,$2,$3::jsonb) as result',
      [requests.roster.week,requests.roster.key,JSON.stringify(requests.roster.changes)])).result;
    assert.deepEqual(replayed,originalResults,'all seven original RPC keys/payloads replay their exact migration25 result after26 using aal1 sessions');
    const beforeReplaySnapshot=await snapshot();
    await assert.rejects(runRpc(ids.authUser,'aal1',
      'select public.supervisor_issue_category_save_v2(null,null,$1,$2,$3,true) as result',
      [requests.configuration.key,requests.configuration.code,'payload changed after migration26']),/Kunci konfigurasi/,
      'the original key cannot be replayed with a changed payload after26');
    assert.deepEqual(await snapshot(),beforeReplaySnapshot,'receipt replays and key/payload rejection add no business write, audit, or second receipt');
    console.log('Populated25→26 upgrade OK: linked recovery states, RPC-created receipts for all seven workflows, full snapshot equality, original key/payload replay under aal1 and changed-payload rejection');
  } finally { await db.close(); }
}

// Historical upgrade: prove the 12→13→m14 boundary, reproduce migration 14's
// failure before a later correction could run, then apply both bounded
// preflights and complete the upgrade without resets.
{
  const db = await createDb();
  try {
    const m13=idx('20261019061522');
    const m14=idx('20261020060745');
    const m22=idx('20261024110000');
    assert.equal(m13,12,'Historical fixture must stop after 12 migrations before applying migration 13');
    assert.equal(m14,13,'Historical fixture must stop after migration 13 before applying migration 14');
    await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text)');
    await apply(db,0,m13-1);
    await apply(db,m13,m13);
    const ids=await setupHistory(db,'off');
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
    await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[migrationVersion(migrationNames[m14]),migrationName(migrationNames[m14])]);
    for (let i=m14+1;i<migrationNames.length;i++) {
      const name=migrationNames[i];
      if (i===m22) {
        // The historical path must run the bounded preflight explicitly at
        // the 21-migration boundary; m22's own guard is not a substitute.
        await db.exec(hardeningPreflight);
        await db.exec(hardeningPreflight);
      }
      let next=await readFile(new URL(name,migrationDir),'utf8');
      next=next.replace('create extension if not exists pgcrypto with schema extensions;','');
      await db.exec(next);
      await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[migrationVersion(name),migrationName(name)]);
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
    console.log('Historical 12→26 upgrade OK: migration 13 boundary covered; preflight absence reproduced; both bounded preflights applied twice; migrations 14–26 completed');
  } finally { await db.close(); }
}
