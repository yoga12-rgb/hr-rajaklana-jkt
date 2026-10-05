// Run: npm install --prefix supabase/.verification --no-save --no-package-lock @electric-sql/pglite
//      node supabase/tests/database.mjs
// PGlite executes actual Postgres functions/RLS. Only Supabase-owned auth/storage
// plumbing is mocked; production migrations themselves are not rewritten on disk.
import { PGlite } from '../.verification/node_modules/@electric-sql/pglite/dist/index.js';
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
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/'); $$;
  create publication supabase_realtime;
`);
const migrationDir = new URL('../migrations/', import.meta.url);
for (const name of (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort()) {
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
// First-admin creation must preserve the exact reserved Auth alias. Roll back
// its fixture so the remaining access-control tests start with their own actors.
await db.exec('begin');
await db.query(`select set_config('request.jwt.claim.role','service_role',false)`);
await db.exec('savepoint bootstrap_identity');
await expectError('select public.bootstrap_admin($1,$2,$3,$4)',
  ['10000000-0000-0000-0000-000000000099','Admin Awal','081234567899','Outlet Bootstrap'],'Identitas akun');
await db.exec('rollback to savepoint bootstrap_identity');
const reservation=(await scalar('select public.reserve_employee_number() as number')).number;
const bootstrapAuth='10000000-0000-0000-0000-000000000099';
await db.query('insert into auth.users(id,email) values($1,$2)',[bootstrapAuth,`${reservation.toLowerCase()}@login.rajaklana.internal`]);
const bootstrap=(await scalar('select to_jsonb(public.bootstrap_admin($1,$2,$3,$4)) as row',[bootstrapAuth,'Admin Awal','081234567899','Outlet Bootstrap'])).row;
assert.equal(bootstrap.employee_number,reservation,'bootstrap preserves Authalias');
assert.equal(bootstrap.auth_user_id,bootstrapAuth);
assert.equal(bootstrap.approval_mode,'external');
await db.exec('savepoint bootstrap_duplicate');
await expectError('select public.bootstrap_admin($1,$2,$3,$4)',
  [bootstrapAuth,'Admin Awal','081234567899','Outlet Bootstrap Kedua'],'sudah dibuat');
await db.exec('rollback to savepoint bootstrap_duplicate');
await db.exec('rollback');
console.log('Bootstrap OK: reservednumber preserved, activeadmin, externalapproval');
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
const attendance=(await scalar('select to_jsonb(public.attendance_clock_in($1,$2,$3,$4,$5)) as row',['morning',-6.2,106.8,10,selfie])).row;
assert.equal(attendance.required_minutes,480);
assert.equal(attendance.work_date,clock.today);
await expectError('select public.attendance_clock_in($1,$2,$3,$4,$5)',['morning',-6.2,106.8,10,selfie],'selfie baru');
await expectError('select public.attendance_clock_out($1,$2,$3)',[-7,106.8,10],'di luar radius');
await db.query('select public.attendance_clock_out($1,$2,$3)',[-6.2,106.8,10]);
await expectError('select public.attendance_clock_out($1,$2,$3)',[-6.2,106.8,10],'Tidak ada clock in');
console.log('Attendance OK: GPS,accuracy,selfie,permissions,duplicate,out');
await asUser(adminAuth);
await db.query(`update public.outlets set morning_starts_at='09:00' where id=$1`,[outlet.id]);
const corrected=(await scalar('select to_jsonb(public.attendance_correct($1,$2,$3,$4,$5)) as row',[
  attendance.id,attendance.clock_in,(await scalar('select clock_out from public.attendance where id=$1',[attendance.id])).clock_out,
  'Koreksi shift untuk pemeriksaan','morning'])).row;
assert.equal(corrected.expected_in,attendance.expected_in,'correction preserves historicalshiftstart');
assert.equal(corrected.corrected,true);
const adminSelfie=`${adminAuth}/own-selfie.jpg`;
await db.query(`insert into storage.objects(bucket_id,name) values('attendance-selfies',$1)`,[adminSelfie]);
const ownAttendance=(await scalar('select to_jsonb(public.attendance_clock_in($1,$2,$3,$4,$5)) as row',['morning',-6.2,106.8,10,adminSelfie])).row;
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
const costly=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Izin dengan potongan')) as row`,[future])).row;
const overdraft=(await scalar(`select to_jsonb(public.leave_submit('personal',$1,$1,'Pengujian saldo tidak cukup')) as row`,[future])).row;
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
await db.query(`select public.leave_submit('personal',$1,$1,'Izin dengan bukti','full_day',null,null,$2)`,[future,usedAttachment]);
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
