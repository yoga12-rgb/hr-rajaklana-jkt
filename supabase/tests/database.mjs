// Run: npm ci && npm run test:database
// PGlite executes actual Postgres functions/RLS. Only Supabase-owned auth/storage
// plumbing is mocked; production migrations themselves are not rewritten on disk.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

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
  -- Reproduce older projects without automatic service-role table grants.
  alter default privileges in schema public revoke all on tables from service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/'); $$;
  create publication supabase_realtime;
`);
const migrationDir = new URL('../migrations/', import.meta.url);
const migrationNames = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
const hardenedTables = [
  'shift_handovers', 'shift_handover_versions', 'shift_handover_events',
  'shift_exchange_requests', 'shift_exchange_events',
  'supervisor_issue_categories', 'supervisor_capabilities', 'supervisor_issue_routes',
  'outlet_issues', 'outlet_issue_events', 'staffing_interval_requirements'
];
for (const name of migrationNames) {
  // Seed a deliberately stale open case after the old roster migration but
  // before the forward repair migration, proving the actual upgrade backfill.
  if (name === '20261020060745_cashier_spv_audit_repairs.sql') {
    const ids = {
      department: '30000000-0000-4000-8000-000000000001', position: '30000000-0000-4000-8000-000000000002',
      sourceOutlet: '30000000-0000-4000-8000-000000000003', staleOutlet: '30000000-0000-4000-8000-000000000004',
      employee: '30000000-0000-4000-8000-000000000005', assignment: '30000000-0000-4000-8000-000000000006',
      followup: '30000000-0000-4000-8000-000000000007'
    };
    const day = (await db.query("select ((now() at time zone 'Asia/Jakarta')::date-1)::text as day")).rows[0].day;
    await db.query("insert into public.departments(id,name) values($1,'Reparasi Audit Uji')", [ids.department]);
    await db.query("insert into public.positions(id,department_id,name,is_cashier) values($1,$2,'Kasir Reparasi Uji',true)", [ids.position,ids.department]);
    await db.query("insert into public.outlets(id,name) values($1,'Outlet Sumber Reparasi Uji'),($2,'Outlet Lama Reparasi Uji')", [ids.sourceOutlet,ids.staleOutlet]);
    await db.query(`insert into public.employees(id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,can_clock,account_status)
      values($1,'Kasir Reparasi Uji','081234567890',$2,$3,$4,$5,true,'active')`, [ids.employee,ids.department,ids.position,ids.sourceOutlet,day]);
    await db.query(`insert into public.cashier_assignments(id,employee_id,work_date,outlet_id,shift,reason,created_by)
      values($1,$2,$3,$4,'afternoon','Fixture sumber otoritatif untuk upgrade',$2)`, [ids.assignment,ids.employee,day,ids.sourceOutlet]);
    await db.query(`insert into public.spv_followups(id,case_key,issue_type,source_type,source_id,work_date,outlet_id,employee_id,shift,created_by,updated_by)
      values($1,$2,'missing_clockin','assignment',$3,$4,$5,$6,'morning',$6,$6)`,
      [ids.followup,`missing_clockin:${ids.assignment}`,ids.assignment,day,ids.staleOutlet,ids.employee]);
    globalThis.spvRepairUpgradeFixture = { ids, day };
  }
  if (name === '20261027090000_sensitive_operational_acl_hardening.sql') {
    // Hosted Preview has broad default table grants. Reproduce the effective
    // pre-migration ACL before applying the forward-only hardening migration.
    await db.exec(`grant all on table ${hardenedTables.map(table => `public.${table}`).join(',')} to anon,authenticated`);
    for (const table of hardenedTables) for (const role of ['anon','authenticated']) {
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,`public.${table}`,'INSERT'])).rows[0].allowed,true,
        `${role} fixture grant must reproduce the hosted INSERT exposure for ${table}`);
    }
  }
  let sql = await readFile(new URL(name, migrationDir), 'utf8');
  // gen_random_uuid is built into Postgres17. The pgcrypto package is owned by
  // hosted Supabase but not bundled in PGlite; no other statement is removed.
  sql = sql.replace('create extension if not exists pgcrypto with schema extensions;', '');
  try { await db.exec(sql); console.log(`Migration OK: ${name}`); }
  catch (error) { console.error(`Migration FAILED: ${name}`, error.message); throw error; }
  if (name === '20261027090000_sensitive_operational_acl_hardening.sql') {
    for (const table of hardenedTables) {
      for (const role of ['anon','authenticated']) for (const privilege of ['INSERT','UPDATE','DELETE']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,`public.${table}`,privilege])).rows[0].allowed,false,
          `${role} direct ${privilege} must be revoked from ${table}`);
      }
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',['authenticated',`public.${table}`,'SELECT'])).rows[0].allowed,true,
        `authenticated scoped SELECT must remain available for ${table}`);
      for (const role of ['anon','authenticated']) for (const statement of [
        `insert into public.${table} default values`,
        `update public.${table} set id=id where false`,
        `delete from public.${table} where false`
      ]) {
        await db.exec('begin');
        await db.exec(`set role ${role}`);
        await assert.rejects(db.exec(statement), /permission denied|row-level security|policy/,
          `${role} direct DML must fail at the database boundary for ${table}`);
        await db.exec('rollback');
        await db.exec('reset role');
      }
    }
    console.log('ACL hardening OK: hosted-style broad grants reproduced, direct DML revoked, RLS-scoped SELECT retained');
  }
  if (name === '20261020060745_cashier_spv_audit_repairs.sql') {
    const { ids, day } = globalThis.spvRepairUpgradeFixture;
    const repaired = (await db.query('select id,work_date::text as work_date,outlet_id,employee_id,shift from public.spv_followups where id=$1',[ids.followup])).rows[0];
    assert.deepEqual(repaired,{ id:ids.followup,work_date:day,outlet_id:ids.sourceOutlet,employee_id:ids.employee,shift:'afternoon' },
      'upgrade migration aligns an open case with its source without replacing its identity');
    const repairRecord = (await db.query(`select before_data->>'outlet_id' as before_outlet,after_data->>'outlet_id' as after_outlet
      from private.spv_followup_context_repair_log where migration_key='20261020052932_cashier_spv_audit_repairs' and followup_id=$1`,[ids.followup])).rows[0];
    assert.deepEqual(repairRecord,{ before_outlet:ids.staleOutlet,after_outlet:ids.sourceOutlet },'upgrade captures private before/after repair evidence');
    await db.query('delete from private.spv_followup_context_repair_log where followup_id=$1',[ids.followup]);
    await db.query('delete from public.spv_followups where id=$1',[ids.followup]);
    await db.query('delete from public.cashier_assignments where id=$1',[ids.assignment]);
    await db.query('delete from public.employees where id=$1',[ids.employee]);
    await db.query('delete from public.positions where id=$1',[ids.position]);
    await db.query('delete from public.departments where id=$1',[ids.department]);
    await db.query('delete from public.outlets where id in ($1,$2)',[ids.sourceOutlet,ids.staleOutlet]);
    delete globalThis.spvRepairUpgradeFixture;
    console.log('SPV upgrade backfill OK: open case context corrected, ID retained, private before/after evidence captured');
  }
}
const scalar = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
const realtimeSupervisorTables=(await db.query(`select c.relname from pg_catalog.pg_publication p
  join pg_catalog.pg_publication_rel pr on pr.prpubid=p.oid
  join pg_catalog.pg_class c on c.oid=pr.prrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where p.pubname='supabase_realtime' and n.nspname='public'
    and c.relname in ('outlet_issues','shift_handovers','shift_exchange_requests','staffing_interval_requirements')
  order by c.relname`)).rows.map(row=>row.relname);
assert.deepEqual(realtimeSupervisorTables,['outlet_issues','shift_exchange_requests','shift_handovers','staffing_interval_requirements'],
  'Supervisor mutations are published to the Realtime channel the client subscribes to');
let followupMutationKey = 0;
const updateFollowup = async (id,status,ownerId,note,resolutionNote,dueAt=undefined,reason='') => {
  const current=await scalar('select revision,due_at from public.spv_followups where id=$1',[id]);
  const key=`40000000-0000-4000-8000-${String(++followupMutationKey).padStart(12,'0')}`;
  return (await scalar(`select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as row`,
    [id,current.revision,key,status,ownerId,note,resolutionNote,dueAt===undefined?current.due_at:dueAt,reason])).row;
};
// Employee mutexes must serialize competing writes while remaining compatible
// with FK KEY SHARE checks for a different employee's audit/notification. Using
// FOR UPDATE here permits reciprocal HR applicants to deadlock each other.
const employeeMutexFunctions = [
  'private.check_leave_duplicate', 'private.set_deductions',
  'public.hr_save_employee', 'public.hr_set_roles', 'public.hr_save_employee_with_roles', 'public.issue_account_token',
  'public.claim_account_token', 'public.attendance_clock_in',
  'public.attendance_clock_out', 'public.attendance_correct',
  'public.attendance_record_manual', 'public.cashier_assignment_save',
  'public.cashier_roster_batch_save',
  'public.attendance_correction_submit', 'public.attendance_correction_cancel',
  'public.attendance_correction_decide', 'public.leave_record_retrospective',
  'public.biometric_enroll_server', 'public.biometric_review',
  'public.biometric_withdraw', 'public.biometric_issue_receipt',
  'public.attendance_clock_in_verified', 'private.protect_verified_selfie_delete',
  'private.dispatch_push_tick'
];
for (const qualifiedName of employeeMutexFunctions) {
  const [schema,name] = qualifiedName.split('.');
  const functions = (await db.query(`select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=$1 and p.proname=$2`,[schema,name])).rows;
  const mutexes = functions.flatMap(row => row.prosrc.match(/from public\.employees[^;]*for (?:no key )?update;/g) ?? []);
  assert.ok(mutexes.length, `${qualifiedName} retains its employee mutex`);
  assert.ok(mutexes.every(sql => sql.endsWith('for no key update;')),
    `${qualifiedName} employee mutex must allow cross-recipient FK KEY SHARE`);
}
const employeeUpdateLocks = (await db.query(`select n.nspname||'.'||p.proname as name from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
  and p.prosrc ~ 'from public\\.employees[^;]*for update;' order by 1`)).rows.map(row => row.name);
assert.deepEqual(employeeUpdateLocks,['public.finish_account_token'],
  'only the account finalizer that changes the unique Auth key retains FOR UPDATE on employees');
for (const [signature,entity] of [
  ['public.attendance_clock_out(double precision,double precision,double precision)','attendance'],
  ['public.attendance_correct(uuid,timestamptz,timestamptz,text,text)','attendance'],
  ['public.attendance_correction_decide(uuid,boolean,text)','attendance_correction_requests'],
  ['public.leave_correct_hours(uuid,date,date,jsonb,text,boolean,text,time,time)','leave_requests'],
  ['public.leave_decide_adjustment(uuid,boolean,jsonb,text,text)','leave_requests']
]) {
  const {prosrc} = await scalar('select prosrc from pg_proc where oid=$1::regprocedure',[signature]);
  assert.match(prosrc,new RegExp(`from public\\.${entity}[^;]*for update;`),
    `${signature} retains its protected entity/parent row lock`);
}
console.log('Lock contracts OK: employee mutexes use NO KEY UPDATE; FK-compatible audit/notification writes; entity locks and Auth key finalization preserved');
// New biometric gates intentionally revoke direct access to legacy capture RPCs.
// Preserve regression coverage of their internal GPS/capture/ownership contracts
// through harness-only wrappers; production migrations never create this schema.
// The separate biometric suite exercises the real verified public endpoints.
await db.exec(`
  create schema core_contract_tests;
  grant usage on schema core_contract_tests to authenticated;
  create function core_contract_tests.clock_in(text,double precision,double precision,double precision,text)
    returns public.attendance language sql security definer set search_path='' as $$ select public.attendance_clock_in($1,$2,$3,$4,$5); $$;
  create function core_contract_tests.clock_in(text,double precision,double precision,double precision,text,timestamptz,text)
    returns public.attendance language sql security definer set search_path='' as $$ select public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7); $$;
  create function core_contract_tests.clock_out(double precision,double precision,double precision)
    returns public.attendance language sql security definer set search_path='' as $$ select public.attendance_clock_out($1,$2,$3); $$;
  revoke all on all functions in schema core_contract_tests from public,anon,authenticated;
  grant execute on all functions in schema core_contract_tests to authenticated;
`);
const expectError = async (sql,params,fragment) => {
  try { await db.query(sql,params); assert.fail(`Expected error: ${fragment}`); }
  catch (error) { assert.ok(error.message.includes(fragment), error.message); }
};
const serviceReadMigration = migrationNames.find(name => name.endsWith('_hr_api_service_role_reads.sql'));
assert.ok(serviceReadMigration, 'Explicit hr-api service-role read migration is required');
const serviceReadSql = await readFile(new URL(serviceReadMigration,migrationDir),'utf8');
// Exercise the exact direct reads used by hr-api under the actual database role.
// Rollback keeps these permission/reproduction fixtures out of the domain tests.
await db.exec('begin');
await db.exec('revoke all on all tables in schema public from service_role');
await db.query(`select set_config('request.jwt.claim.role','service_role',false)`);
await db.exec('set role service_role');
for (const table of ['employee_roles','employees']) {
  await db.exec('savepoint missing_service_read');
  await expectError(`select count(*) from public.${table}`,[],'permission denied');
  await db.exec('rollback to savepoint missing_service_read');
}
// Existing SECURITY DEFINER RPCs already work without direct table/sequence grants.
assert.equal((await scalar('select public.auth_rate_limit($1,10) as allowed',['9'.repeat(64)])).allowed,true);
await db.exec('reset role');
await db.exec(serviceReadSql);
await db.exec('set role service_role');
assert.equal((await scalar("select count(*)::int as admins from public.employee_roles where role='admin_hr'")).admins,0);
assert.equal((await db.query('select id,status,account_status,auth_user_id from public.employees')).rows.length,0);
// The additive migration does not open unrelated tables or allow direct writes.
for (const statement of [
  'select * from public.account_tokens',
  'select * from public.departments',
  "insert into public.employee_roles(employee_id,role) values(gen_random_uuid(),'admin_hr')",
  'update public.employees set full_name=full_name',
  'delete from public.employee_roles'
]) {
  await db.exec('savepoint service_least_privilege');
  await expectError(statement,[],'permission denied');
  await db.exec('rollback to savepoint service_least_privilege');
}
await db.exec('set role anon');
await db.exec('savepoint anonymous_roles');
await expectError("select count(*) from public.employee_roles where role='admin_hr'",[],'permission denied');
await db.exec('rollback to savepoint anonymous_roles');
await db.exec('rollback');
console.log('Service reads OK: legacy missing-grant failure reproduced; bootstrap/login SELECTs repaired without client or write access');
const captureSignature='public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text)';
const verifiedCaptureExists=(await scalar("select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='attendance_clock_in_verified') as present")).present;
assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['authenticated',captureSignature,'EXECUTE'])).allowed,!verifiedCaptureExists);
if(verifiedCaptureExists) for(const signature of ['public.attendance_clock_in(text,double precision,double precision,double precision,text)','public.attendance_clock_out(double precision,double precision,double precision)']) {
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['authenticated',signature,'EXECUTE'])).allowed,false,'verified endpoint cannot be bypassed through legacy RPC grants');
}
assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['anon',captureSignature,'EXECUTE'])).allowed,false);
const captureFunction=await scalar(`select pronargdefaults as defaults,prosecdef as secured,proconfig as config from pg_proc where oid=$1::regprocedure`,[captureSignature]);
assert.equal(captureFunction.defaults,0,
  'metadata overload has no defaults that could make five-argument RPC ambiguous');
assert.equal(captureFunction.secured,true,'metadata wrapper retains security-definer execution');
assert.ok(captureFunction.config.includes('search_path=""'),'metadata wrapper fixes its search path');
// First-admin creation must preserve the exact reserved Auth alias. Roll back
// its fixture so the remaining access-control tests start with their own actors.
await db.exec('begin');
await db.query(`select set_config('request.jwt.claim.role','service_role',false)`);
await db.exec('set role service_role');
assert.equal((await scalar("select count(*)::int as admins from public.employee_roles where role='admin_hr'")).admins,0);
await db.exec('savepoint bootstrap_identity');
await expectError('select public.bootstrap_admin($1,$2,$3,$4)',
  ['10000000-0000-0000-0000-000000000099','Admin Awal','081234567899','Outlet Bootstrap'],'Identitas akun');
await db.exec('rollback to savepoint bootstrap_identity');
const reservation=(await scalar('select public.reserve_employee_number() as number')).number;
const bootstrapAuth='10000000-0000-0000-0000-000000000099';
await db.exec('reset role');
await db.query('insert into auth.users(id,email) values($1,$2)',[bootstrapAuth,`${reservation.toLowerCase()}@login.rajaklana.internal`]);
await db.exec('set role service_role');
const bootstrap=(await scalar('select to_jsonb(public.bootstrap_admin($1,$2,$3,$4)) as row',[bootstrapAuth,'Admin Awal','081234567899','Outlet Bootstrap'])).row;
assert.equal(bootstrap.employee_number,reservation,'bootstrap preserves Authalias');
assert.equal(bootstrap.auth_user_id,bootstrapAuth);
assert.equal(bootstrap.approval_mode,'external');
assert.equal((await scalar("select count(*)::int as admins from public.employee_roles where role='admin_hr'")).admins,1);
assert.deepEqual(await scalar('select id,status,account_status,auth_user_id from public.employees where employee_number=$1 and auth_user_id=$2',[reservation,bootstrapAuth]),
  {id:bootstrap.id,status:'active',account_status:'active',auth_user_id:bootstrapAuth});
await db.exec('savepoint bootstrap_duplicate');
await expectError('select public.bootstrap_admin($1,$2,$3,$4)',
  [bootstrapAuth,'Admin Awal','081234567899','Outlet Bootstrap Kedua'],'sudah dibuat');
await db.exec('rollback to savepoint bootstrap_duplicate');
await db.exec('rollback');
console.log('Bootstrap OK: actual service_role, reservednumber preserved, activeadmin, login/link reads, externalapproval');
const adminAuth='10000000-0000-0000-0000-000000000001';
const bakerAuth='10000000-0000-0000-0000-000000000002';
const cashierAuth='10000000-0000-0000-0000-000000000003';
const adminId='20000000-0000-0000-0000-000000000001';
const bakerId='20000000-0000-0000-0000-000000000002';
const cashierId='20000000-0000-0000-0000-000000000003';
const position=await scalar(`select p.id,p.department_id from public.positions p where p.is_cashier`);
const outlet=await scalar(`insert into public.outlets(name,latitude,longitude,radius_m) values('Uji Jabodetabek',-6.2,106.8,100) returning id`);
const clock=await scalar(`select (now() at time zone 'Asia/Jakarta')::date::text as today,extract(year from now())::int as year`);
await db.query(`insert into auth.users(id,email) values($1,'rk000001@login.rajaklana.internal'),($2,'rk000002@login.rajaklana.internal'),($3,'rk000003@login.rajaklana.internal')`,[adminAuth,bakerAuth,cashierAuth]);
for (const [id,auth,name,approver] of [[adminId,adminAuth,'Admin',null],[bakerId,bakerAuth,'Head Baker',adminId],[cashierId,cashierAuth,'Kasir',adminId]]) {
  await db.query(`insert into public.employees(id,auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,approver_employee_id,can_clock)
    values($1,$2,$3,'081234567890',$4,$5,$6,$7,'active',$8,true)`,[id,auth,name,position.department_id,position.id,outlet.id,`${clock.year-1}-01-01`,approver]);
}
await db.query(`insert into public.employee_roles values($1,'employee'),($1,'admin_hr'),($2,'employee'),($2,'head_baker'),($3,'employee')`,[adminId,bakerId,cashierId]);
// Existing capture/metadata scenarios now begin with explicit daily rosters.
for (const [employeeId,creatorId] of [[cashierId,adminId],[adminId,bakerId]]) {
  await db.query("insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by) values($1,$2,$3,'morning','Penugasan fixture absensi',$4)",[employeeId,clock.today,outlet.id,creatorId]);
}
const asUser=async(id,role='authenticated')=>{
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)`,[id,role]);
  await db.exec(`set role ${role}`);
};
await asUser(cashierAuth);
let rows=(await db.query('select * from public.employees')).rows;
assert.equal(rows.length,1,'employee cannot read other privateprofiles');
assert.equal(rows[0].id,cashierId);
assert.equal((await db.query('select * from public.employee_directory()')).rows.length,3);
const directoryKeys=Object.keys((await db.query('select * from public.employee_directory()')).rows[0]).sort();
assert.deepEqual(directoryKeys,['id','employee_number','full_name','department_id','position_id','outlet_id',
  'approver_employee_id','approval_mode','status','can_clock','can_middle_shift'].sort(),
  'directory exposes only safe organization fields');
await expectError('select public.leave_balance($1,$2)',[adminId,clock.year],'Tidak berhak');
const bal=await scalar('select public.leave_balance() as balance');
assert.equal(bal.balance.allowance,12);
// Grant ownership of an uploaded image exactly as Supabase Storage does.
const selfie=`${cashierAuth}/new-selfie.jpg`;
await db.query(`insert into storage.objects(bucket_id,name) values('attendance-selfies',$1)`,[selfie]);
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5)',['middle',-6.2,106.8,10,selfie],'belum diizinkan');
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5)',['morning',-7,106.8,10,selfie],'di luar radius');
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,500,selfie],'belum cukup akurat');
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,10,`${adminAuth}/fake.jpg`],'Selfie wajib');
const capturedAt=(await scalar(`select (clock_timestamp()-interval '35 seconds')::text as captured`)).captured;
const captureArgs=['morning',-6.2,106.8,10,selfie,capturedAt,'  Nama Outlet Saat Foto  '];
for(const metadata of [[null,'Outlet Foto'],[capturedAt,null],[capturedAt,'  '],[null,null]]) {
  await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5,$6,$7)',[...captureArgs.slice(0,5),...metadata],'harus lengkap');
}
for(const invalid of ['infinity','-infinity']) {
  await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5,$6,$7)',[...captureArgs.slice(0,5),invalid,'Outlet Foto'],'tidak valid');
}
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5,$6,$7)',
  ['middle',-6.2,106.8,10,selfie,capturedAt,'Outlet Foto'],'belum diizinkan');
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5,$6,$7)',
  ['morning',-7,106.8,10,selfie,capturedAt,'Outlet Foto'],'di luar radius');
assert.equal((await scalar('select count(*)::int as count from public.attendance')).count,0,
  'rejected metadata and GPS leave no attendance row');
const attendance=(await scalar('select to_jsonb(core_contract_tests.clock_in($1,$2,$3,$4,$5,$6,$7)) as row',captureArgs)).row;
assert.equal(attendance.required_minutes,480);
assert.equal(attendance.work_date,clock.today);
assert.equal(+new Date(attendance.selfie_captured_at),+new Date(capturedAt));
assert.ok(+new Date(attendance.selfie_captured_at)<+new Date(attendance.clock_in),'device capture instant stays separate from server clock in');
assert.equal(attendance.selfie_outlet_name,'Nama Outlet Saat Foto');
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5,$6,$7)',captureArgs,'selfie baru');
await expectError('select core_contract_tests.clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,10,selfie],'selfie baru');
await asUser(adminAuth);
await db.query(`update public.outlets set active=false,latitude=-6.3,longitude=106.9,radius_m=20 where id=$1`,[outlet.id]);
await asUser(cashierAuth);
await expectError('select core_contract_tests.clock_out($1,$2,$3)',[-6.3,106.9,10],'di luar radius');
await expectError('select core_contract_tests.clock_out($1,$2,$3)',[-7,106.8,10],'di luar radius');
await db.query('select core_contract_tests.clock_out($1,$2,$3)',[-6.2,106.8,10]);
await expectError('select core_contract_tests.clock_out($1,$2,$3)',[-6.2,106.8,10],'Tidak ada clock in');
console.log('Attendance OK: GPS,accuracy,selfie,capturemetadata,permissions,duplicate,out');
await asUser(adminAuth);
await db.query(`update public.outlets set active=true,morning_starts_at='09:00',late_tolerance_minutes=60,latitude=-6.2,longitude=106.8,radius_m=100 where id=$1`,[outlet.id]);
const corrected=(await scalar('select to_jsonb(public.attendance_correct($1,$2,$3,$4,$5)) as row',[
  attendance.id,attendance.clock_in,(await scalar('select clock_out from public.attendance where id=$1',[attendance.id])).clock_out,
  'Koreksi shift untuk pemeriksaan','morning'])).row;
assert.equal(corrected.expected_in,attendance.expected_in,'correction preserves historicalshiftstart');
assert.equal(corrected.tolerance_minutes,attendance.tolerance_minutes,'correction preserves historicaltolerance');
assert.equal(corrected.late_minutes,attendance.late_minutes,'changed outlet settings do not rewrite pastlateness');
assert.equal(corrected.corrected,true);
assert.equal(corrected.selfie_captured_at,attendance.selfie_captured_at,'correction preserves camera capture instant');
assert.equal(corrected.selfie_outlet_name,attendance.selfie_outlet_name,'correction preserves capture outlet snapshot');
await db.query(`update public.outlets set late_tolerance_minutes=0 where id=$1`,[outlet.id]);
const adminSelfie=`${adminAuth}/own-selfie.jpg`;
await db.query(`insert into storage.objects(bucket_id,name) values('attendance-selfies',$1)`,[adminSelfie]);
const ownAttendance=(await scalar('select to_jsonb(core_contract_tests.clock_in($1,$2,$3,$4,$5)) as row',['morning',-6.2,106.8,10,adminSelfie])).row;
assert.equal(ownAttendance.selfie_captured_at,null,'legacy five-argument call remains usable without inventing capture evidence');
assert.equal(ownAttendance.selfie_outlet_name,null);
await expectError('select public.attendance_correct($1,$2,$3,$4)',[ownAttendance.id,ownAttendance.clock_in,null,'Mengoreksi absensi sendiri'],'sendiri');
await db.query('select core_contract_tests.clock_out($1,$2,$3)',[-6.2,106.8,10]);
console.log('Correction OK: reason/audit,historicalsnapshot,noowncorrection');

// Camera/GPS failure may require a new manual row, not a fake verified selfie.
const yesterday=(await scalar(`select ((now() at time zone 'Asia/Jakarta')::date-1)::text as date`)).date;
const manualIn=`${yesterday}T15:12:00+07:00`,manualOut=`${yesterday}T23:12:00+07:00`;
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [adminId,'afternoon',manualIn,manualOut,'Lokasi tidak terbaca'],'sendiri');
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [cashierId,'afternoon',manualIn,manualOut,'GPS'],'Alasan');
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [cashierId,'middle',manualIn,manualOut,'Lokasi tidak terbaca'],'belum diizinkan');
await expectError('select public.attendance_record_manual($1,$2,now()+interval \'1 day\',null,$3)',
  [cashierId,'afternoon','Lokasi tidak terbaca'],'Waktu');
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [cashierId,'afternoon',manualOut,manualIn,'Lokasi tidak terbaca'],'Waktu');
const manual=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',
  [cashierId,'afternoon',manualIn,manualOut,'Lokasi tidak terbaca, dikonfirmasi SPV'])).row;
assert.equal(manual.source,'manual');
assert.equal(manual.corrected,true);
assert.equal(manual.selfie_path,null);
assert.equal(manual.selfie_captured_at,null,'manual entries have no camera capture evidence');
assert.equal(manual.selfie_outlet_name,null);
assert.equal(manual.in_latitude,null);
assert.equal(manual.in_distance_m,null);
assert.equal(manual.worked_minutes,480);
assert.equal(manual.late_minutes,12);
assert.equal(manual.work_date,yesterday);
const manualAudit=await scalar('select action,reason,actor_employee_id,before_data from public.audit_events where entity_id=$1',[manual.id]);
assert.equal(manualAudit.action,'recorded_manual');
assert.equal(manualAudit.actor_employee_id,adminId);
assert.equal(manualAudit.before_data,null);
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [cashierId,'afternoon',manualIn,manualOut,'Pencatatan ulang'],'bertabrakan');
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [cashierId,'morning',`${yesterday}T07:00:00+07:00`,`${yesterday}T15:00:00+07:00`,'Pencatatan ulang'],'sudah tercatat');
await asUser(cashierAuth);
await expectError('select public.attendance_record_manual($1,$2,$3,$4,$5)',
  [adminId,'afternoon',manualIn,manualOut,'Lokasi tidak terbaca'],'Akses Admin HR');
assert.equal((await db.query('select * from public.attendance where id=$1',[manual.id])).rows.length,1,'manual record visible to owner');
await asUser(bakerAuth);
assert.equal((await db.query('select * from public.attendance where id=$1',[manual.id])).rows.length,0,'unrelated employee cannot read manual record');
await asUser(cashierAuth);
console.log('Manual attendance OK: HR/noown,reason,times,permissions,overlap,source,evidence,audit,RLS');

await asUser(adminAuth);
const overlapDates=await scalar(`select ((now() at time zone 'Asia/Jakarta')::date-4)::text as first,
  ((now() at time zone 'Asia/Jakarta')::date-3)::text as second`);
for (const [employeeId,open] of [[cashierId,false],[bakerId,true]]) {
  const firstIn=`${overlapDates.first}T23:00:00+07:00`,firstOut=`${overlapDates.second}T06:00:00+07:00`;
  const nextIn=`${overlapDates.second}T07:00:00+07:00`,nextOut=`${overlapDates.second}T15:00:00+07:00`;
  const first=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',
    [employeeId,'afternoon',firstIn,firstOut,'Sesi malam dikonfirmasi SPV'])).row;
  const next=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',
    [employeeId,'morning',nextIn,open ? null : nextOut,'Sesi pagi dikonfirmasi SPV'])).row;
  const auditBefore=(await scalar('select count(*)::int as count from public.audit_events where entity_id=$1',[first.id])).count;
  await expectError('select public.attendance_correct($1,$2,$3,$4)',
    [first.id,firstIn,`${overlapDates.second}T08:00:00+07:00`,'Usulan perpanjangan sesi malam'],'bertabrakan');
  assert.deepEqual((await scalar('select to_jsonb(a) as row from public.attendance a where id=$1',[first.id])).row,first,
    `overlap with ${open ? 'open' : 'closed'} next session leaves attendance unchanged`);
  assert.equal((await scalar('select count(*)::int as count from public.audit_events where entity_id=$1',[first.id])).count,auditBefore,
    'rejected overlap writes no audit');
  const adjacent=(await scalar('select to_jsonb(public.attendance_correct($1,$2,$3,$4)) as row',
    [first.id,firstIn,nextIn,'Akhir sesi malam dikonfirmasi SPV'])).row;
  assert.equal(adjacent.worked_minutes,480,'adjacent sessions allowed and corrected row excluded');
  if (open) await db.query('select public.attendance_correct($1,$2,$3,$4)',[next.id,nextIn,nextOut,'Konfirmasi jam pulang sesi pagi']);
  await expectError('select public.attendance_correct($1,$2,$3,$4)',
    [first.id,firstIn,null,'Usulan membuka kembali sesi malam'],'bertabrakan');
}
await asUser(cashierAuth);
console.log('Correction overlap OK: closed/open,crossmidnight,adjacent,noauditonfailure,reopening');

const future=`${clock.year}-12-30`;
const request=(await scalar(`select to_jsonb(public.leave_submit('annual',$1::date,$1::date,'Keperluan keluarga')) as row`,[future])).row;
await expectError(`select public.leave_decide($1,'approved','{}')`,[request.id],'sendiri');
await asUser(bakerAuth);
await expectError(`select public.leave_decide($1,'approved','{}')`,[request.id],'bukan pemberi persetujuan');
assert.equal((await db.query('select * from public.leave_requests')).rows.length,0,'unassigned HeadBaker cannotread request');
await asUser(adminAuth);
await db.query(`select public.leave_decide($1,'approved',$2)`,[request.id,JSON.stringify({[clock.year]:2})]);
await expectError(`select public.leave_decide($1,'approved',$2)`,[request.id,JSON.stringify({[clock.year]:2})],'sudah diproses');
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year])).balance.remaining,10);
await asUser(cashierAuth);
const adjustment=(await scalar('select public.leave_request_change($1,$2,$3,$4) as change',[request.id,`${clock.year+1}-01-02`,`${clock.year+1}-01-02`,'Perubahan ke tahun depan'])).change;
assert.equal(adjustment.request.starts_on,future,'pendingchange preserves originaldate');
assert.equal(adjustment.request.deductions[clock.year],2,'pendingchange preserves charge');
await asUser(adminAuth);
await db.query(`select public.leave_decide_adjustment($1,true,$2)`,[adjustment.adjustment.id,JSON.stringify({[clock.year+1]:1})]);
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year])).balance.remaining,12);
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year+1])).balance.remaining,11);
await expectError(`select public.leave_decide_adjustment($1,true,'{}')`,[adjustment.adjustment.id],'sudah diproses');
await asUser(cashierAuth);
const cancellation=(await scalar('select public.leave_request_cancel($1,$2) as cancel',[request.id,'Tidak jadi cuti'])).cancel;
await asUser(adminAuth);
await db.query(`select public.leave_decide_adjustment($1,true,'{}')`,[cancellation.adjustment.id]);
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year+1])).balance.remaining,12);
console.log('Leave OK: selfapproval,assignedapprover,atomicdeduction,doubledecision,crossyearchange,cancelrefund');

// Assigned HeadBaker may review a team request while personal data stays private.
await db.exec('reset role');
await db.query('update public.employees set approver_employee_id=$1 where id=$2',[bakerId,cashierId]);
await asUser(cashierAuth);
const teamRequest=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Izin pribadi')) as row`,[future])).row;
await asUser(bakerAuth);
assert.equal((await db.query('select * from public.leave_requests where id=$1',[teamRequest.id])).rows.length,1);
const teamDirectory=(await db.query('select * from public.employee_directory() where id=$1',[cashierId])).rows[0];
assert.equal(teamDirectory.approver_employee_id,bakerId,'HeadBaker can resolve team approval relationship');
assert.equal(teamDirectory.department_id,position.department_id);
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year])).balance.remaining,12,
  'HeadBaker obtains balance through authorized RPC without private start date/ledger');
await db.query(`select public.leave_decide($1,'approved','{}')`,[teamRequest.id]);
assert.equal((await db.query('select * from public.employees')).rows.length,1,'approver sees onlyown personalprofile');
console.log('Approver RLS OK: teamrequest visible, employeeprivacy preserved');

// Relevant single times are valid; an interval requires both endpoints. Changes
// are checked before creating a pending adjustment, not deferred to approval.
await asUser(cashierAuth);
const lateRequest=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Izin datang terlambat','late_arrival','10:30',null)) as row`,[future])).row;
assert.equal(lateRequest.starts_at,'10:30:00');
assert.equal(lateRequest.ends_at,null);
const earlyRequest=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Pulang lebih awal','early_departure','16:00',null)) as row`,[future])).row;
assert.equal(earlyRequest.starts_at,'16:00:00');
await expectError(`select public.leave_submit('personal',$1,$1,'Keluar sementara','temporary_exit','12:00',null)`,[future],'jam keluar dan kembali');
await expectError(`select public.leave_submit('personal',$1,$1,'Keluar sementara','temporary_exit','13:00','12:00')`,[future],'setelah jam keluar');
const intervalRequest=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Keluar sementara','temporary_exit','12:00','13:00')) as row`,[future])).row;
assert.equal(intervalRequest.ends_at,'13:00:00');
await asUser(bakerAuth);
await db.query(`select public.leave_decide($1,'approved','{}')`,[lateRequest.id]);
await asUser(cashierAuth);
await expectError('select public.leave_request_change($1,$2,$2,$3,null,null)',[lateRequest.id,future,'Perubahan jam izin'],'jam izin');
const lateChange=(await scalar(`select public.leave_request_change($1,$2,$2,'Perubahan jam izin','11:00',null) as change`,[lateRequest.id,future])).change;
assert.equal(lateChange.request.starts_at,'10:30:00','pending change preserves original approved time');
await asUser(bakerAuth);
await db.query(`select public.leave_decide_adjustment($1,true,'{}')`,[lateChange.adjustment.id]);
assert.equal((await scalar('select starts_at::text from public.leave_requests where id=$1',[lateRequest.id])).starts_at,'11:00:00');
console.log('Partial-day leave OK: single relevant time,interval endpoints,early validation,approved time change');

// An external decision is recorded by a different HR account, with the human
// decider named. The applicant cannot record their own external approval.
await db.exec('reset role');
await db.query("update public.employees set approval_mode='external' where id=$1",[adminId]);
await asUser(adminAuth);
const externalRequest=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Persetujuan Manager Jogja')) as row`,[future])).row;
await expectError(`select public.leave_decide($1,'approved','{}',null,'Manager Pusat Jogja')`,[externalRequest.id],'sendiri');
await asUser(bakerAuth);
await expectError(`select public.leave_decide($1,'approved','{}',null,'Manager Pusat Jogja')`,[externalRequest.id],'Akses Admin HR');
await db.exec('reset role');
await db.query("insert into public.employee_roles values($1,'admin_hr')",[bakerId]);
await asUser(bakerAuth);
await expectError(`select public.leave_decide($1,'approved','{}')`,[externalRequest.id],'Nama pemberi keputusan');
const externalDecision=(await scalar(`select to_jsonb(public.leave_decide($1,'approved','{}',null,'Manager Pusat Jogja')) as row`,[externalRequest.id])).row;
assert.equal(externalDecision.external_decider,'Manager Pusat Jogja');
assert.equal(externalDecision.decision_by,bakerId);
await db.exec('reset role');
await db.query("delete from public.employee_roles where employee_id=$1 and role='admin_hr'",[bakerId]);
console.log('External approval OK: noown,HRonly,deciderrequired,separate recorder');

// Insufficient balance must roll back both decision and financial ledger.
await asUser(cashierAuth);
const costly=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Izin dengan potongan')) as row`,[`${clock.year}-12-28`])).row;
const overdraft=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Pengujian saldo tidak cukup')) as row`,[`${clock.year}-12-29`])).row;
await asUser(bakerAuth);
await db.query(`select public.leave_decide($1,'approved',$2)`,[costly.id,JSON.stringify({[clock.year]:10})]);
await expectError(`select public.leave_decide($1,'approved',$2)`,[overdraft.id,JSON.stringify({[clock.year]:3})],'tidak cukup');
assert.equal((await scalar('select status from public.leave_requests where id=$1',[overdraft.id])).status,'pending');
await asUser(adminAuth);
assert.equal((await db.query('select * from public.leave_ledger where leave_request_id=$1',[overdraft.id])).rows.length,0);
console.log('Ledger rollback OK: competingdeduction cannot overdraft or partiallyapprove');

// Owner cleanup removes failed uploads, never referenced evidence or another
// owner's objects. Even references on a profile hidden by RLS must be respected.
await asUser(cashierAuth);
for (const bucket of ['attendance-selfies','leave-attachments','profile-photos']) {
  const unusedPath=`${cashierAuth}/unused-${bucket}.jpg`;
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,unusedPath]);
  assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id',[bucket,unusedPath])).rows.length,1);
}
assert.equal((await db.query("delete from storage.objects where bucket_id='attendance-selfies' and name=$1 returning id",[selfie])).rows.length,0,
  'referenced selfie cannot be removed');
const usedAttachment=`${cashierAuth}/leave-proof.pdf`;
await db.query("insert into storage.objects(bucket_id,name) values('leave-attachments',$1)",[usedAttachment]);
await db.query(`select public.leave_submit('personal',$1,$1,'Izin dengan bukti','full_day',null,null,$2)`,[`${clock.year}-12-27`,usedAttachment]);
assert.equal((await db.query("delete from storage.objects where bucket_id='leave-attachments' and name=$1 returning id",[usedAttachment])).rows.length,0,
  'referenced leave evidence cannot be removed');
const profilePhoto=`${cashierAuth}/profile.jpg`;
await db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)",[profilePhoto]);
await db.query('select public.update_my_profile($1)',[JSON.stringify({photo_path:profilePhoto})]);
await expectError('select public.update_my_profile($1)',[JSON.stringify({position_id:position.id})],'tidak diizinkan');
assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' and name=$1 returning id",[profilePhoto])).rows.length,0);
const hiddenReference=`${cashierAuth}/hidden-reference.jpg`;
await db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)",[hiddenReference]);
await asUser(adminAuth);
await db.query('select public.hr_save_employee($1,$2,$3)',[JSON.stringify({photo_path:hiddenReference}),bakerId,'Foto profil dikonfirmasi']);
assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' and name=$1 returning id",[hiddenReference])).rows.length,0,
  'HR cannot delete another owner upload');
await asUser(cashierAuth);
assert.equal((await db.query('select * from public.employees where id=$1',[bakerId])).rows.length,0);
assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' and name=$1 returning id",[hiddenReference])).rows.length,0,
  'hidden profile reference still prevents cleanup');
console.log('Storage RLS OK: unusedowner cleanup,immutableevidence,hiddenreferences,profileallowlist');

// New leave workflows run as real authenticated employees and HR. Keep the
// fixtures transactional so the original scenarios retain independent balances.
await db.exec('begin');
await db.exec('reset role');
const editSignature='public.leave_edit(uuid,date,date,text,time,time,text,boolean)';
const correctSignature='public.leave_correct(uuid,date,date,jsonb,text,boolean,text)';
for (const signature of [editSignature,correctSignature]) {
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['authenticated',signature,'EXECUTE'])).allowed,true);
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['anon',signature,'EXECUTE'])).allowed,false);
  assert.ok((await scalar('select proconfig from pg_proc where oid=$1::regprocedure',[signature])).proconfig.includes('search_path=""'));
}
assert.equal((await scalar("select has_function_privilege('authenticated','private.check_leave_duplicate()','EXECUTE') as allowed")).allowed,false);
// Errors abort an explicit transaction; use a savepoint for each negative test.
const workflowError=async(sql,params,fragment)=>{
  await db.exec('savepoint workflow_failure');
  await expectError(sql,params,fragment);
  await db.exec('rollback to savepoint workflow_failure');
};
await asUser(cashierAuth);
const editProof=`${cashierAuth}/edit-proof.pdf`,replacementProof=`${cashierAuth}/replacement-proof.pdf`,foreignProof=`${adminAuth}/foreign-proof.pdf`;
for(const path of [editProof,replacementProof]) await db.query("insert into storage.objects(bucket_id,name) values('leave-attachments',$1)",[path]);
await db.exec('reset role');
await db.query("insert into storage.objects(bucket_id,name) values('leave-attachments',$1)",[foreignProof]);
await asUser(cashierAuth);
const editable=(await scalar("select to_jsonb(public.leave_submit('sick',$1,$1,'Sakit dengan surat','full_day',null,null,$2)) as row",[future,editProof])).row;
await asUser(bakerAuth);
await db.query("select public.leave_decide($1,'needs_info','{}','Mohon bukti yang lebih jelas')",[editable.id]);
await workflowError('select public.leave_edit($1,$2,$2,$3)',[editable.id,future,'Mengubah milik orang lain'],'pemilik');
await asUser(cashierAuth);
const edited=(await scalar('select to_jsonb(public.leave_edit($1,$2,$2,$3)) as row',[editable.id,`${clock.year+1}-01-04`,'Surat dokter telah diperjelas'])).row;
assert.equal(edited.status,'pending');
assert.equal(edited.kind,'sick'); assert.equal(edited.extent,'full_day');
assert.equal(edited.attachment_path,editProof,'omitted attachment keeps existing private evidence');
for(const key of ['decision_by','external_decider','decided_at','decision_note']) assert.equal(edited[key],null,'editing clears old decision metadata');
assert.deepEqual(edited.deductions,{});
await workflowError('select public.leave_edit($1,$2,$2,$3,null,null,$4,true)',[editable.id,future,'Bukti tidak dimiliki',foreignProof],'bukan milik');
await workflowError('select public.leave_edit($1,$2,$2,$3,null,null,$4,true)',[editable.id,future,'Bukti belum diunggah',`${cashierAuth}/missing.pdf`],'tidak ditemukan');
const replaced=(await scalar('select to_jsonb(public.leave_edit($1,$2,$2,$3,null,null,$4,true)) as row',[editable.id,future,'Bukti diganti oleh pemilik',replacementProof])).row;
assert.equal(replaced.attachment_path,replacementProof);
const removed=(await scalar('select to_jsonb(public.leave_edit($1,$2,$2,$3,null,null,null,true)) as row',[editable.id,future,'Lampiran lama dihapus'])).row;
assert.equal(removed.attachment_path,null);
await workflowError('select public.leave_edit($1,$2,$2,$3)',[editable.id,yesterday,'Pengubahan tanggal lampau'],'dikoreksi HR');
await workflowError('select public.leave_edit($1,$2,$2,$3)',[editable.id,future,'xx'],'Alasan');
await workflowError('select public.leave_edit($1,null,null,$2)',[editable.id,'Tanggal tidak lengkap'],'Tanggal');
await workflowError('select public.leave_edit($1,$2,$2,$3)',[lateRequest.id,future,'Mengubah langsung izin disetujui'],'diedit langsung');
await asUser(adminAuth);
const editAudit=await scalar("select before_data,after_data from public.audit_events where entity_id=$1 and action='edited' order by id limit 1",[editable.id]);
assert.equal(editAudit.before_data.status,'needs_info'); assert.equal(editAudit.after_data.status,'pending');
assert.equal((await scalar('select count(*)::int as count from public.leave_ledger where leave_request_id=$1',[editable.id])).count,0);
await db.exec('reset role');
const historicPending=await scalar("insert into public.leave_requests(employee_id,kind,starts_on,ends_on,reason) values($1,'sick',$2,$2,'Pengajuan lampau belum diproses') returning id",[cashierId,yesterday]);
await db.query("update public.employees set account_status='disabled' where id=$1",[cashierId]);
await asUser(cashierAuth);
await workflowError('select public.leave_edit($1,$2,$2,$3)',[editable.id,future,'Akun yang dinonaktifkan'],'tidak aktif');
await db.exec('reset role');
await db.query("update public.employees set account_status='active' where id=$1",[cashierId]);
await asUser(cashierAuth);
await workflowError('select public.leave_edit($1,$2,$2,$3)',[historicPending.id,future,'Memindahkan pengajuan asli lampau'],'dikoreksi HR');
console.log('Leave edit OK: owneronly,needsinfo reset,privateattachment preserve/replace/remove,audit,noledger');

await asUser(cashierAuth);
await workflowError("select public.leave_submit('personal',$1,$1,'Alasan lain tetap duplikat')",[future],'sama');
await workflowError('select public.leave_edit($1,$2,$2,$3)',[overdraft.id,future,'Edit ke pengajuan yang sama'],'sama');
await workflowError('select public.leave_request_change($1,$2,$2,$3)',[overdraft.id,future,'Klien lama tetap dicegah'],'sama');
const timed=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Jam izin bertumpang tindih','temporary_exit','12:30','13:30')) as row",[future])).row;
assert.equal(timed.starts_at,'12:30:00','overlap with another interval is permitted');
const attendanceIzin=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Izin di hari dengan absensi sah','temporary_exit','12:00','13:00')) as row",[clock.today])).row;
assert.equal(attendanceIzin.starts_on,attendance.work_date,'hourly izin can coexist with a valid attendance record');
await workflowError("select public.leave_submit('personal',$1,$1,'Alasan lain jam sama','temporary_exit','12:30','13:30')",[future],'sama');
await asUser(bakerAuth);
await db.query("select public.leave_decide($1,'needs_info','{}','Memerlukan konfirmasi lebih lanjut')",[timed.id]);
await asUser(cashierAuth);
await workflowError("select public.leave_submit('personal',$1,$1,'Duplikat masih perlu info','temporary_exit','12:30','13:30')",[future],'sama');
await asUser(bakerAuth);
await db.query("select public.leave_decide($1,'rejected','{}','Usulan ditolak setelah klarifikasi')",[timed.id]);
await asUser(cashierAuth);
const retry=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Boleh mengajukan ulang setelah ditolak','temporary_exit','12:30','13:30')) as row",[future])).row;
await db.query('select public.leave_request_cancel($1,$2)',[retry.id,'Pemilik membatalkan sebelum keputusan']);
const retryCancelled=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Boleh mengajukan ulang setelah dibatalkan','temporary_exit','12:30','13:30')) as row",[future])).row;
await workflowError('select public.leave_edit($1,$2,$2,$3,$4,$5)',[retryCancelled.id,future,'Jam interval tidak lengkap','12:00',null],'jam keluar dan kembali');
const timeEdit=(await scalar('select to_jsonb(public.leave_edit($1,$2,$2,$3,$4,$5)) as row',[retryCancelled.id,future,'Perbaikan jam izin','12:45','13:45'])).row;
assert.equal(timeEdit.starts_at,'12:45:00');
const duplicateAdjustment=(await scalar("select public.leave_request_change($1,$2,$2,'Usulan yang sama dengan izin lain','12:00','13:00') as change",[lateRequest.id,future])).change;
// The original extent is preserved: use another late-arrival request as the
// exact destination so approval, rather than the proposal, is the mutation.
const lateDestination=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Tujuan duplikat perubahan','late_arrival','12:00','13:00')) as row",[future])).row;
await asUser(bakerAuth);
await workflowError("select public.leave_decide_adjustment($1,true,'{}')",[duplicateAdjustment.adjustment.id],'sama');
assert.equal((await scalar('select status from public.leave_adjustments where id=$1',[duplicateAdjustment.adjustment.id])).status,'pending');
assert.equal((await scalar('select starts_at::text from public.leave_requests where id=$1',[lateRequest.id])).starts_at,'11:00:00');
await db.query("select public.leave_decide_adjustment($1,false,'{}','Perubahan ditolak karena duplikat')",[duplicateAdjustment.adjustment.id]);
// The index independently enforces uniqueness even if a privileged write skips
// the friendly trigger. This is also the PostgreSQL concurrent-write arbiter.
await db.exec('reset role');
await db.exec('savepoint unique_index_guard');
await db.exec('alter table public.leave_requests disable trigger leave_no_exact_duplicate');
await expectError("insert into public.leave_requests(employee_id,kind,starts_on,ends_on,reason) values($1,'personal',$2,$2,'Penjaga indeks tanpa trigger')",[cashierId,future],'leave_active_exact_unique');
await db.exec('rollback to savepoint unique_index_guard');
console.log('Duplicates OK: pending/needsinfo/approved,reasonignored,legacyedit,adjustmentrollback,rejected/cancelledretry,overlapallowed');

await asUser(cashierAuth);
await workflowError("select public.leave_correct($1,$2,$2,'{}','Koreksi oleh karyawan')",[costly.id,future],'Akses Admin HR');
await asUser(bakerAuth);
await workflowError("select public.leave_correct($1,$2,$2,'{}','Pemberi persetujuan bukan HR')",[costly.id,future],'Akses Admin HR');
await asUser(adminAuth);
await workflowError("select public.leave_correct($1,$2,$2,'{}','Koreksi milik sendiri',false,'Manager Jogja')",[externalRequest.id,future],'sendiri');
await workflowError("select public.leave_correct($1,$2,$2,'{}','Koreksi belum disetujui')",[editable.id,future],'disetujui');
await workflowError("select public.leave_correct($1,$2,$2,'{}','xx')",[costly.id,future],'Alasan koreksi');
await workflowError("select public.leave_correct($1,$2,$2,'{}','Tujuan sama dengan izin aktif')",[costly.id,future],'sama');
assert.equal((await scalar('select deductions from public.leave_requests where id=$1',[costly.id])).deductions[clock.year],10,'failed duplicate correction rolls back ledger allocation');
const ledgerBefore=(await scalar('select count(*)::int as count from public.leave_ledger where leave_request_id=$1',[costly.id])).count;
const hrCorrected=(await scalar('select to_jsonb(public.leave_correct($1,$2,$2,$3,$4)) as row',[costly.id,yesterday,JSON.stringify({[clock.year]:8}),'Koreksi tanggal setelah konfirmasi HR'])).row;
assert.equal(hrCorrected.starts_on,yesterday); assert.equal(hrCorrected.status,'approved');
assert.equal(hrCorrected.deductions[clock.year],8); assert.equal(hrCorrected.decision_by,adminId);
assert.equal(hrCorrected.decision_note,'Koreksi tanggal setelah konfirmasi HR');
assert.equal((await scalar('select sum(amount)::text as amount from public.leave_ledger where leave_request_id=$1',[costly.id])).amount,'-8.00');
await db.query('select public.leave_correct($1,$2,$2,$3,$4)',[costly.id,yesterday,JSON.stringify({[clock.year]:8}),'Pengulangan koreksi tanpa perubahan saldo']);
assert.equal((await scalar('select count(*)::int as count from public.leave_ledger where leave_request_id=$1',[costly.id])).count,ledgerBefore+1,'same correction cannot refund twice');
await db.query('select public.leave_correct($1,$2,$2,$3,$4)',[costly.id,yesterday,JSON.stringify({[clock.year]:9}),'Koreksi tambahan potongan satu hari']);
assert.equal((await scalar('select sum(amount)::text as amount from public.leave_ledger where leave_request_id=$1',[costly.id])).amount,'-9.00');
const correctionAudit=await scalar("select before_data,after_data from public.audit_events where entity_id=$1 and action='corrected' order by created_at,id limit 1",[costly.id]);
assert.equal(correctionAudit.before_data.deductions[clock.year],10);
assert.equal(correctionAudit.after_data.deductions[clock.year],8);
await asUser(cashierAuth);
const blockedCorrection=(await scalar('select public.leave_request_change($1,$2,$2,$3) as change',[teamRequest.id,`${clock.year+1}-01-05`,'Perubahan menunggu pemeriksaan'])).change;
await asUser(adminAuth);
await workflowError("select public.leave_correct($1,$2,$2,'{}','Koreksi saat perubahan menunggu')",[teamRequest.id,future],'masih menunggu');
await asUser(bakerAuth);
await db.query("select public.leave_decide_adjustment($1,false,'{}','Perubahan tidak diteruskan')",[blockedCorrection.adjustment.id]);
// HR corrections preserve the extent and require one date for partial-day izin.
await asUser(adminAuth);
await workflowError("select public.leave_correct($1,$2,$3,'{}','Rentang hari untuk izin jam')",[lateRequest.id,yesterday,future],'satu tanggal');
// Give this approved interval an external decision source and verify that every
// subsequent HR correction names the external human who made the decision.
await db.exec('reset role');
await db.query("update public.employees set approval_mode='external' where id=$1",[cashierId]);
await asUser(adminAuth);
// intervalRequest is pending; approve it through the existing external flow.
await db.query("select public.leave_decide($1,'approved','{}','Keputusan izin','Manager Pusat')",[intervalRequest.id]);
await workflowError("select public.leave_correct($1,$2,$2,'{}','Koreksi keputusan eksternal')",[intervalRequest.id,yesterday],'Nama pemberi keputusan');
const externalCorrected=(await scalar("select to_jsonb(public.leave_correct($1,$2,$2,'{}','Koreksi dikonfirmasi atasan',false,'Manager Pusat Baru')) as row",[intervalRequest.id,yesterday])).row;
assert.equal(externalCorrected.external_decider,'Manager Pusat Baru');
assert.equal(externalCorrected.extent,'temporary_exit'); assert.equal(externalCorrected.starts_at,'12:00:00');
await db.exec('reset role');
await db.query("update public.employees set approval_mode='internal' where id=$1",[cashierId]);
await asUser(adminAuth);
// A historic charged request reproduces the year-boundary refund scenario.
// Service-owned data setup is the only way to seed a prior-year charge now.
await db.exec('reset role');
const historic=(await scalar("insert into public.leave_requests(employee_id,kind,starts_on,ends_on,reason,status,deductions) values($1,'annual',$2,$2,'Cuti tahun lampau','approved',$3) returning *",[cashierId,`${clock.year-1}-12-20`,JSON.stringify({[clock.year-1]:2})]));
await db.query("insert into public.leave_ledger(employee_id,year,leave_request_id,event_key,amount,actor_employee_id) values($1,$2,$3,$4,-2,$5)",[cashierId,clock.year-1,historic.id,`historical:${historic.id}`,adminId]);
await asUser(adminAuth);
await workflowError('select public.leave_correct($1,$2,$2,$3,$4)',[historic.id,historic.starts_on,JSON.stringify({[clock.year-1]:3}),'Penambahan potongan tahun hangus'],'sudah hangus');
const nextYearBalanceBefore=(await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year+1])).balance.remaining;
const historicCancelled=(await scalar('select to_jsonb(public.leave_correct($1,$2,$2,$3,$4,true)) as row',[historic.id,`${clock.year+1}-01-09`,JSON.stringify({[clock.year+1]:12}),'Pembatalan cuti lampau oleh HR'])).row;
assert.equal(historicCancelled.status,'cancelled');
assert.equal(historicCancelled.starts_on,`${clock.year-1}-12-20`,'cancel ignores proposed new dates');
assert.deepEqual(historicCancelled.deductions,{});
assert.equal((await scalar('select sum(amount)::text as amount from public.leave_ledger where leave_request_id=$1 and year=$2',[historic.id,clock.year-1])).amount,'0.00');
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year-1])).balance.expired,true);
assert.equal((await scalar('select public.leave_balance($1,$2) as balance',[cashierId,clock.year+1])).balance.remaining,nextYearBalanceBefore,'historic refund does not add future entitlement');
await workflowError("select public.leave_correct($1,null,null,'{}','Pembatalan ulang',true)",[historic.id],'disetujui');
assert.equal((await scalar('select count(*)::int as count from public.leave_ledger where leave_request_id=$1',[historic.id])).count,2,'cancel refunds exactly once and preserves charge history');
console.log('HR leave correction OK: HRonly,noown,approvedonly,pendingadjustmentguard,datedelta,pastyearrefund,expiredchargeguard,no repeatedrefund,externalsource,audit');
await db.exec('rollback');

await db.exec('begin');
await asUser(cashierAuth);
const notificationDate=`${clock.year+3}-02-01`;
const notifiedRequest=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Pemeriksaan kotak masuk persisten')) as row",[notificationDate])).row;
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows.length,0,'applicant does not receive their own submission event');
await workflowError("insert into public.notifications(employee_id,entity_id,title,body,href) values($1,$2,'Palsu','Palsu',$3)",[cashierId,notifiedRequest.id,`/leave?request=${notifiedRequest.id}`],'permission denied');
await workflowError("update public.notifications set read_at=now()",[],'permission denied');
await asUser('', 'anon');
await workflowError('select * from public.notifications',[],'permission denied');
await workflowError('select public.notifications_mark_read()',[],'permission denied');
await asUser(bakerAuth);
const reviewerNotification=(await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows;
assert.equal(reviewerNotification.length,1);
assert.equal(reviewerNotification[0].employee_id,bakerId);
assert.equal(reviewerNotification[0].read_at,null);
assert.equal(reviewerNotification[0].href,`/leave?request=${notifiedRequest.id}`);
await db.query("select public.leave_decide($1,'approved','{}')",[notifiedRequest.id]);
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows.length,1,'recording a decision does not notify its own actor');
await asUser(cashierAuth);
const applicantNotification=(await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows;
assert.equal(applicantNotification.length,1);
assert.equal(applicantNotification[0].employee_id,cashierId);
assert.equal(applicantNotification[0].read_at,null);
assert.equal((await scalar('select read_at from public.notifications where id=$1',[applicantNotification[0].id])).read_at,null,'a separate read preserves persisted unread state');
assert.equal((await db.query('select * from public.notifications where id=$1',[reviewerNotification[0].id])).rows.length,0,'recipient cannot read another recipient inbox row');
assert.equal((await scalar('select public.notifications_mark_read($1) as count',[reviewerNotification[0].id])).count,0,'recipient cannot mark another recipient row');
assert.equal((await scalar('select public.notifications_mark_read($1) as count',[applicantNotification[0].id])).count,1);
assert.equal((await scalar('select public.notifications_mark_read($1) as count',[applicantNotification[0].id])).count,0,'mark-one is idempotent');
const unreadCount=(await scalar('select count(*)::int as count from public.notifications where read_at is null')).count;
assert.equal((await scalar('select public.notifications_mark_read() as count')).count,unreadCount);
assert.equal((await scalar('select count(*)::int as count from public.notifications where read_at is null')).count,0);
const notificationAdjustment=(await scalar('select public.leave_request_change($1,$2,$2,$3) as change',[notifiedRequest.id,`${clock.year+3}-02-02`,'Perubahan untuk pemberitahuan keputusan'])).change;
await asUser(bakerAuth);
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows.length,2,'adjustment submission notifies reviewer once');
assert.equal((await scalar('select read_at from public.notifications where id=$1',[reviewerNotification[0].id])).read_at,null,'mark-all never affects another employee');
await db.query("select public.leave_decide_adjustment($1,true,'{}')",[notificationAdjustment.adjustment.id]);
await asUser(cashierAuth);
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows.length,2,'adjustment approval creates exactly one applicant notification');
assert.equal((await scalar('select count(*)::int as count from public.notifications where entity_id=$1 and read_at is null',[notifiedRequest.id])).count,1);
await asUser(adminAuth);
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows.length,0,'HR has no general access to other employee inboxes');
await db.exec('reset role');
await db.query('update public.employees set approver_employee_id=$1 where id=$2',[adminId,cashierId]);
await asUser(cashierAuth);
const reAssignedRequest=(await scalar("select to_jsonb(public.leave_submit('personal',$1,$1,'Pengajuan dengan pemeriksa baru')) as row",[`${clock.year+3}-02-03`])).row;
await asUser(adminAuth);
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[reAssignedRequest.id])).rows.length,1,'new event resolves current reviewer');
await asUser(bakerAuth);
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[reAssignedRequest.id])).rows.length,0,'previous reviewer receives no new event');
assert.equal((await db.query('select * from public.notifications where entity_id=$1',[notifiedRequest.id])).rows.length,2,'reassignment preserves durable historic inbox rows');
await db.exec('rollback');
console.log('Notifications OK: durableunread,ownRLS,anonymousdenied,noforgery,decision/adjustmentonce,currentreviewer,markone/allownership,idempotency');

// Operational workflows use isolated fictional employees and rollback all data.
await db.exec('begin');
await db.exec('reset role');
const operationalAuth='10000000-0000-0000-0000-000000000088',operationalId='20000000-0000-0000-0000-000000000088';
for(const signature of [
  'public.cashier_assignment_save(uuid,date,uuid,text,text,uuid,boolean)',
  'public.staffing_requirement_save(uuid,integer,text,integer,date)',
  'public.cashier_roster_batch_save(date,uuid,jsonb)',
  'public.spv_followup_start(text,date,uuid,uuid,text,text,uuid)',
  'public.spv_followup_update(uuid,text,uuid,text,text)',
  'public.spv_followup_update_v2(uuid,bigint,uuid,text,uuid,text,text,timestamp with time zone,text)',
  'public.spv_followup_page(text,uuid,date,date,integer,jsonb)',
  'public.attendance_correction_submit(uuid,date,timestamptz,timestamptz,text,text)',
  'public.attendance_correction_decide(uuid,boolean,text)','public.attendance_correction_cancel(uuid)',
  'public.leave_record_retrospective(uuid,text,date,date,text,text,time,time,jsonb,text,text)',
  'public.leave_correct_hours(uuid,date,date,jsonb,text,boolean,text,time,time)'
]) {
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['authenticated',signature,'EXECUTE'])).allowed,true);
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['anon',signature,'EXECUTE'])).allowed,false);
  assert.ok((await scalar('select proconfig from pg_proc where oid=$1::regprocedure',[signature])).proconfig.includes('search_path=""'));
}
await db.query("insert into auth.users(id,email) values($1,'rk000088@login.rajaklana.internal')",[operationalAuth]);
await db.query(`insert into public.employees(id,auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,approver_employee_id,can_clock)
  values($1,$2,'Kasir Operasional Fiktif','081234567888',$3,$4,$5,$6,'active',$7,true)`,[operationalId,operationalAuth,position.department_id,position.id,outlet.id,`${clock.year-1}-01-01`,adminId]);
await db.query("insert into public.employee_roles values($1,'employee')",[operationalId]);
const alternateOutlet=await scalar("insert into public.outlets(name,latitude,longitude,radius_m) values('Outlet Penugasan Fiktif',-6.25,106.85,100) returning id");
await asUser(operationalAuth);
const rosterSelfie=`${operationalAuth}/roster-selfie.jpg`;
await workflowError("select public.leave_record_retrospective($1,'sick',$2,$2,'Permintaan tidak berhak','full_day',null,null,'{}','Konfirmasi tidak berhak')",[cashierId,yesterday],'Admin HR');
await db.query("insert into storage.objects(bucket_id,name) values('attendance-selfies',$1)",[rosterSelfie]);
await workflowError("select core_contract_tests.clock_in('morning',-6.2,106.8,10,$1)",[rosterSelfie],'Penugasan hari ini');
await workflowError("select public.cashier_assignment_save($1,$2,$3,'morning','Akun kasir tidak berhak')",[operationalId,clock.today,outlet.id],'Admin HR');
await asUser(adminAuth);
await workflowError("select public.cashier_assignment_save($1,$2,$3,'morning','Mengatur penugasan sendiri')",[adminId,clock.today,outlet.id],'sendiri');
const offAssignment=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'off','Libur sesuai konfirmasi HR')) as row",[operationalId,clock.today,outlet.id])).row;
await workflowError("select public.cashier_assignment_save($1,$2,$3,'middle','Middle belum diizinkan')",[operationalId,clock.today,outlet.id],'Middle');
await asUser(operationalAuth);
await workflowError("select core_contract_tests.clock_in('morning',-6.2,106.8,10,$1)",[rosterSelfie],'dijadwalkan libur');
assert.equal((await db.query('select * from public.cashier_assignments where id=$1',[offAssignment.id])).rows.length,1);
await workflowError("update public.cashier_assignments set shift='morning'",[],'permission denied');
await asUser(bakerAuth);
assert.equal((await db.query('select * from public.cashier_assignments where id=$1',[offAssignment.id])).rows.length,0,'ordinary assigned approver has no HR roster access');
await asUser(adminAuth);
const roster=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Bantuan outlet untuk hari ini',$4)) as row",[operationalId,clock.today,alternateOutlet.id,offAssignment.id])).row;
assert.equal(roster.id,offAssignment.id,'one employee/date row is updated rather than duplicated');
await asUser(operationalAuth);
await workflowError("select core_contract_tests.clock_in('afternoon',-6.25,106.85,10,$1)",[rosterSelfie],'Shift tidak sesuai');
await workflowError("select core_contract_tests.clock_in('morning',-6.2,106.8,10,$1)",[rosterSelfie],'di luar radius');
const rosterAttendance=(await scalar("select to_jsonb(core_contract_tests.clock_in('morning',-6.25,106.85,10,$1)) as row",[rosterSelfie])).row;
assert.equal(rosterAttendance.outlet_id,alternateOutlet.id,'assigned outlet overrides employee home');
assert.equal(rosterAttendance.assignment_id,roster.id,'clock-in preserves the exact roster reference');
await asUser(adminAuth);
await workflowError("select public.cashier_assignment_save($1,$2,$3,'afternoon','Perubahan setelah clock in',$4)",[operationalId,clock.today,outlet.id,roster.id],'setelah absensi');
await db.exec('reset role');
await db.query("update public.cashier_assignments set status='cancelled' where id=$1",[roster.id]);
await asUser(operationalAuth);
await db.query('select core_contract_tests.clock_out($1,$2,10)',[-6.25,106.85]);
assert.ok((await scalar('select clock_out from public.attendance where id=$1',[rosterAttendance.id])).clock_out,'legacy open attendance can close without active roster');

// Missing attendance: own request, duplicate prevention, HR approval atomically
// creates a manual entry at the originally resolved dated assignment outlet.
const priorDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-4)::text as day")).day;
const priorDay2=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-5)::text as day")).day;
await asUser(adminAuth);
await db.query("select public.cashier_assignment_save($1,$2,$3,'morning','Penugasan historis untuk verifikasi')",[operationalId,priorDay,alternateOutlet.id]);
await asUser(operationalAuth);
const correction=(await scalar('select to_jsonb(public.attendance_correction_submit(null,$1,$2,$3,$4,$5)) as row',[priorDay,`${priorDay}T07:10:00+07:00`,`${priorDay}T15:10:00+07:00`,'morning','Kamera gagal, waktu dikonfirmasi SPV'])).row;
assert.equal(correction.outlet_id,alternateOutlet.id);
assert.equal(correction.original_snapshot,null);
await workflowError('select public.attendance_correction_submit(null,$1,$2,$3,$4,$5)',[priorDay,`${priorDay}T07:10:00+07:00`,`${priorDay}T15:10:00+07:00`,'morning','Pengajuan ulang saat masih menunggu'],'masih ada'.replace('masih','Masih'));
await workflowError("select public.attendance_correction_decide($1,true,'Pemohon mencoba memutuskan')",[correction.id],'Admin HR');
await asUser(bakerAuth);
assert.equal((await db.query('select * from public.attendance_correction_requests where id=$1',[correction.id])).rows.length,0);
await asUser(adminAuth);
const applied=(await scalar("select to_jsonb(public.attendance_correction_decide($1,true,'Dikonfirmasi HR melalui SPV outlet')) as row",[correction.id])).row;
assert.equal(applied.status,'approved');
const appliedAttendance=await scalar('select outlet_id,source,corrected from public.attendance where id=$1',[applied.attendance_id]);
assert.deepEqual(appliedAttendance,{outlet_id:alternateOutlet.id,source:'manual',corrected:true});
assert.equal((await scalar('select a.assignment_id=s.id as linked from public.attendance a join public.cashier_assignments s on s.employee_id=a.employee_id and s.work_date=a.work_date where a.id=$1',[applied.attendance_id])).linked,true,'manual correction links its historical roster');
await workflowError("select public.attendance_correction_decide($1,true,'Keputusan yang sama diulang')",[correction.id],'sudah diproses');
await asUser(operationalAuth);
const updatedRequest=(await scalar('select to_jsonb(public.attendance_correction_submit($1,$2,$3,$4,$5,$6)) as row',[applied.attendance_id,priorDay,`${priorDay}T07:15:00+07:00`,`${priorDay}T15:15:00+07:00`,'morning','Usulan pembaruan jam hasil konfirmasi'])).row;
assert.equal(updatedRequest.original_snapshot.outlet_id,alternateOutlet.id);
await asUser(adminAuth);
await db.query('select public.attendance_correct($1,$2,$3,$4)',[applied.attendance_id,`${priorDay}T07:20:00+07:00`,`${priorDay}T15:20:00+07:00`,'Koreksi HR lain sesudah permintaan']);
await workflowError("select public.attendance_correction_decide($1,true,'Usulan sudah tertinggal perubahan baru')",[updatedRequest.id],'berubah sejak');
assert.equal((await scalar('select status from public.attendance_correction_requests where id=$1',[updatedRequest.id])).status,'pending');
await db.query("select public.attendance_correction_decide($1,false,'Ditolak karena catatan sudah diperbarui')",[updatedRequest.id]);
await asUser(operationalAuth);
const moved=(await scalar('select to_jsonb(public.attendance_correction_submit(null,$1,$2,$3,$4,$5)) as row',[priorDay2,`${priorDay2}T07:10:00+07:00`,`${priorDay2}T15:10:00+07:00`,'morning','Catatan hilang sebelum outlet berubah'])).row;
await asUser(adminAuth);
await db.query("select public.cashier_assignment_save($1,$2,$3,'morning','Penugasan berubah sesudah permintaan')",[operationalId,priorDay2,alternateOutlet.id]);
await workflowError("select public.attendance_correction_decide($1,true,'Tidak boleh diam-diam berpindah outlet')",[moved.id],'Outlet penugasan berubah');
await asUser(operationalAuth);
await db.query('select public.attendance_correction_cancel($1)',[moved.id]);
await workflowError('select public.attendance_correction_cancel($1)',[moved.id],'sudah diproses');

await asUser(adminAuth);
await db.query("select public.cashier_assignment_save($1,$2,$3,'off','HR mengonfirmasi hari libur historis')",[operationalId,priorDay2,alternateOutlet.id]);
const manualOff=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',[operationalId,'morning',`${priorDay2}T07:10:00+07:00`,`${priorDay2}T15:10:00+07:00`,'HR mengonfirmasi kerja pengecualian hari off'])).row;
assert.equal(manualOff.outlet_id,alternateOutlet.id);
assert.ok(manualOff.assignment_id,'manual exception retains the off assignment as historical context');
const retrospective=(await scalar("select to_jsonb(public.leave_record_retrospective($1,'sick',$2,$2,$3,'late_arrival','09:00',null,$4,$5)) as row",[operationalId,priorDay2,'Sakit kemarin baru dapat dilaporkan',JSON.stringify({[clock.year]:1}),'Dikonfirmasi HR melalui atasan outlet'])).row;
assert.equal(retrospective.status,'approved');
assert.equal(retrospective.deductions[clock.year],1);
await workflowError("select public.leave_record_retrospective($1,'sick',$2,$2,'Duplikat alasan lain','late_arrival','09:00',null,'{}','Konfirmasi duplikat HR')",[operationalId,priorDay2],'sama');
await workflowError("select public.leave_record_retrospective($1,'annual',$2,$2,'Cuti tahunan susulan','full_day',null,null,'{}','Konfirmasi jenis tidak diizinkan')",[operationalId,priorDay2],'pribadi atau sakit');
await workflowError("select public.leave_record_retrospective($1,'sick',$2,$2,'Tanggal belum lampau','full_day',null,null,'{}','Konfirmasi tanggal belum lampau')",[operationalId,future],'tanggal lampau');
const hourCorrection=(await scalar("select to_jsonb(public.leave_correct_hours($1,$2,$2,$3,'HR membetulkan batas izin jam',false,null,'09:30',null)) as row",[retrospective.id,priorDay2,JSON.stringify({[clock.year]:0.5})])).row;
assert.equal(hourCorrection.starts_at,'09:30:00');
assert.equal(hourCorrection.extent,'late_arrival');
assert.equal((await scalar('select sum(amount)::text as amount from public.leave_ledger where leave_request_id=$1',[retrospective.id])).amount,'-0.50');
await db.query("select public.leave_correct_hours($1,null,null,'{}','Pembatalan mempertahankan jam lama',true,null,'23:00','01:00')",[retrospective.id]);
const cancelledHours=await scalar('select starts_at::text,status from public.leave_requests where id=$1',[retrospective.id]);
assert.deepEqual(cancelledHours,{starts_at:'09:30:00',status:'cancelled'});
assert.equal((await scalar('select sum(amount)::text as amount from public.leave_ledger where leave_request_id=$1',[retrospective.id])).amount,'0.00');
await workflowError("select public.leave_correct_hours($1,null,null,'{}','Tidak boleh refund kedua kali',true)",[retrospective.id],'disetujui');
await asUser(operationalAuth);
const operationalInbox=(await db.query("select entity_type,href,body from public.notifications where entity_type<>'leave'")).rows;
assert.ok(operationalInbox.some(n=>n.entity_type==='assignment' && n.href===`/assignments?date=${clock.today}`));
assert.ok(operationalInbox.some(n=>n.entity_type==='attendance_correction' && n.href===`/attendance?request=${correction.id}`));
assert.ok(operationalInbox.every(n=>!n.body.includes('Kamera gagal')),'notifications do not expose sensitive exception reasons');

// SPV staffing, a multi-day idempotent roster batch, and durable follow-up.
await asUser(adminAuth);
const nextWeek=await scalar(`select ((now() at time zone 'Asia/Jakarta')::date+(8-extract(isodow from now() at time zone 'Asia/Jakarta')::int))::text as monday`);
const batchDays=await scalar('select ($1::date)::text as first,($1::date+1)::text as second,($1::date+2)::text as third,($1::date+3)::text as fourth',[nextWeek.monday]);
const staffingWeekday=(await scalar("select extract(dow from $1::date)::int as weekday",[batchDays.first])).weekday;
const requirement0=(await scalar("select to_jsonb(public.staffing_requirement_save($1,$2,'morning',0,$3)) as row",[alternateOutlet.id,staffingWeekday,nextWeek.monday])).row;
assert.equal(requirement0.minimum,0,'zero is a saved no-staff-needed target, not an unset requirement');
const requirement2=(await scalar("select to_jsonb(public.staffing_requirement_save($1,$2,'morning',2,$3)) as row",[alternateOutlet.id,staffingWeekday,nextWeek.monday])).row;
assert.equal(requirement2.id,requirement0.id,'one effective date is updated rather than duplicated');
assert.equal(requirement2.minimum,2);
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='staffing_requirement' and entity_id=$1",[requirement0.id])).count,2);
assert.equal((await db.query('select id from public.staffing_requirements where id=$1',[requirement0.id])).rows.length,1,'Admin HR can read staffing history');

const batchKey='30000000-0000-0000-0000-000000000088';
const batchChanges=[batchDays.first,batchDays.second].map((work_date,index)=>({id:null,employee_id:operationalId,work_date,outlet_id:alternateOutlet.id,
  shift:index===0?'morning':'afternoon',reason:'Pembagian kebutuhan kasir minggu depan',expected_updated_at:null,cancel:false}));
const batchResult=(await scalar('select public.cashier_roster_batch_save($1,$2,$3::jsonb) as result',[nextWeek.monday,batchKey,JSON.stringify(batchChanges)])).result;
assert.equal(batchResult.saved_count,2,'both dates save in one batch');
assert.equal(batchResult.assignments.length,2);
assert.deepEqual((await scalar('select public.cashier_roster_batch_save($1,$2,$3::jsonb) as result',[nextWeek.monday,batchKey,JSON.stringify(batchChanges)])).result,batchResult,'retry returns the same committed result');
const mismatchedRetry=batchChanges.map(row=>({...row,reason:'Isi ulang batch berbeda'}));
await workflowError('select public.cashier_roster_batch_save($1,$2,$3::jsonb)',[nextWeek.monday,batchKey,JSON.stringify(mismatchedRetry)],'sudah dipakai');
const staleChange={...batchChanges[0],id:batchResult.assignments[0].id,expected_updated_at:'2000-01-01T00:00:00Z',shift:'afternoon'};
await workflowError('select public.cashier_roster_batch_save($1,$2,$3::jsonb)',[nextWeek.monday,'30000000-0000-0000-0000-000000000089',JSON.stringify([staleChange])],'berubah sejak pratinjau');
const badBatch=[
  {...batchChanges[0],work_date:batchDays.third,reason:'Baris valid yang harus ikut rollback'},
  {...batchChanges[1],work_date:batchDays.fourth,outlet_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',reason:'Baris kedua gagal validasi'}
];
await workflowError('select public.cashier_roster_batch_save($1,$2,$3::jsonb)',[nextWeek.monday,'30000000-0000-0000-0000-000000000090',JSON.stringify(badBatch)],'query returned no rows');
assert.equal((await scalar('select count(*)::int as count from public.cashier_assignments where employee_id=$1 and work_date in ($2::date,$3::date)',[operationalId,batchDays.third,batchDays.fourth])).count,0,'a failed row rolls back every schedule in its batch');

// A future approved full-day leave keeps a SPV case actionable while a weekly
// batch changes its source assignment from Pagi to Libur. Future cases cannot
// be created by the normal missing-clockin detector, so seed only that valid
// case state as a fixture; the schedule mutation itself uses the HR batch RPC.
const batchOffAssignment=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Jadwal awal sebelum koreksi Libur')) as row",
  [operationalId,batchDays.third,alternateOutlet.id])).row;
await db.exec('reset role'); // fixture-only approved leave; keep the Admin HR JWT for the SPV RPC below
const leaveConflictId=(await scalar(`insert into public.leave_requests(employee_id,kind,extent,starts_on,ends_on,reason,status,decision_by,decided_at)
  values($1,'personal','full_day',$2,$2,'Izin fixture untuk tindak lanjut jadwal','approved',$3,now()) returning id`,
  [operationalId,batchDays.third,adminId])).id;
await asUser(adminAuth);
const batchOffCase=(await scalar("select to_jsonb(public.spv_followup_start('leave_conflict',$1,$2,$3,'morning','assignment',$4)) as row",
  [batchDays.third,alternateOutlet.id,operationalId,batchOffAssignment.id])).row;
assert.equal((await scalar('select count(*)::int as count from public.leave_requests where id=$1',[leaveConflictId])).count,1);
const batchOffChange={id:batchOffAssignment.id,employee_id:operationalId,work_date:batchDays.third,outlet_id:alternateOutlet.id,
  shift:'off',reason:'Libur ditetapkan bersama batch mingguan',expected_updated_at:batchOffAssignment.updated_at,cancel:false};
const batchOffSave={id:null,employee_id:operationalId,work_date:batchDays.fourth,outlet_id:alternateOutlet.id,
  shift:'morning',reason:'Jadwal kedua untuk memastikan batch atomik',expected_updated_at:null,cancel:false};
const batchOffResult=(await scalar('select public.cashier_roster_batch_save($1,$2,$3::jsonb) as result',
  [nextWeek.monday,'30000000-0000-0000-0000-000000000091',JSON.stringify([batchOffChange,batchOffSave])])).result;
assert.equal(batchOffResult.saved_count,2,'batch can change an assignment with an active follow-up to Libur');
assert.equal((await scalar('select shift from public.cashier_assignments where id=$1',[batchOffAssignment.id])).shift,'off');
const batchOffSnapshot=(await scalar('select id,status,shift,owner_id,note,resolution_note from public.spv_followups where id=$1',[batchOffCase.id]));
assert.deepEqual(batchOffSnapshot,{id:batchOffCase.id,status:'new',shift:'off',owner_id:null,note:'',resolution_note:''},
  'the same active case follows Libur and remains actionable after an atomic batch');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='spv_followup' and entity_id=$1 and action='source_context_refreshed'",[batchOffCase.id])).count,1);

// Roster unassigned cases are keyed by employee/date, not outlet. They follow
// an inserted/changed/reinstated assignment while the employee home outlet is
// only the fallback after a cancellation.
const rosterCaseDate=await scalar(`select d::date::text as day from generate_series(
  (now() at time zone 'Asia/Jakarta')::date-20,(now() at time zone 'Asia/Jakarta')::date-11,interval '1 day') d
  where not exists(select 1 from unnest((select weekly_off_days from public.employees where id=$1)) off_day(value)
    where off_day.value=extract(dow from d::date)::int)
  and not exists(select 1 from public.cashier_assignments a where a.employee_id=$1 and a.work_date=d::date)
  and not exists(select 1 from public.attendance a where a.employee_id=$1 and a.work_date=d::date)
  and not exists(select 1 from public.leave_requests l where l.employee_id=$1 and l.status='approved' and l.starts_on<=d::date and l.ends_on>=d::date)
  order by d desc limit 1`,[operationalId]);
const rosterCase=(await scalar("select to_jsonb(public.spv_followup_start('unassigned',$1,$2,$3,null,'roster',null)) as row",
  [rosterCaseDate.day,outlet.id,operationalId])).row;
await updateFollowup(rosterCase.id,'in_progress',adminId,'Memeriksa outlet penugasan sementara','',null,'Tetapkan PIC pengujian');
const thirdOutlet=await scalar("insert into public.outlets(name,latitude,longitude,radius_m) values('Outlet Fallback Fixture',-6.3,106.9,100) returning id");
const rosterAssignment=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Penempatan pertama di outlet sementara')) as row",
  [operationalId,rosterCaseDate.day,alternateOutlet.id])).row;
let rosterContext=(await scalar('select id,outlet_id,status,owner_id,note from public.spv_followups where id=$1',[rosterCase.id]));
assert.deepEqual(rosterContext,{id:rosterCase.id,outlet_id:alternateOutlet.id,status:'in_progress',owner_id:adminId,note:'Memeriksa outlet penugasan sementara'},
  'first assignment moves the existing roster case to outlet B and preserves its history');
await db.exec('reset role'); // keep the authenticated Admin HR identity for the source trigger
await db.query('update public.employees set outlet_id=$1 where id=$2',[thirdOutlet.id,operationalId]);
rosterContext=(await scalar('select outlet_id from public.spv_followups where id=$1',[rosterCase.id])).outlet_id;
assert.equal(rosterContext,alternateOutlet.id,'changing the home outlet does not override an active outlet B assignment');
await asUser(adminAuth);
await scalar("select public.cashier_assignment_save($1,$2,$3,'morning','Penugasan dipindah dari B ke C',$4,false)",
  [operationalId,rosterCaseDate.day,thirdOutlet.id,rosterAssignment.id]);
assert.equal((await scalar('select outlet_id from public.spv_followups where id=$1',[rosterCase.id])).outlet_id,thirdOutlet.id,
  'an assignment update moves the same roster case to outlet C');
await scalar("select public.cashier_assignment_save($1,$2,$3,'morning','Penugasan kembali ke outlet B',$4,false)",
  [operationalId,rosterCaseDate.day,alternateOutlet.id,rosterAssignment.id]);
await scalar("select public.cashier_assignment_save($1,$2,$3,'morning','Batalkan penugasan sementara',$4,true)",
  [operationalId,rosterCaseDate.day,thirdOutlet.id,rosterAssignment.id]);
assert.equal((await scalar('select outlet_id from public.spv_followups where id=$1',[rosterCase.id])).outlet_id,thirdOutlet.id,
  'cancelling an assignment falls back to the employee home outlet');
await scalar("select public.cashier_assignment_save($1,$2,$3,'morning','Aktifkan kembali penugasan di outlet B',$4,false)",
  [operationalId,rosterCaseDate.day,alternateOutlet.id,rosterAssignment.id]);
rosterContext=(await scalar('select id,outlet_id,status,owner_id,note from public.spv_followups where id=$1',[rosterCase.id]));
assert.deepEqual(rosterContext,{id:rosterCase.id,outlet_id:alternateOutlet.id,status:'in_progress',owner_id:adminId,note:'Memeriksa outlet penugasan sementara'},
  'reactivation restores outlet B on the same case without losing owner or notes');

const followDate=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-2)::text as day")).day;
const followAssignment=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Penugasan historis untuk tindak lanjut SPV')) as row",[operationalId,followDate,alternateOutlet.id])).row;
const followArgs=['missing_clockin',followDate,alternateOutlet.id,operationalId,'morning','assignment',followAssignment.id];
const follow=(await scalar('select to_jsonb(public.spv_followup_start($1,$2,$3,$4,$5,$6,$7)) as row',followArgs)).row;
assert.equal(follow.status,'new');
assert.equal((await scalar('select to_jsonb(public.spv_followup_start($1,$2,$3,$4,$5,$6,$7)) as row',followArgs)).row.id,follow.id,'refresh/retry reuses one case');
const inProgress=await updateFollowup(follow.id,'in_progress',adminId,'Menghubungi kasir untuk konfirmasi','',null,'Tetapkan PIC pengujian');
assert.equal(inProgress.owner_id,adminId);
const followupDue=`${followDate}T23:59:00+07:00`, followupRevision=inProgress.revision;
const receiptKey='40000000-0000-4000-8000-000000009901';
const dueMutationArgs=[follow.id,followupRevision,receiptKey,'in_progress',adminId,'Menghubungi kasir untuk konfirmasi','',followupDue,'Tetapkan tenggat pengujian'];
const dueMutation=(await scalar('select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as row',dueMutationArgs)).row;
assert.equal(dueMutation.revision,followupRevision+1,'successful mutation advances the monotonic server revision');
assert.deepEqual((await scalar('select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as row',dueMutationArgs)).row,dueMutation,
  'same actor/key/payload replays the original receipt without duplicate audit');
await workflowError('select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [follow.id,followupRevision,receiptKey,'in_progress',adminId,'Payload berbeda','',followupDue,'Tetapkan tenggat pengujian'],'sudah dipakai');
await workflowError('select public.spv_followup_update_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [follow.id,followupRevision,'40000000-0000-4000-8000-000000009902','in_progress',adminId,'Tulisan SPV kedua','',followupDue,'Perubahan dari SPV kedua'],'berubah sejak dibuka');
await db.exec('reset role');
assert.equal((await scalar('select count(*)::int as count from private.spv_followup_receipts where idempotency_key=$1',['40000000-0000-4000-8000-000000009902'])).count,0,
  'stale transaction rolls its provisional receipt back');
await asUser(adminAuth);
const firstPage=(await scalar("select public.spv_followup_page('all_open',null,null,null,1,null) as page")).page;
assert.equal(firstPage.items.length,1); assert.equal(firstPage.has_more,true); assert.ok(firstPage.total>=2);
const secondPage=(await scalar("select public.spv_followup_page('all_open',null,null,null,1,$1::jsonb) as page",[JSON.stringify(firstPage.next_cursor)])).page;
assert.notEqual(secondPage.items[0].id,firstPage.items[0].id,'keyset pagination does not duplicate the previous row');
const minePage=(await scalar("select public.spv_followup_page('mine',null,null,null,25,null) as page")).page;
assert.ok(minePage.items.some(row=>row.id===follow.id),'yesterday case remains visible in My Tasks without selecting its work date');
await db.exec('reset role');
assert.equal((await scalar('select private.dispatch_spv_followup_due(100) as count')).count,1);
assert.equal((await scalar('select private.dispatch_spv_followup_due(100) as count')).count,0,'overdue dispatcher is idempotent per revision and recipient');
await asUser(adminAuth);
assert.equal((await scalar("select count(*)::int as count from public.notifications where entity_type='spv_followup' and entity_id=$1",[follow.id])).count,1);
const movedSource=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'afternoon','Rotasi outlet dan shift selama tindak lanjut',$4,false)) as row",
  [operationalId,followDate,alternateOutlet.id,followAssignment.id])).row;
const refreshedFollow=(await scalar('select to_jsonb(f) as row from public.spv_followups f where id=$1',[follow.id])).row;
assert.equal(refreshedFollow.shift,'afternoon','an active case follows its changed source shift in the same transaction');
assert.equal(refreshedFollow.outlet_id,alternateOutlet.id,'an active case follows its changed source outlet');
assert.equal(refreshedFollow.owner_id,adminId,'source refresh preserves the selected owner');
assert.equal(refreshedFollow.note,'Menghubungi kasir untuk konfirmasi','source refresh preserves follow-up notes');
assert.ok(refreshedFollow.revision>dueMutation.revision,'source context mutation also advances the follow-up revision');
assert.ok((await scalar("select count(*)::int as count from public.audit_events where entity='spv_followup' and entity_id=$1 and action='source_context_refreshed'",[follow.id])).count===1,
  'source move records before/after follow-up audit evidence');
const offFollowAssignment=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'off','HR menetapkan Libur saat kasus masih diproses',$4,false)) as row",
  [operationalId,followDate,alternateOutlet.id,followAssignment.id])).row;
const offFollow=(await scalar('select status,shift,owner_id,note,resolution_note from public.spv_followups where id=$1',[follow.id]));
assert.deepEqual(offFollow,{status:'in_progress',shift:'off',owner_id:adminId,note:'Menghubungi kasir untuk konfirmasi',resolution_note:''},
  'single assignment can change to Libur while a case is in progress, preserving its owner and notes');
assert.equal(offFollowAssignment.shift,'off');
await scalar("select public.cashier_assignment_save($1,$2,$3,'afternoon','Pulihkan sumber aktif sebelum penyelesaian',$4,false)",
  [operationalId,followDate,alternateOutlet.id,followAssignment.id]);
const completed=await updateFollowup(follow.id,'completed',adminId,'Kasir memberi penjelasan','Konfirmasi langsung selesai dan dicatat');
assert.equal(completed.status,'completed');
await scalar("select public.cashier_assignment_save($1,$2,$3,'morning','Sumber bergerak setelah kasus selesai',$4,false)",[operationalId,followDate,outlet.id,followAssignment.id]);
const completedSnapshot=(await scalar('select to_jsonb(f) as row from public.spv_followups f where id=$1',[follow.id])).row;
assert.equal(completedSnapshot.outlet_id,alternateOutlet.id,'a completed case preserves its historical outlet while the source moves again');
assert.equal(completedSnapshot.shift,'afternoon','a completed case preserves its historical shift until an explicit reopen');
const reopenArgs=['missing_clockin',followDate,outlet.id,operationalId,'morning','assignment',followAssignment.id];
const reopened=(await scalar('select to_jsonb(public.spv_followup_start($1,$2,$3,$4,$5,$6,$7)) as row',reopenArgs)).row;
assert.equal(reopened.status,'new');
assert.equal(reopened.reopened_count,1,'a recurring source reopens the same audited case');
assert.equal(reopened.outlet_id,outlet.id,'reopening uses the source current outlet');
assert.equal(reopened.shift,'morning','reopening uses the source current shift');
assert.equal((await scalar('select to_jsonb(public.spv_followup_start($1,$2,$3,$4,$5,$6,$7)) as row',reopenArgs)).row.reopened_count,1,
  'retrying the same open case does not count a second reopen');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='spv_followup' and entity_id=$1",[follow.id])).count,8);

const shortDate=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-7)::text as day")).day;
const shortAttendance=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',
  [operationalId,'afternoon',`${shortDate}T15:00:00+07:00`,`${shortDate}T22:00:00+07:00`,'Absensi 7 jam untuk uji izin pulang awal'])).row;
assert.equal(shortAttendance.worked_minutes,420);
await db.query("select public.leave_record_retrospective($1,'personal',$2,$2,'Izin pulang awal','early_departure','22:00',null,'{}','Dikonfirmasi atasan outlet')",
  [operationalId,shortDate]);
await workflowError("select public.spv_followup_start('short_duration',$1,$2,$3,$4,'attendance',$5)",
  [shortDate,shortAttendance.outlet_id,operationalId,'afternoon',shortAttendance.id],'Selisih durasi sudah dijelaskan');
assert.equal((await scalar("select count(*)::int as count from public.spv_followups where source_id=$1",[shortAttendance.id])).count,0,
  'an approved permit explaining the full shortfall does not create a stale case');

const residualDate=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-8)::text as day")).day;
const residualAttendance=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',
  [operationalId,'afternoon',`${residualDate}T15:00:00+07:00`,`${residualDate}T21:30:00+07:00`,'Absensi 6,5 jam untuk uji sisa izin'])).row;
await db.query("select public.leave_record_retrospective($1,'personal',$2,$2,'Izin pulang awal sebagian','early_departure','22:00',null,'{}','Dikonfirmasi atasan outlet')",
  [operationalId,residualDate]);
const residualCase=(await scalar("select to_jsonb(public.spv_followup_start('short_duration',$1,$2,$3,$4,'attendance',$5)) as row",
  [residualDate,residualAttendance.outlet_id,operationalId,'afternoon',residualAttendance.id])).row;
assert.equal(residualCase.issue_type,'short_duration','a partially explained shortfall still needs review');

const unexplainedDate=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-9)::text as day")).day;
const unexplainedAttendance=(await scalar('select to_jsonb(public.attendance_record_manual($1,$2,$3,$4,$5)) as row',
  [operationalId,'afternoon',`${unexplainedDate}T15:00:00+07:00`,`${unexplainedDate}T22:00:00+07:00`,'Absensi tanpa izin untuk uji durasi'])).row;
const unexplainedCase=(await scalar("select to_jsonb(public.spv_followup_start('short_duration',$1,$2,$3,$4,'attendance',$5)) as row",
  [unexplainedDate,unexplainedAttendance.outlet_id,operationalId,'afternoon',unexplainedAttendance.id])).row;
assert.equal(unexplainedCase.issue_type,'short_duration','an unexplained shortfall remains eligible for follow-up');
const leaveOnlyDate=await scalar(`select d::date::text as day from generate_series(
  (now() at time zone 'Asia/Jakarta')::date-10,(now() at time zone 'Asia/Jakarta')::date-1,interval '1 day') d
  where not exists(select 1 from unnest((select weekly_off_days from public.employees where id=$1)) off_day(value)
    where off_day.value=extract(dow from d::date)::int)
  and not exists(select 1 from public.cashier_assignments a where a.employee_id=$1 and a.work_date=d::date)
  and not exists(select 1 from public.attendance a where a.employee_id=$1 and a.work_date=d::date)
  and not exists(select 1 from public.leave_requests l where l.employee_id=$1 and l.status='approved' and l.starts_on<=d::date and l.ends_on>=d::date)
  order by d desc limit 1`,[operationalId]);
await scalar("select public.leave_record_retrospective($1,'personal',$2,$2,'Izin pribadi susulan untuk tes','full_day',null,null,'{}','Dikonfirmasi atasan outlet') as row",[operationalId,leaveOnlyDate.day]);
await workflowError("select public.spv_followup_start('unassigned',$1,$2,$3,null,'roster',null)",[leaveOnlyDate.day,outlet.id,operationalId],'Kasir tidak lagi memerlukan tindak lanjut');

await asUser(operationalAuth);
assert.equal((await db.query('select * from public.staffing_requirements')).rows.length,0,'cashier cannot read outlet staffing requirements');
assert.equal((await db.query('select * from public.spv_followups')).rows.length,0,'cashier cannot read follow-up cases');
const weeklyInbox=(await db.query("select entity_type,href from public.notifications where entity_type='assignment_week' and entity_id=$1",[batchResult.batch_id])).rows;
assert.equal(weeklyInbox.length,1,'multi-day roster save sends one privacy-safe weekly notification');
assert.equal(weeklyInbox[0].href,`/assignments?week=${nextWeek.monday}`);
await workflowError('update public.staffing_requirements set minimum=99',[],'permission denied');
await workflowError('select * from public.cashier_roster_batches',[],'permission denied');
await asUser('', 'anon');
await workflowError('select * from public.cashier_assignments',[],'permission denied');
await workflowError('select * from public.attendance_correction_requests',[],'permission denied');
await workflowError('select * from public.staffing_requirements',[],'permission denied');
await workflowError('select * from public.spv_followups',[],'permission denied');
await db.exec('rollback');
console.log('Operational workflows OK: mandatoryroster/off/shift/tempoutlet,historicalclockout,HRassignmentguard,ownrequests,RLS,atomicmanual,stalesnapshot/outletguard,retroactiveleave,hourcorrection,yearrefund,workflowinbox,staffinghistory,atomicweeklybatch,idempotency,followupownership,reopen');

// Supervisor operations stay in a separate rollback fixture. It exercises
// dynamic capability scope, immutable operational history, version conflicts,
// idempotent replay, handover recipient controls, and the roster transaction
// behind a peer-approved shift exchange.
await db.exec('begin');
for (const signature of [
  'public.supervisor_capability_save(uuid,text,uuid,uuid,boolean)',
  'public.supervisor_issue_category_save(uuid,text,text,boolean)',
  'public.supervisor_issue_category_page(boolean)',
  'public.supervisor_operation_configuration_page()',
  'public.supervisor_issue_route_save(uuid,uuid,uuid,uuid,boolean)',
  'public.supervisor_issue_category_save_v2(uuid,bigint,uuid,text,text,boolean)',
  'public.supervisor_issue_route_save_v2(uuid,bigint,uuid,uuid,uuid,uuid,boolean)',
  'public.supervisor_capability_save_v2(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean)',
  'public.outlet_issue_submit(uuid,uuid,text,text,text,uuid,uuid)',
  'public.outlet_issue_update_v2(uuid,bigint,uuid,text,uuid,timestamptz,text,text)',
  'public.outlet_issue_page(uuid,uuid,text,integer,jsonb)',
  'public.shift_handover_save_v2(uuid,bigint,uuid,uuid,date,uuid,uuid,uuid,text,text,text,boolean,text)',
  'public.shift_handover_respond_v2(uuid,bigint,uuid,boolean,text)',
  'public.shift_handover_page(uuid,date,date,integer,jsonb)',
  'public.shift_exchange_submit(text,uuid,uuid,text,uuid)',
  'public.shift_exchange_respond_v2(uuid,bigint,uuid,boolean,text)',
  'public.shift_exchange_decide_v2(uuid,bigint,uuid,boolean,text)',
  'public.shift_exchange_page(text,integer,jsonb)'
]) {
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['authenticated',signature,'EXECUTE'])).allowed,true,`${signature} is callable only through secured RPC`);
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['anon',signature,'EXECUTE'])).allowed,false,`${signature} rejects anon`);
}
assert.equal((await scalar("select has_table_privilege('authenticated',c.oid,'select') as allowed from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='supervisor_configuration_receipts'")).allowed,false,
  'configuration idempotency receipts stay private from authenticated clients');
assert.equal((await scalar("select c.relrowsecurity as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='supervisor_configuration_receipts'")).enabled,true,
  'configuration idempotency receipts retain RLS even if a future grant is added');
await asUser('', 'anon');
await workflowError("select public.supervisor_issue_category_save_v2(null,null,$1,'anon_konfigurasi','Konfigurasi anonim',true)",['70000000-0000-4000-8000-000000000091'],'permission denied');
await asUser(bakerAuth);
await workflowError("select public.supervisor_issue_category_save_v2(null,null,$1,'nonhr_konfigurasi','Konfigurasi bukan HR',true)",['70000000-0000-4000-8000-000000000092'],'Admin HR');
await workflowError('select public.supervisor_issue_route_save_v2(null,null,$1,null,null,null,true)',['70000000-0000-4000-8000-000000000093'],'Admin HR');
await workflowError("select public.supervisor_capability_save_v2(null,null,$1,null,'issue_view',null,null,true)",['70000000-0000-4000-8000-000000000094'],'Admin HR');
await asUser(adminAuth);
const issueCategory=(await scalar("select to_jsonb(public.supervisor_issue_category_save(null,'sarana_uji','Sarana dan peralatan uji',true)) as row")).row;
await asUser(cashierAuth);
const reporterCategories=(await scalar('select public.supervisor_issue_category_page(false) as page')).page;
assert.equal(reporterCategories.items[0].id,issueCategory.id,'reporter receives the narrow active category catalogue through RPC');
await asUser(bakerAuth);
await workflowError('select public.supervisor_issue_category_page(true)',[],'Admin HR');
await workflowError('select public.supervisor_operation_configuration_page()',[],'Admin HR');
await asUser(adminAuth);
const initialConfiguration=(await scalar('select public.supervisor_operation_configuration_page() as page')).page;
assert.equal(initialConfiguration.categories[0].id,issueCategory.id,'Admin HR alone receives the route/capability configuration snapshot');
assert.equal(initialConfiguration.categories.find((row)=>row.id===issueCategory.id).revision,1,
  'configuration snapshot exposes category revisions for v2 baselines');
// An Admin HR caller must not lend their own unrestricted authority to a
// recipient selected in routing. Both compatibility and v2 saves validate the
// target employee's current scoped handling capability.
await workflowError('select public.supervisor_issue_route_save(null,$1,$2,$3,true)',[issueCategory.id,outlet.id,cashierId],
  'Penerima routing belum mempunyai kemampuan');
await workflowError('select public.supervisor_issue_route_save_v2(null,null,$1,$2,$3,$4,true)',
  ['70000000-0000-4000-8000-000000000099',issueCategory.id,outlet.id,cashierId], 'Penerima routing belum mempunyai kemampuan');
assert.equal((await scalar('select count(*)::int as count from public.supervisor_issue_routes where category_id=$1 and outlet_id=$2 and recipient_employee_id=$3',
  [issueCategory.id,outlet.id,cashierId])).count,0,'an Admin HR cannot route a new issue to an unrelated active cashier');
await scalar('select public.supervisor_capability_save($1,$2,$3,$4,true) as row',[bakerId,'issue_view',outlet.id,issueCategory.id]);
await scalar('select public.supervisor_capability_save($1,$2,$3,$4,true) as row',[bakerId,'issue_handle',outlet.id,issueCategory.id]);
const issueRoute=(await scalar('select to_jsonb(public.supervisor_issue_route_save(null,$1,$2,$3,true)) as row',[issueCategory.id,outlet.id,bakerId])).row;
assert.equal(issueRoute.recipient_employee_id,bakerId,'dynamic category route retains its explicitly configured recipient');
const configAdminOutlet=await scalar("insert into public.outlets(name,latitude,longitude,radius_m) values('Outlet penerima Admin konfigurasi',-6.31,106.91,100) returning id");
const adminRoute=(await scalar('select public.supervisor_issue_route_save_v2(null,null,$1,$2,$3,$4,true) as row',
  ['70000000-0000-4000-8000-000000000097',issueCategory.id,configAdminOutlet.id,adminId])).row;
assert.equal(adminRoute.recipient_employee_id,adminId,'an active Admin HR remains a valid route recipient without a redundant capability row');
await workflowError('select public.supervisor_issue_route_save_v2(null,null,$1,$2,null,$3,true)',
  ['70000000-0000-4000-8000-000000000098',issueCategory.id,bakerId], 'Penerima routing belum mempunyai kemampuan');
const configuredRows=(await scalar('select public.supervisor_operation_configuration_page() as page')).page;
assert.equal(configuredRows.routes.find((row)=>row.id===issueRoute.id).revision,1,
  'configuration snapshot exposes route revisions for v2 baselines');
assert.equal(configuredRows.capabilities.find((row)=>row.employee_id===bakerId && row.capability==='issue_view' && row.outlet_id===outlet.id && row.category_id===issueCategory.id).revision,1,
  'configuration snapshot exposes capability revisions for v2 baselines');
const invalidCategoryReceiptKey='70000000-0000-4000-8000-000000000100';
await workflowError("select public.supervisor_issue_category_save_v2(null,null,$1,'x','Tidak valid',true)",[invalidCategoryReceiptKey],'Kode atau nama kategori tidak valid');
const recoveredCategoryReceipt=(await scalar("select public.supervisor_issue_category_save_v2(null,null,$1,'konfigurasi_recovery','Receipt gagal dapat dicoba ulang',true) as row",[invalidCategoryReceiptKey])).row;
assert.equal(recoveredCategoryReceipt.revision,1,'a failed category mutation leaves no dangling receipt and can retry with the same key');
const v2CategoryKey='70000000-0000-4000-8000-000000000101';
const v2Category=(await scalar("select public.supervisor_issue_category_save_v2(null,null,$1,'konfigurasi_uji','Konfigurasi bersamaan uji',true) as row",[v2CategoryKey])).row;
assert.equal(v2Category.revision,1,'new configuration category begins with an explicit revision');
assert.deepEqual((await scalar("select public.supervisor_issue_category_save_v2(null,null,$1,'konfigurasi_uji','Konfigurasi bersamaan uji',true) as row",[v2CategoryKey])).row,v2Category,
  'category create replay returns the original row without a duplicate audit');
const v2CategoryAudits=(await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_category' and entity_id=$1",[v2Category.id])).count;
await workflowError("select public.supervisor_issue_category_save_v2(null,null,$1,'konfigurasi_uji','Konfigurasi duplikat bersamaan',true)",
  ['70000000-0000-4000-8000-000000000112'],'berubah sejak dibuka');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_category' and entity_id=$1",[v2Category.id])).count,v2CategoryAudits,
  'a duplicate category create is conflict-safe and leaves no partial audit');
await workflowError("select public.supervisor_issue_category_save_v2(null,null,$1,'konfigurasi_lain','Payload lain pada key yang sama',true)",[v2CategoryKey],'Kunci konfigurasi');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_category' and entity_id=$1",[v2Category.id])).count,v2CategoryAudits,
  'a category key/body mismatch leaves no partial audit');
const v2CategoryUpdateKey='70000000-0000-4000-8000-000000000102';
const v2CategoryUpdate=(await scalar("select public.supervisor_issue_category_save_v2($1,1,$2,'konfigurasi_uji','Konfigurasi bersamaan diperbarui',true) as row",
  [v2Category.id,v2CategoryUpdateKey])).row;
assert.equal(v2CategoryUpdate.revision,2,'category update advances the revision atomically');
const categoryBeforeStale=(await scalar('select to_jsonb(c) as row from public.supervisor_issue_categories c where c.id=$1',[v2Category.id])).row;
const v2CategoryAuditAfterUpdate=(await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_category' and entity_id=$1",[v2Category.id])).count;
await workflowError("select public.supervisor_issue_category_save_v2($1,1,$2,'konfigurasi_uji','Konflik kategori usang',true)",
  [v2Category.id,'70000000-0000-4000-8000-000000000103'],'berubah sejak dibuka');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_category' and entity_id=$1",[v2Category.id])).count,v2CategoryAuditAfterUpdate,
  'a stale category update leaves no partial audit');
assert.deepEqual((await scalar('select to_jsonb(c) as row from public.supervisor_issue_categories c where c.id=$1',[v2Category.id])).row,categoryBeforeStale,
  'a stale category update leaves the current row untouched');
await workflowError("select public.supervisor_issue_category_save_v2($1,1,$2,'konfigurasi_uji','Konflik kategori usang',true)",
  [v2Category.id,'70000000-0000-4000-8000-000000000103'],'berubah sejak dibuka');
const legacyCategory=(await scalar("select to_jsonb(public.supervisor_issue_category_save($1,'konfigurasi_uji','Diperbarui lewat kompatibilitas lama',true)) as row",[v2Category.id])).row;
assert.equal(legacyCategory.revision,3,'the legacy category RPC also advances the v2 baseline');
assert.deepEqual((await scalar("select public.supervisor_issue_category_save_v2($1,1,$2,'konfigurasi_uji','Konfigurasi bersamaan diperbarui',true) as row",
  [v2Category.id,v2CategoryUpdateKey])).row,v2CategoryUpdate,
  'category retry still returns its original receipt after a later legacy revision');
const routeV2Key='70000000-0000-4000-8000-000000000104';
const routeV2=(await scalar('select public.supervisor_issue_route_save_v2($1,$2,$3,$4,$5,$6,true) as row',
  [issueRoute.id,issueRoute.revision,routeV2Key,issueCategory.id,outlet.id,bakerId])).row;
assert.equal(routeV2.revision,2,'route update advances its own revision');
const routeBeforeStale=(await scalar('select to_jsonb(r) as row from public.supervisor_issue_routes r where r.id=$1',[issueRoute.id])).row;
const routeAuditsAfter=(await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_route' and entity_id=$1",[issueRoute.id])).count;
await workflowError('select public.supervisor_issue_route_save_v2(null,null,$1,$2,$3,$4,true)',
  ['70000000-0000-4000-8000-000000000113',issueCategory.id,outlet.id,bakerId],'berubah sejak dibuka');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_route' and entity_id=$1",[issueRoute.id])).count,routeAuditsAfter,
  'a duplicate route create is conflict-safe and leaves no partial audit');
await workflowError('select public.supervisor_issue_route_save_v2($1,$2,$3,$4,$5,$6,false)',
  [issueRoute.id,issueRoute.revision,'70000000-0000-4000-8000-000000000105',issueCategory.id,outlet.id,bakerId],'berubah sejak dibuka');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_route' and entity_id=$1",[issueRoute.id])).count,routeAuditsAfter,
  'a stale route update leaves no partial audit');
assert.deepEqual((await scalar('select to_jsonb(r) as row from public.supervisor_issue_routes r where r.id=$1',[issueRoute.id])).row,routeBeforeStale,
  'a stale route update leaves the current row untouched');
await workflowError('select public.supervisor_issue_route_save_v2($1,$2,$3,$4,$5,$6,false)',
  [issueRoute.id,issueRoute.revision,routeV2Key,issueCategory.id,outlet.id,bakerId],'Kunci konfigurasi');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_issue_route' and entity_id=$1",[issueRoute.id])).count,routeAuditsAfter,
  'a route replay key/body mismatch leaves no partial audit');
const legacyRoute=(await scalar('select to_jsonb(public.supervisor_issue_route_save($1,$2,$3,$4,true)) as row',
  [issueRoute.id,issueCategory.id,outlet.id,bakerId])).row;
assert.equal(legacyRoute.revision,3,'the legacy route RPC also advances the v2 baseline');
assert.deepEqual((await scalar('select public.supervisor_issue_route_save_v2($1,$2,$3,$4,$5,$6,true) as row',
  [issueRoute.id,issueRoute.revision,routeV2Key,issueCategory.id,outlet.id,bakerId])).row,routeV2,
  'route replay returns the original result after a later valid legacy change');
const capabilityV2Key='70000000-0000-4000-8000-000000000106';
const capabilityV2=(await scalar("select public.supervisor_capability_save_v2(null,null,$1,$2,'issue_configure',$3,$4,true) as row",
  [capabilityV2Key,bakerId,outlet.id,issueCategory.id])).row;
assert.equal(capabilityV2.granted,true);
const capabilityRow=capabilityV2.capability;
assert.equal(capabilityRow.revision,1,'a capability grant carries its baseline row');
assert.deepEqual((await scalar("select public.supervisor_capability_save_v2(null,null,$1,$2,'issue_configure',$3,$4,true) as row",
  [capabilityV2Key,bakerId,outlet.id,issueCategory.id])).row,capabilityV2,
  'capability grant replay returns the original receipt');
const capabilityAuditsAfterGrant=(await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count;
await workflowError("select public.supervisor_capability_save_v2(null,null,$1,$2,'issue_configure',$3,$4,true)",
  ['70000000-0000-4000-8000-000000000109',bakerId,outlet.id,issueCategory.id],'berubah sejak dibuka');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count,capabilityAuditsAfterGrant,
  'a duplicate capability grant is a retryable conflict with no partial audit');
await scalar('select public.supervisor_capability_save($1,$2,$3,$4,true) as row',[bakerId,'issue_configure',outlet.id,issueCategory.id]);
const capabilityCurrent=await scalar('select id,revision from public.supervisor_capabilities where id=$1',[capabilityRow.id]);
assert.equal(capabilityCurrent.revision,2,'legacy capability maintenance advances the v2 baseline');
assert.deepEqual((await scalar("select public.supervisor_capability_save_v2(null,null,$1,$2,'issue_configure',$3,$4,true) as row",
  [capabilityV2Key,bakerId,outlet.id,issueCategory.id])).row,capabilityV2,
  'capability grant replay returns the original result after a later valid legacy change');
const capabilityBeforeStale=(await scalar('select to_jsonb(c) as row from public.supervisor_capabilities c where c.id=$1',[capabilityRow.id])).row;
const capabilityAuditsBeforeStale=(await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count;
await workflowError("select public.supervisor_capability_save_v2($1,1,$2,$3,'issue_configure',$4,$5,false)",
  [capabilityRow.id,'70000000-0000-4000-8000-000000000107',bakerId,outlet.id,issueCategory.id],'berubah sejak dibuka');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count,capabilityAuditsBeforeStale,
  'a stale capability revoke leaves no partial audit');
assert.deepEqual((await scalar('select to_jsonb(c) as row from public.supervisor_capabilities c where c.id=$1',[capabilityRow.id])).row,capabilityBeforeStale,
  'a stale capability revoke leaves the current grant untouched');
const capabilityRevokeKey='70000000-0000-4000-8000-000000000108';
await workflowError("select public.supervisor_capability_save_v2(null,null,$1,$2,'issue_configure',$3,$4,false)",
  [capabilityRevokeKey,bakerId,outlet.id,issueCategory.id],'Pencabutan kemampuan wajib memakai ID dan revisi terakhir');
await workflowError("select public.supervisor_capability_save_v2($1,null,$2,$3,'issue_configure',$4,$5,false)",
  [capabilityRow.id,'70000000-0000-4000-8000-000000000110',bakerId,outlet.id,issueCategory.id],'Pencabutan kemampuan wajib memakai ID dan revisi terakhir');
await workflowError("select public.supervisor_capability_save_v2(null,$1,$2,$3,'issue_configure',$4,$5,false)",
  [capabilityCurrent.revision,'70000000-0000-4000-8000-000000000111',bakerId,outlet.id,issueCategory.id],'Pencabutan kemampuan wajib memakai ID dan revisi terakhir');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count,capabilityAuditsBeforeStale,
  'a revoke rejected for missing baseline leaves no partial audit');
const capabilityRevoked=(await scalar("select public.supervisor_capability_save_v2($1,$2,$3,$4,'issue_configure',$5,$6,false) as row",
  [capabilityRow.id,capabilityCurrent.revision,capabilityRevokeKey,bakerId,outlet.id,issueCategory.id])).row;
assert.equal(capabilityRevoked.granted,false);
const capabilityAuditsAfterRevoke=(await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count;
await workflowError("select public.supervisor_capability_save_v2($1,$2,$3,$4,'issue_view',$5,$6,false)",
  [capabilityRow.id,capabilityCurrent.revision,capabilityRevokeKey,bakerId,outlet.id,issueCategory.id],'Kunci konfigurasi');
assert.equal((await scalar("select count(*)::int as count from public.audit_events where entity='supervisor_capability' and entity_id=$1",[capabilityRow.id])).count,capabilityAuditsAfterRevoke,
  'a capability replay key/body mismatch leaves no partial audit');
assert.deepEqual((await scalar("select public.supervisor_capability_save_v2($1,$2,$3,$4,'issue_configure',$5,$6,false) as row",
  [capabilityRow.id,capabilityCurrent.revision,capabilityRevokeKey,bakerId,outlet.id,issueCategory.id])).row,capabilityRevoked,
  'capability revoke replay survives the deleted grant row');
assert.equal((await scalar('select count(*)::int as count from public.supervisor_capabilities where id=$1',[capabilityRow.id])).count,0,
  'the terminal capability revoke removes only its configured grant');
await asUser(cashierAuth);
const issueKey='71000000-0000-4000-8000-000000000001';
const submittedIssue=(await scalar("select public.outlet_issue_submit($1,$2,'Mesin kasir menunjukkan pesan error','high',null,null,$3) as row",[outlet.id,issueCategory.id,issueKey])).row;
assert.equal(submittedIssue.status,'assigned');
assert.equal(submittedIssue.owner_id,bakerId,'assigned issue uses the configured scoped recipient snapshot');
assert.deepEqual((await scalar("select public.outlet_issue_submit($1,$2,'Mesin kasir menunjukkan pesan error','high',null,null,$3) as row",[outlet.id,issueCategory.id,issueKey])).row,submittedIssue,
  'issue submit exact replay returns its original result');
const cashierIssuePage=(await scalar("select public.outlet_issue_page(null,null,'open',25,null) as page")).page;
assert.equal(cashierIssuePage.items.length,1,'reporter receives only their own issue through the scoped page');
await asUser(bakerAuth);
const bakerIssuePage=(await scalar("select public.outlet_issue_page($1,$2,'open',25,null) as page",[outlet.id,issueCategory.id])).page;
assert.equal(bakerIssuePage.items[0].id,submittedIssue.id,'scoped handler can read its routed issue without HR access');
const issueProgress=(await scalar("select public.outlet_issue_update_v2($1,1,$2,'in_progress',$3,null,'','Memulai pemeriksaan mesin') as row",
  [submittedIssue.id,'71000000-0000-4000-8000-000000000002',bakerId])).row;
assert.equal(issueProgress.revision,2);
await workflowError("select public.outlet_issue_update_v2($1,1,$2,'completed',$3,null,'Selesai diperiksa','Menutup versi lama')",
  [submittedIssue.id,'71000000-0000-4000-8000-000000000003',bakerId],'berubah sejak dibuka');
const issueDone=(await scalar("select public.outlet_issue_update_v2($1,2,$2,'completed',$3,null,'Komponen dibersihkan dan mesin normal','Pemeriksaan selesai') as row",
  [submittedIssue.id,'71000000-0000-4000-8000-000000000004',bakerId])).row;
assert.equal(issueDone.status,'completed');
assert.equal((await scalar("select count(*)::int as count from public.outlet_issue_events where issue_id=$1",[submittedIssue.id])).count,3,
  'issue events retain created, progress and completion history');
await asUser(adminAuth);
await scalar('select public.supervisor_capability_save($1,$2,$3,$4,false) as row',[bakerId,'issue_handle',outlet.id,issueCategory.id]);
await asUser(cashierAuth);
const revokedRouteIssue=(await scalar("select public.outlet_issue_submit($1,$2,'Printer struk macet setelah akses petugas dicabut','normal',null,null,$3) as row",
  [outlet.id,issueCategory.id,'71000000-0000-4000-8000-000000000005'])).row;
assert.deepEqual({ status:revokedRouteIssue.status,owner_id:revokedRouteIssue.owner_id,routed_to_snapshot:revokedRouteIssue.routed_to_snapshot },
  { status:'new',owner_id:null,routed_to_snapshot:bakerId },'a revoked route recipient leaves a new issue unassigned while preserving route history');
await asUser(adminAuth);
await scalar('select public.supervisor_capability_save($1,$2,$3,$4,true) as row',[bakerId,'issue_handle',outlet.id,issueCategory.id]);

await asUser(adminAuth);
const handoverDate=clock.today;
const cashierHandoverAssignment=await scalar("select id from public.cashier_assignments where employee_id=$1 and work_date=$2",[cashierId,handoverDate]);
const bakerHandoverAssignment=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'afternoon','Penugasan penerima untuk serah terima',$4,false)) as row",
  [bakerId,handoverDate,outlet.id,null])).row;
await asUser(cashierAuth);
await workflowError("select public.shift_handover_save_v2(null,null,$1,$2,$3,$4,null,null,'Sisa cek kas','Printer dan laci aman','Mohon lanjutkan hitung stok',true,'Kirim tanpa penerima')",
  ['72000000-0000-4000-8000-000000000099',outlet.id,handoverDate,cashierHandoverAssignment.id], 'Penerima wajib');
const handover=(await scalar("select public.shift_handover_save_v2(null,null,$1,$2,$3,$4,$5,$6,'Sisa cek kas','Printer dan laci aman','Mohon lanjutkan hitung stok',true,'Kirim serah terima akhir shift') as row",
  ['72000000-0000-4000-8000-000000000001',outlet.id,handoverDate,cashierHandoverAssignment.id,bakerId,bakerHandoverAssignment.id])).row;
assert.equal(handover.status,'sent');
await asUser(bakerAuth);
const receivedHandover=(await scalar("select public.shift_handover_respond_v2($1,1,$2,true,'Catatan sudah dibaca dan diterima') as row",
  [handover.id,'72000000-0000-4000-8000-000000000002'])).row;
assert.equal(receivedHandover.status,'accepted');
assert.equal(receivedHandover.version,2,'a recipient response advances the handover version');
assert.equal((await scalar('select count(*)::int as count from public.shift_handover_versions where handover_id=$1 and version=2',[handover.id])).count,1,
  'the accepted/revision-requested response records the versioned content snapshot');
assert.equal((await scalar("select public.shift_handover_page($1,null,null,25,null) as page",[outlet.id])).page.items[0].id,handover.id,
  'recipient can retrieve the accepted versioned handover');

await asUser(adminAuth);
const exchangeDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+3)::text as day")).day;
const cashierExchange=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Jadwal pengusul untuk tukar shift',$4,false)) as row",
  [cashierId,exchangeDay,outlet.id,null])).row;
const bakerExchange=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'afternoon','Jadwal rekan untuk tukar shift',$4,false)) as row",
  [bakerId,exchangeDay,outlet.id,null])).row;
await asUser(cashierAuth);
const exchange=(await scalar("select public.shift_exchange_submit('swap',$1,$2,'Mohon tukar jadwal karena keperluan keluarga',$3) as row",
  [cashierExchange.id,bakerId,'73000000-0000-4000-8000-000000000001'])).row;
assert.equal(exchange.status,'pending_peer');
await asUser(bakerAuth);
const acceptedExchange=(await scalar("select public.shift_exchange_respond_v2($1,1,$2,true,'Saya setuju dengan pertukaran shift ini') as row",
  [exchange.id,'73000000-0000-4000-8000-000000000002'])).row;
assert.equal(acceptedExchange.status,'pending_spv');
await asUser(adminAuth);
const decidedExchange=(await scalar("select public.shift_exchange_decide_v2($1,2,$2,true,'Disetujui setelah memeriksa jadwal dan kebutuhan outlet') as row",
  [exchange.id,'73000000-0000-4000-8000-000000000003'])).row;
assert.equal(decidedExchange.status,'approved');
assert.deepEqual((await scalar("select public.shift_exchange_decide_v2($1,2,$2,true,'Disetujui setelah memeriksa jadwal dan kebutuhan outlet') as row",
  [exchange.id,'73000000-0000-4000-8000-000000000003'])).row,decidedExchange,'decision replay keeps the original atomic result');
const exchangedAssignments=(await db.query('select employee_id,shift from public.cashier_assignments where id in ($1,$2) order by employee_id',[cashierExchange.id,bakerExchange.id])).rows;
assert.deepEqual(exchangedAssignments,[{employee_id:bakerId,shift:'morning'},{employee_id:cashierId,shift:'afternoon'}],
  'approved swap preserves assignment row identities while atomically swapping shift context');
// Replacement deliberately starts with no peer assignment. This guards the
// decision path from losing the SELECT FOUND state after it cancels the
// requester assignment, which would otherwise turn an insert into a null-row
// update and leave the approved replacement without a roster entry.
const replacementDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+4)::text as day")).day;
const cashierReplacement=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Jadwal pengusul untuk pengganti',$4,false)) as row",
  [cashierId,replacementDay,outlet.id,null])).row;
assert.equal((await scalar('select count(*)::int as count from public.cashier_assignments where employee_id=$1 and work_date=$2',[bakerId,replacementDay])).count,0,
  'replacement fixture begins without a peer assignment');
await asUser(cashierAuth);
const replacement=(await scalar("select public.shift_exchange_submit('replacement',$1,$2,'Mohon pengganti karena keperluan keluarga',$3) as row",
  [cashierReplacement.id,bakerId,'73000000-0000-4000-8000-000000000004'])).row;
await asUser(bakerAuth);
const acceptedReplacement=(await scalar("select public.shift_exchange_respond_v2($1,1,$2,true,'Saya bersedia menjadi pengganti shift ini') as row",
  [replacement.id,'73000000-0000-4000-8000-000000000005'])).row;
assert.equal(acceptedReplacement.status,'pending_spv');
await asUser(adminAuth);
const decidedReplacement=(await scalar("select public.shift_exchange_decide_v2($1,2,$2,true,'Disetujui setelah memeriksa kebutuhan pengganti') as row",
  [replacement.id,'73000000-0000-4000-8000-000000000006'])).row;
assert.equal(decidedReplacement.status,'approved');
assert.deepEqual(await scalar('select employee_id,shift,status from public.cashier_assignments where employee_id=$1 and work_date=$2',[bakerId,replacementDay]),
  {employee_id:bakerId,shift:'morning',status:'active'},'approved replacement inserts the missing peer assignment atomically');
assert.equal((await scalar('select status from public.cashier_assignments where id=$1',[cashierReplacement.id])).status,'cancelled');
const cancelDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+5)::text as day")).day;
const cashierCancel=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Jadwal pengusul untuk pembatalan',$4,false)) as row",
  [cashierId,cancelDay,outlet.id,null])).row;
const bakerCancel=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'afternoon','Jadwal rekan untuk pembatalan',$4,false)) as row",
  [bakerId,cancelDay,outlet.id,null])).row;
await asUser(cashierAuth);
const cancellable=(await scalar("select public.shift_exchange_submit('swap',$1,$2,'Pengajuan yang kemudian perlu dibatalkan',$3) as row",
  [cashierCancel.id,bakerId,'73000000-0000-4000-8000-000000000007'])).row;
const cancelled=(await scalar("select public.shift_exchange_cancel_v2($1,1,$2,'Jadwal keluarga berubah sehingga pengajuan dibatalkan') as row",
  [cancellable.id,'73000000-0000-4000-8000-000000000008'])).row;
assert.equal(cancelled.status,'cancelled','requester can atomically cancel a still-pending request');
assert.deepEqual((await scalar("select public.shift_exchange_cancel_v2($1,1,$2,'Jadwal keluarga berubah sehingga pengajuan dibatalkan') as row",
  [cancellable.id,'73000000-0000-4000-8000-000000000008'])).row, cancelled,'cancel replay returns the original terminal result');
await db.exec('reset role');
const expiredFixture=(await scalar(`insert into public.shift_exchange_requests(request_type,work_date,requester_employee_id,peer_employee_id,requester_assignment_id,peer_assignment_id,requester_assignment_updated_at,peer_assignment_updated_at,reason)
  values('swap',(now() at time zone 'Asia/Jakarta')::date-1,$1,$2,$3,$4,$5,$6,'Fixture pengajuan lampau untuk expiry') returning *`,
  [cashierId,bakerId,cashierCancel.id,bakerCancel.id,cashierCancel.updated_at,bakerCancel.updated_at]));
await asUser(adminAuth);
const expiration=(await scalar("select public.shift_exchange_expire_stale_v2($1) as row",['73000000-0000-4000-8000-000000000009'])).row;
assert.equal(expiration.expired_count,1,'an Admin HR can close only past pending requests with durable history');
assert.equal((await scalar('select status from public.shift_exchange_requests where id=$1',[expiredFixture.id])).status,'expired');
assert.deepEqual((await scalar("select public.shift_exchange_expire_stale_v2($1) as row",['73000000-0000-4000-8000-000000000009'])).row,expiration,
  'expiry replay does not duplicate events or notifications');
const leaveBlockedDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+7)::text as day")).day;
const cashierLeaveBlocked=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Jadwal yang terkena cuti penuh',$4,false)) as row",
  [cashierId,leaveBlockedDay,outlet.id,null])).row;
const bakerLeaveBlocked=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'afternoon','Jadwal rekan untuk cek cuti',$4,false)) as row",
  [bakerId,leaveBlockedDay,outlet.id,null])).row;
await db.exec('reset role');
await db.query(`insert into public.leave_requests(employee_id,kind,extent,starts_on,ends_on,reason,status,decision_by,decision_note,decided_at)
  values($1,'personal','full_day',$2,$2,'Cuti penuh fixture pertukaran','approved',$3,'Disetujui untuk cek pertukaran',clock_timestamp())`,[cashierId,leaveBlockedDay,adminId]);
await asUser(cashierAuth);
await workflowError("select public.shift_exchange_submit('swap',$1,$2,'Tidak boleh lolos saat cuti penuh aktif',$3)",
  [cashierLeaveBlocked.id,bakerId,'73000000-0000-4000-8000-000000000010'],'cuti penuh');
const decisionBlockedDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+8)::text as day")).day;
await asUser(adminAuth);
const cashierDecisionBlocked=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'morning','Jadwal untuk cek ulang cuti saat keputusan',$4,false)) as row",
  [cashierId,decisionBlockedDay,outlet.id,null])).row;
await asUser(cashierAuth);
const decisionBlocked=(await scalar("select public.shift_exchange_submit('replacement',$1,$2,'Pengganti perlu persetujuan sebelum jadwal aktif',$3) as row",
  [cashierDecisionBlocked.id,bakerId,'73000000-0000-4000-8000-000000000017'])).row;
await asUser(bakerAuth);
const decisionBlockedAccepted=(await scalar("select public.shift_exchange_respond_v2($1,1,$2,true,'Saya bersedia membantu pada jadwal tersebut') as row",
  [decisionBlocked.id,'73000000-0000-4000-8000-000000000018'])).row;
assert.equal(decisionBlockedAccepted.status,'pending_spv');
await db.exec('reset role');
await db.query(`insert into public.leave_requests(employee_id,kind,extent,starts_on,ends_on,reason,status,decision_by,decision_note,decided_at)
  values($1,'personal','full_day',$2,$2,'Cuti penuh berubah setelah respons rekan','approved',$3,'Disetujui untuk cek keputusan pertukaran',clock_timestamp())`,[bakerId,decisionBlockedDay,adminId]);
await asUser(adminAuth);
await workflowError("select public.shift_exchange_decide_v2($1,2,$2,true,'Tidak boleh menyetujui pengganti yang kemudian cuti penuh')",
  [decisionBlocked.id,'73000000-0000-4000-8000-000000000019'],'cuti penuh');
// A replacement has no peer assignment, so it needs its own eligibility gate.
// First prove a candidate without Middle permission is rejected at submission.
const middleSubmitBlockedDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+9)::text as day")).day;
await db.exec('reset role');
await db.query('update public.employees set can_middle_shift=true where id=$1',[cashierId]);
await db.query('update public.employees set can_middle_shift=false where id=$1',[bakerId]);
await asUser(adminAuth);
const cashierMiddleBlocked=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'middle','Jadwal Middle untuk validasi calon pengganti',$4,false)) as row",
  [cashierId,middleSubmitBlockedDay,outlet.id,null])).row;
await asUser(cashierAuth);
await workflowError("select public.shift_exchange_submit('replacement',$1,$2,'Calon tanpa izin Middle tidak boleh diajukan',$3)",
  [cashierMiddleBlocked.id,bakerId,'73000000-0000-4000-8000-000000000020'],'izin Shift Middle');
assert.equal((await scalar('select count(*)::int as count from public.shift_exchange_requests where requester_assignment_id=$1',[cashierMiddleBlocked.id])).count,0,
  'rejected Middle replacement leaves no pending request or receipt-backed mutation');
// Then accept a valid Middle replacement, revoke the candidate permission, and
// prove the final decision rechecks current eligibility before it changes any
// assignment. This also exercises the trigger after the decision RPC has
// staged its atomic assignment writes.
const middleDecisionBlockedDay=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+10)::text as day")).day;
await db.exec('reset role');
await db.query('update public.employees set can_middle_shift=true where id=$1',[bakerId]);
await asUser(adminAuth);
const cashierMiddleDecision=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'middle','Jadwal Middle untuk cek ulang keputusan',$4,false)) as row",
  [cashierId,middleDecisionBlockedDay,outlet.id,null])).row;
await asUser(cashierAuth);
const middleDecisionRequest=(await scalar("select public.shift_exchange_submit('replacement',$1,$2,'Pengganti Middle yang perlu diperiksa lagi',$3) as row",
  [cashierMiddleDecision.id,bakerId,'73000000-0000-4000-8000-000000000021'])).row;
await asUser(bakerAuth);
const middleDecisionAccepted=(await scalar("select public.shift_exchange_respond_v2($1,1,$2,true,'Saya bersedia membantu untuk Shift Middle ini') as row",
  [middleDecisionRequest.id,'73000000-0000-4000-8000-000000000022'])).row;
assert.equal(middleDecisionAccepted.status,'pending_spv');
await db.exec('reset role');
await db.query('update public.employees set can_middle_shift=false where id=$1',[bakerId]);
await asUser(adminAuth);
await workflowError("select public.shift_exchange_decide_v2($1,2,$2,true,'Hak Shift Middle calon berubah setelah pengajuan')",
  [middleDecisionRequest.id,'73000000-0000-4000-8000-000000000023'],'izin Shift Middle');
assert.equal((await scalar('select status from public.shift_exchange_requests where id=$1',[middleDecisionRequest.id])).status,'pending_spv',
  'a failed final eligibility recheck preserves the request for explicit review');
assert.equal((await scalar('select status from public.cashier_assignments where id=$1',[cashierMiddleDecision.id])).status,'active',
  'failed final eligibility recheck rolls back cancellation of the requester assignment');
assert.equal((await scalar('select count(*)::int as count from public.cashier_assignments where employee_id=$1 and work_date=$2',[bakerId,middleDecisionBlockedDay])).count,0,
  'failed final eligibility recheck rolls back the candidate replacement assignment');
await asUser(cashierAuth);
const requesterExchangeHistory=(await scalar("select public.shift_exchange_page('history',25,null) as page")).page;
assert.deepEqual(requesterExchangeHistory.items.map((item)=>item.id).sort(),[exchange.id,replacement.id,cancellable.id,expiredFixture.id].sort(),
  'requester sees completed, cancelled, and expired histories but not a general HR queue');
await asUser('', 'anon');
await workflowError('select public.outlet_issue_page()',[],'permission denied');
await workflowError('select public.shift_handover_page()',[],'permission denied');
await workflowError('select public.shift_exchange_page()',[],'permission denied');
await db.exec('rollback');
console.log('Supervisor operations OK: scoped capability/routing, issue receipts+revision, private history, sender/recipient handover, atomic peer-approved swap, RLS');

// Interval planning uses explicit needs and planned assignment snapshots. This
// fixture is the required numeric case: B has a temporary leave 14:30–15:00
// and C starts Middle at 15:00, so exactly one interval is short by one.
await db.exec('begin');
const coverageAuth='10000000-0000-0000-0000-000000000089',coverageId='20000000-0000-0000-0000-000000000089';
const coverageDate=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date+6)::text as day")).day;
await db.exec('reset role');
const coverageAlternateOutlet=await scalar("insert into public.outlets(name,latitude,longitude,radius_m) values('Outlet Scope Cakupan Fiktif',-6.26,106.86,100) returning id");
await db.query("insert into auth.users(id,email) values($1,'rk000089@login.rajaklana.internal')",[coverageAuth]);
await db.query(`insert into public.employees(id,auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,approver_employee_id,can_clock,can_middle_shift)
  values($1,$2,'Kasir Cakupan','081234567889',$3,$4,$5,$6,'active',$7,true,true)`,[coverageId,coverageAuth,position.department_id,position.id,outlet.id,`${clock.year-1}-01-01`,adminId]);
await db.query("insert into public.employee_roles values($1,'employee')",[coverageId]);
await db.query('update public.employees set can_middle_shift=true where id in ($1,$2)',[cashierId,bakerId]);
await asUser(adminAuth);
const coverageWeekday=(await scalar('select extract(dow from $1::date)::int as day',[coverageDate])).day;
const intervalRequirement=(await scalar("select public.staffing_interval_requirement_save_v2(null,null,$1,$2,$3,'14:00','16:00',2,$4,null,'') as row",
  ['74000000-0000-4000-8000-000000000001',outlet.id,coverageWeekday,coverageDate])).row;
await workflowError("select public.staffing_interval_requirement_save_v2(null,null,$1,$2,$3,'15:00','17:00',1,$4,null,'Tumpang tindih')",
  ['74000000-0000-4000-8000-000000000002',outlet.id,coverageWeekday,coverageDate],'tidak boleh saling tumpang tindih');
await workflowError("select public.staffing_interval_requirement_save_v2($1,null,$2,$3,$4,'14:00','16:00',2,$5,null,'Perubahan tanpa versi')",
  [intervalRequirement.id,'74000000-0000-4000-8000-000000000011',outlet.id,coverageWeekday,coverageDate],'berubah sejak dibuka');
const replayEffectiveDate=(await scalar('select ($1::date+7)::text as day',[coverageDate])).day;
const replayRequirement=(await scalar("select public.staffing_interval_requirement_save_v2(null,null,$1,$2,$3,'17:00','18:00',1,$4,null,'Fixture replay interval masa depan') as row",
  ['74000000-0000-4000-8000-000000000014',outlet.id,coverageWeekday,replayEffectiveDate])).row;
const replayFirst=(await scalar("select public.staffing_interval_requirement_save_v2($1,$2,$3,$4,$5,'17:00','18:00',2,$6,null,'Ubah pertama yang responsnya hilang') as row",
  [replayRequirement.id,replayRequirement.revision,'74000000-0000-4000-8000-000000000015',outlet.id,coverageWeekday,replayEffectiveDate])).row;
const replayLater=(await scalar("select public.staffing_interval_requirement_save_v2($1,$2,$3,$4,$5,'17:00','18:00',3,$6,null,'Perubahan lain sesudah commit pertama') as row",
  [replayRequirement.id,replayFirst.revision,'74000000-0000-4000-8000-000000000016',outlet.id,coverageWeekday,replayEffectiveDate])).row;
assert.equal(replayLater.revision,replayFirst.revision+1,'a later edit advances the interval revision before the original response is retried');
assert.deepEqual((await scalar("select public.staffing_interval_requirement_save_v2($1,$2,$3,$4,$5,'17:00','18:00',2,$6,null,'Ubah pertama yang responsnya hilang') as row",
  [replayRequirement.id,replayRequirement.revision,'74000000-0000-4000-8000-000000000015',outlet.id,coverageWeekday,replayEffectiveDate])).row,replayFirst,
  'an interval retry returns its committed receipt even after a later revision, without duplicating audit');
await scalar('select public.supervisor_capability_save($1,$2,$3,null,true) as row',[bakerId,'coverage_configure',coverageAlternateOutlet.id]);
await asUser(bakerAuth);
await workflowError("select public.staffing_interval_requirement_save_v2($1,$2,$3,$4,$5,'14:00','16:00',2,$6,null,'Mencoba memindahkan kebutuhan outlet lain')",
  [intervalRequirement.id,intervalRequirement.revision,'74000000-0000-4000-8000-000000000012',coverageAlternateOutlet.id,coverageWeekday,coverageDate],'outlet kebutuhan sebelumnya');
await asUser(adminAuth);
const coverageAssignments=[];
for (const [employeeId,shift,reason] of [[cashierId,'middle','Penugasan A untuk uji cakupan interval'],[bakerId,'middle','Penugasan B untuk uji cakupan interval'],[coverageId,'middle','Penugasan C untuk uji cakupan interval']]) {
  coverageAssignments.push((await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,$4,$5,null,false)) as row",[employeeId,coverageDate,outlet.id,shift,reason])).row);
}
const planKeys=['74000000-0000-4000-8000-000000000003','74000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000005'];
for (const [index,assignment] of coverageAssignments.entries()) {
  const [starts,ends]=index===2?['15:00','23:00']:['08:00','16:00'];
  await scalar('select public.cashier_assignment_plan_save_v2($1,$2,$3,$4,$5,$6) as row',[assignment.id,assignment.updated_at,planKeys[index],starts,ends,'Jam rencana Middle untuk uji cakupan']);
}
await db.exec('reset role');
await db.query(`insert into public.leave_requests(employee_id,kind,extent,starts_on,ends_on,starts_at,ends_at,reason,status,decision_by,decision_note,decided_at)
  values($1,'personal','temporary_exit',$2,$2,'14:30','15:00','Izin keluar sementara uji cakupan','approved',$3,'Disetujui untuk uji cakupan',clock_timestamp())`,[bakerId,coverageDate,adminId]);
await asUser(adminAuth);
const coverage=(await scalar('select public.supervisor_interval_coverage($1,$2) as row',[outlet.id,coverageDate])).row;
assert.equal(coverage.configured,true);
assert.equal(coverage.unknown_middle_count,0,'all three Middle shifts have explicit 8-hour planned intervals');
assert.equal(coverage.coverage.filter(row=>row.shortage===1).length,1,'only the leave overlap interval is short by one');
const shortage=coverage.coverage.find(row=>row.shortage===1);
assert.equal(shortage.available_count,1);
assert.equal(shortage.minimum,2);
assert.equal(coverage.coverage.find(row=>row.planned_count===3)?.shortage,0,'Middle C joins only from its 15:00 boundary without double counting');
const report=(await scalar('select public.supervisor_report_page($1,$2,$3,null) as row',[coverageDate,coverageDate,outlet.id])).row;
assert.equal(report.summary.scheduled_days,3);
assert.equal(report.summary.coverage_shortage_intervals,1);
assert.equal(report.summary.coverage_unconfigured_days,0);
await scalar('select public.supervisor_capability_save($1,$2,$3,null,true) as row',[bakerId,'summary_view',outlet.id]);
await asUser(bakerAuth);
const limitedCoverage=(await scalar('select public.supervisor_interval_coverage($1,$2) as row',[outlet.id,coverageDate])).row;
assert.deepEqual(limitedCoverage.unknown_middle_employee_ids,[],'non-HR summary users do not receive worker identity lists');
const limitedReport=(await scalar('select public.supervisor_report_page($1,$2,$3,$4) as row',[coverageDate,coverageDate,outlet.id,bakerId])).row;
assert.deepEqual(limitedReport.people,[],'non-HR summary users do not receive an organization people aggregate');
await asUser(adminAuth);
await scalar('select public.supervisor_capability_save($1,$2,$3,null,false) as row',[bakerId,'summary_view',outlet.id]);
await scalar('select public.supervisor_capability_save($1,$2,$3,null,true) as row',[bakerId,'coverage_configure',outlet.id]);
await asUser(bakerAuth);
assert.equal((await db.query('select id from public.staffing_interval_requirements where outlet_id=$1',[outlet.id])).rows.length,2,
  'coverage configurator can read each scoped requirement without gaining a broad HR directory');
const configureCoverage=(await scalar('select public.supervisor_interval_coverage($1,$2) as row',[outlet.id,coverageDate])).row;
assert.deepEqual(configureCoverage.unknown_middle_employee_ids,[],'coverage configurator receives the same redacted people output as a summary-only user');
await asUser(adminAuth);
const legacyMiddleDate=(await scalar("select ((now() at time zone 'Asia/Jakarta')::date-1)::text as day")).day;
const legacyMiddle=(await scalar("select to_jsonb(public.cashier_assignment_save($1,$2,$3,'middle','Penugasan lama untuk guard absensi',$4,false)) as row",
  [coverageId,legacyMiddleDate,outlet.id,null])).row;
const legacyAttendance=(await scalar("select to_jsonb(public.attendance_record_manual($1,'middle',$2,$3,'Catatan absensi lama untuk guard jam Middle')) as row",
  [coverageId,`${legacyMiddleDate}T15:00:00+07:00`,`${legacyMiddleDate}T23:00:00+07:00`])).row;
await db.exec('reset role');
await db.query('update public.attendance set assignment_id=null where id=$1',[legacyAttendance.id]);
await asUser(adminAuth);
await workflowError('select public.cashier_assignment_plan_save_v2($1,$2,$3,$4,$5,$6)',
  [legacyMiddle.id,legacyMiddle.updated_at,'74000000-0000-4000-8000-000000000013','15:00','23:00','Mencoba mengubah jam setelah absensi legacy'],'sumber absensi');
await asUser('', 'anon');
await workflowError('select public.supervisor_interval_coverage($1,$2)',[outlet.id,coverageDate],'permission denied');
await workflowError('select public.supervisor_report_page($1,$2,$3,null)',[coverageDate,coverageDate,outlet.id],'permission denied');
await db.exec('rollback');
console.log('Supervisor planning/reports OK: non-overlap interval config, 8-hour Middle snapshot, partial leave boundary, scoped coverage and traceable period summary');

// Tokens are server-managed, replaceable, 24h, single-use and claim protected.
await db.exec('reset role');
const invitationEmployee=(await scalar(`insert into public.employees(full_name,whatsapp,department_id,position_id,outlet_id,starts_on,approver_employee_id)
  values('Undangan','081234567891',$1,$2,$3,$4,$5) returning id,employee_number`,[position.department_id,position.id,outlet.id,`${clock.year-1}-01-01`,adminId]));
await asUser(adminAuth);
const hash1='a'.repeat(64),hash2='b'.repeat(64);
await db.query(`select public.issue_account_token($1,'activation',$2)`,[invitationEmployee.id,hash1]);
await db.query(`select public.issue_account_token($1,'activation',$2)`,[invitationEmployee.id,hash2]);
await expectError('select * from public.account_tokens',[],'permission denied');
await asUser('', 'service_role');
await expectError('select public.inspect_account_token($1)',[hash1],'tidak berlaku');
const preview=(await scalar('select public.inspect_account_token($1) as token',[hash2])).token;
assert.equal(preview.employee_number,invitationEmployee.employee_number);
const claimId='30000000-0000-0000-0000-000000000001';
const claim=(await scalar('select public.claim_account_token($1,$2) as token',[hash2,claimId])).token;
await expectError('select public.claim_account_token($1,$2)',[hash2,'30000000-0000-0000-0000-000000000002'],'sedang diproses');
await expectError('select public.finish_account_token($1,$2,$3)',[claim.token_id,claimId,adminAuth],'Identitas Auth');
await db.exec('reset role');
const linkedAuth='10000000-0000-0000-0000-000000000004';
await db.query('insert into auth.users(id,email) values($1,$2)',[linkedAuth,`${invitationEmployee.employee_number.toLowerCase()}@login.rajaklana.internal`]);
await asUser('', 'service_role');
await db.query('select public.finish_account_token($1,$2,$3)',[claim.token_id,claimId,linkedAuth]);
await db.query('select public.finish_account_token($1,$2,$3)',[claim.token_id,claimId,linkedAuth]);
await expectError('select public.claim_account_token($1,$2)',[hash2,claimId],'sudah digunakan');
await asUser(adminAuth);
await db.query(`select public.issue_account_token($1,'reset',$2)`,[invitationEmployee.id,'c'.repeat(64)]);
await db.exec('reset role');
await db.query(`update public.account_tokens set expires_at=now()-interval '1 second' where employee_id=$1 and purpose='reset'`,[invitationEmployee.id]);
await asUser('', 'service_role');
await expectError('select public.inspect_account_token($1)',['c'.repeat(64)],'tidak berlaku');
await asUser(adminAuth);
await expectError('select public.claim_account_token($1,$2)',['c'.repeat(64),claimId],'permission denied');
await db.query(`select public.issue_account_token($1,'reset',$2)`,[invitationEmployee.id,'d'.repeat(64)]);
await asUser('', 'service_role');
const expiredClaim=(await scalar('select public.claim_account_token($1,$2) as token',['d'.repeat(64),claimId])).token;
await asUser(adminAuth);
await expectError(`select public.issue_account_token($1,'reset',$2)`,[invitationEmployee.id,'e'.repeat(64)],'sedang diproses');
await db.exec('reset role');
await db.query("update public.account_tokens set expires_at=now()-interval '1 second' where id=$1",[expiredClaim.token_id]);
await asUser(adminAuth);
await db.query(`select public.issue_account_token($1,'reset',$2)`,[invitationEmployee.id,'e'.repeat(64)]);
await asUser('', 'service_role');
await expectError('select public.finish_account_token($1,$2,$3)',[expiredClaim.token_id,claimId,linkedAuth],'no rows');
const abandonedClaim=(await scalar('select public.claim_account_token($1,$2) as token',['e'.repeat(64),claimId])).token;
await db.exec('reset role');
await db.query("update public.account_tokens set claimed_at=now()-interval '6 minutes' where id=$1",[abandonedClaim.token_id]);
await asUser('', 'service_role');
const resumedPreview=(await scalar('select public.inspect_account_token($1) as token',['e'.repeat(64)])).token;
assert.equal(resumedPreview.purpose,'reset','an abandoned claim can be reopened through the page inspection step');
const takeoverClaim=(await scalar('select public.claim_account_token($1,$2) as token',['e'.repeat(64),'30000000-0000-0000-8000-000000000002'])).token;
assert.equal(takeoverClaim.token_id,abandonedClaim.token_id,'retry takes over the same token rather than issuing a new one');
await db.query('select public.release_account_token($1,$2)',[takeoverClaim.token_id,'30000000-0000-0000-8000-000000000002']);
await asUser(adminAuth);
await db.query(`select public.issue_account_token($1,'reset',$2)`,[invitationEmployee.id,'f'.repeat(64)]);
await asUser('', 'service_role');
await expectError('select public.finish_account_token($1,$2,$3)',[abandonedClaim.token_id,claimId,linkedAuth],'no rows');
assert.equal((await scalar('select public.inspect_account_token($1) as token',['f'.repeat(64)])).token.purpose,'reset');
console.log('Tokens OK: replace/revoke,preview,exclusiveclaim,singleuse,Authidentity,idempotentfinish,expiry,abandonedpage-retry,hashprivacy');

// Service-owned fixtures check three calendar months and inclusiveeligiblemonth.
await db.exec('reset role');
await db.query('update public.employees set starts_on=$1 where id=$2',[`${clock.year}-07-15`,bakerId]);
assert.equal((await scalar('select private.allowance($1,$2,$3) as days',[bakerId,clock.year,`${clock.year}-10-14`])).days,'0');
assert.equal((await scalar('select private.allowance($1,$2,$3) as days',[bakerId,clock.year,`${clock.year}-10-15`])).days,'3');
assert.equal((await scalar('select private.allowance($1,$2,$3) as days',[bakerId,clock.year+1,`${clock.year+1}-01-01`])).days,'12');
console.log('Entitlement OK: 3calendarmonths,prorata,inclusivemonth,newyear');
await asUser(cashierAuth);
await db.exec('reset role');
await db.query(`update public.employees set status='inactive',account_status='disabled' where id=$1`,[cashierId]);
await asUser(cashierAuth);
assert.equal((await db.query('select * from public.employees')).rows.length,0,'disabledJWT loses dataaccess');
await expectError('select public.leave_balance()',[],'tidak aktif');
await expectError('select * from public.employee_directory()',[],'tidak aktif');
console.log('RLS OK: disabledsession revoked at datalayer');

await db.exec('reset role');
const bakerBeforeLifecycle=await scalar('select id,auth_user_id,employee_number,full_name from public.employees where id=$1',[bakerId]);
await db.exec(`create function core_contract_tests.reject_baker_role_write() returns trigger language plpgsql as $$
  begin if new.employee_id='${bakerId}'::uuid then raise exception 'simulated role write failure'; end if; return new; end;
$$;
create trigger reject_baker_role_write before insert on public.employee_roles
for each row execute function core_contract_tests.reject_baker_role_write();`);
await asUser(adminAuth);
const deactivatePayload=JSON.stringify({full_name:'Nama yang harus di-rollback',status:'inactive',ends_on:clock.today,exit_reason:'Uji transaksi akun'});
await expectError(`select public.hr_save_employee_with_roles($1::jsonb,$2,array['employee']::text[],'Uji rollback peran')`,
  [deactivatePayload,bakerId],'simulated role write failure');
await db.exec('reset role');
await db.exec('drop trigger reject_baker_role_write on public.employee_roles; drop function core_contract_tests.reject_baker_role_write();');
const rolledBack=await scalar('select status,account_status,full_name from public.employees where id=$1',[bakerId]);
assert.deepEqual(rolledBack,{status:'active',account_status:'active',full_name:bakerBeforeLifecycle.full_name},
  'employee data and status roll back when role replacement fails');

await asUser(adminAuth);
const deactivatedPayload=JSON.stringify({status:'inactive',ends_on:clock.today,exit_reason:'Uji perubahan peran atomik'});
await db.query(`select public.hr_save_employee_with_roles($1::jsonb,$2,array['employee']::text[],'Uji penonaktifan atomik')`,
  [deactivatedPayload,bakerId]);
await db.exec('reset role');
assert.deepEqual(await scalar('select status,account_status from public.employees where id=$1',[bakerId]),
  {status:'inactive',account_status:'disabled'},'employee deactivation and account closure commit together');
assert.deepEqual((await db.query('select role from public.employee_roles where employee_id=$1 order by role',[bakerId])).rows,
  [{role:'employee'}],'role removal commits with deactivation');

await asUser(adminAuth);
const reactivatePayload=JSON.stringify({status:'active',ends_on:null,exit_reason:null});
await db.query(`select public.hr_save_employee_with_roles($1::jsonb,$2,array['employee']::text[],'Uji reaktivasi')`,
  [reactivatePayload,bakerId]);
await expectError(`select public.issue_account_token($1,'activation',$2)`,[bakerId,'9'.repeat(64)],'Akun sudah diaktifkan');
await db.query(`select public.issue_account_token($1,'reset',$2)`,[bakerId,'8'.repeat(64)]);
await db.exec('reset role');
const reactivated=await scalar('select status,account_status,auth_user_id,employee_number from public.employees where id=$1',[bakerId]);
assert.deepEqual(reactivated,{status:'active',account_status:'active',auth_user_id:bakerBeforeLifecycle.auth_user_id,
  employee_number:bakerBeforeLifecycle.employee_number},'reactivation restores the linked login without changing employee identity');
await asUser(bakerAuth);
assert.equal((await db.query('select id from public.employee_directory() where id=$1',[bakerId])).rows.length,1,
  'the same account can read its employee record after reactivation');
await db.exec('reset role');
console.log('Employee lifecycle OK: atomic data+roles rollback, disable, same-identity reactivation, reset recovery');

const securityDefiners=(await db.query(`
  select p.oid,
         has_function_privilege('anon',p.oid,'execute') as anon_execute,
         has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
         coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%' as pinned_search_path
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
`)).rows;
assert.equal(securityDefiners.filter(row=>row.anon_execute).length,0,
  'public SECURITY DEFINER functions must not be executable by anon');
assert.equal(securityDefiners.filter(row=>!row.pinned_search_path).length,0,
  'public SECURITY DEFINER functions must pin search_path');
assert.ok(securityDefiners.some(row=>row.authenticated_execute),
  'the exposed RPC surface must remain present for authenticated business workflows');
console.log(`SECURITY DEFINER hygiene OK: ${securityDefiners.length} public functions, anon EXECUTE denied, search_path pinned, authenticated RPC surface retained`);
await db.close();
console.log('All database checks passed. Hosted Supabase Auth/Storage integration still requires deployment testing.');
