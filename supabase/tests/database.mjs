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
for (const name of migrationNames) {
  let sql = await readFile(new URL(name, migrationDir), 'utf8');
  // gen_random_uuid is built into Postgres17. The pgcrypto package is owned by
  // hosted Supabase but not bundled in PGlite; no other statement is removed.
  sql = sql.replace('create extension if not exists pgcrypto with schema extensions;', '');
  try { await db.exec(sql); console.log(`Migration OK: ${name}`); }
  catch (error) { console.error(`Migration FAILED: ${name}`, error.message); throw error; }
}
const scalar = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
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
assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',['authenticated',captureSignature,'EXECUTE'])).allowed,true);
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
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5)',['middle',-6.2,106.8,10,selfie],'belum diizinkan');
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5)',['morning',-7,106.8,10,selfie],'di luar radius');
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,500,selfie],'belum cukup akurat');
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,10,`${adminAuth}/fake.jpg`],'Selfie wajib');
const capturedAt=(await scalar(`select (clock_timestamp()-interval '35 seconds')::text as captured`)).captured;
const captureArgs=['morning',-6.2,106.8,10,selfie,capturedAt,'  Nama Outlet Saat Foto  '];
for(const metadata of [[null,'Outlet Foto'],[capturedAt,null],[capturedAt,'  '],[null,null]]) {
  await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7)',[...captureArgs.slice(0,5),...metadata],'harus lengkap');
}
for(const invalid of ['infinity','-infinity']) {
  await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7)',[...captureArgs.slice(0,5),invalid,'Outlet Foto'],'tidak valid');
}
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7)',
  ['middle',-6.2,106.8,10,selfie,capturedAt,'Outlet Foto'],'belum diizinkan');
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7)',
  ['morning',-7,106.8,10,selfie,capturedAt,'Outlet Foto'],'di luar radius');
assert.equal((await scalar('select count(*)::int as count from public.attendance')).count,0,
  'rejected metadata and GPS leave no attendance row');
const attendance=(await scalar('select to_jsonb(public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7)) as row',captureArgs)).row;
assert.equal(attendance.required_minutes,480);
assert.equal(attendance.work_date,clock.today);
assert.equal(+new Date(attendance.selfie_captured_at),+new Date(capturedAt));
assert.ok(+new Date(attendance.selfie_captured_at)<+new Date(attendance.clock_in),'device capture instant stays separate from server clock in');
assert.equal(attendance.selfie_outlet_name,'Nama Outlet Saat Foto');
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5,$6,$7)',captureArgs,'selfie baru');
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,10,selfie],'selfie baru');
await asUser(adminAuth);
await db.query(`update public.outlets set active=false,latitude=-6.3,longitude=106.9,radius_m=20 where id=$1`,[outlet.id]);
await asUser(cashierAuth);
await expectError('select public.attendance_clock_out($1,$2,$3)',[-6.3,106.9,10],'di luar radius');
await expectError('select public.attendance_clock_out($1,$2,$3)',[-7,106.8,10],'di luar radius');
await db.query('select public.attendance_clock_out($1,$2,$3)',[-6.2,106.8,10]);
await expectError('select public.attendance_clock_out($1,$2,$3)',[-6.2,106.8,10],'Tidak ada clock in');
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
const ownAttendance=(await scalar('select to_jsonb(public.attendance_clock_in($1,$2,$3,$4,$5)) as row',['morning',-6.2,106.8,10,adminSelfie])).row;
assert.equal(ownAttendance.selfie_captured_at,null,'legacy five-argument call remains usable without inventing capture evidence');
assert.equal(ownAttendance.selfie_outlet_name,null);
await expectError('select public.attendance_correct($1,$2,$3,$4)',[ownAttendance.id,ownAttendance.clock_in,null,'Mengoreksi absensi sendiri'],'sendiri');
await db.query('select public.attendance_clock_out($1,$2,$3)',[-6.2,106.8,10]);
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
await asUser(adminAuth);
await db.query(`select public.issue_account_token($1,'reset',$2)`,[invitationEmployee.id,'f'.repeat(64)]);
await asUser('', 'service_role');
await expectError('select public.finish_account_token($1,$2,$3)',[abandonedClaim.token_id,claimId,linkedAuth],'no rows');
assert.equal((await scalar('select public.inspect_account_token($1) as token',['f'.repeat(64)])).token.purpose,'reset');
console.log('Tokens OK: replace/revoke,preview,exclusiveclaim,singleuse,Authidentity,idempotentfinish,expiry,abandonedrecovery,hashprivacy');

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
await db.close();
console.log('All database checks passed. Hosted Supabase Auth/Storage integration still requires deployment testing.');
