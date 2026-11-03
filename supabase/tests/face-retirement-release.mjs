// Final non-biometric attendance contract, upgrading the verified26 baseline with the isolated retirement migration.
// Managed Auth/Storage are represented locally; all identities/images synthetic.
import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { installAuthSessionFixture,fixtureSession } from './auth-session-fixture.mjs';
import { faceRetirementReleaseStatements, faceRetirementReleaseProbe } from '../deployment/verify-face-retirement-release.mjs';
const db=new PGlite();
try {
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text unique,updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated,service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
create publication supabase_realtime;
create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);`);
await installAuthSessionFixture(db);
const files=(await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort();
const retirement=files.findIndex(n=>n.endsWith('_remove_face_verification.sql'));
assert.equal(retirement,26,'explicit immutable26 -> face-retirement release boundary');
assert.equal(files.length,27,'release must contain exactly26 historical migrations plus retirement');
const apply=async name=>{await db.exec((await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;',''));
await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[name.slice(0,name.indexOf('_')),name.slice(name.indexOf('_')+1,-4)]);};
for(const name of files.slice(0,retirement)) await apply(name);
const baselineProbe=await readFile(new URL('../deployment/verify-authenticator-removed-preview.sql',import.meta.url),'utf8');
await db.exec(baselineProbe);
const probe=await faceRetirementReleaseStatements();
const row=async(sql,args=[])=>((await db.query(sql,args)).rows[0]);
const asUser=async(id,role='authenticated')=>{const session=await fixtureSession(db,id,role);await db.exec('set role '+role);return session;};
const denied=async(sql,args=[],fragment='permission denied')=>assert.rejects(()=>db.query(sql,args),error=>error.message.includes(fragment),fragment);
const owner=async()=>db.exec('reset role');
const cashAuth='10000000-0000-0000-0000-000000000001',oldAuth='10000000-0000-0000-0000-000000000002',otherAuth='10000000-0000-0000-0000-000000000003';
const cashId='20000000-0000-0000-0000-000000000001',oldId='20000000-0000-0000-0000-000000000002',otherId='20000000-0000-0000-0000-000000000003';
const position=await row('select id,department_id from public.positions where is_cashier limit 1');
const outlet=await row("insert into public.outlets(name,latitude,longitude,radius_m,max_accuracy_m) values('Selfie Fiktif',-6.2,106.8,100,100) returning id");
await db.query("insert into auth.users(id,email) values($1,'qa-cash@example.invalid'),($2,'qa-old@example.invalid'),($3,'qa-other@example.invalid')",[cashAuth,oldAuth,otherAuth]);
for(const[id,auth,name]of[[cashId,cashAuth,'Tanpa Referensi'],[oldId,oldAuth,'Bukti Historis'],[otherId,otherAuth,'Akun Lain']]){
  await db.query("insert into public.employees(id,auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,can_clock) values($1,$2,$3,'081111111111',$4,$5,$6,'2025-01-01','active',true)",[id,auth,name,position.department_id,position.id,outlet.id]);
  await db.query("insert into public.employee_roles(employee_id,role) values($1,'employee')",[id]);
}
const assignment=await row("insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by) values($1,(clock_timestamp() at time zone 'Asia/Jakarta')::date,$2,'morning','Uji foto tanpa pencocokan',$3) returning id",[cashId,outlet.id,oldId]);
const oldReference=await row("insert into public.biometric_references(employee_id,consent_version,status) values($1,'2026-10-18','approved') returning id",[oldId]);
await db.query("insert into private.biometric_material(reference_id,descriptor,image_path,image_sha256,model_id) values($1,$2,$3,$4,'face-api-1.7.15-v1')",[oldReference.id,Array(128).fill(0),oldAuth+'/old-reference.jpg','a'.repeat(64)]);
await db.query("insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason) values('biometric_reference',$1,$2,'approved','Bukti sebelum retirement')",[oldReference.id,oldId]);
await db.query("insert into storage.objects(bucket_id,name) values('attendance-selfies',$1)",[oldAuth+'/old-attendance.jpg']);
const historicalAttendance=await row(`insert into public.attendance(employee_id,outlet_id,work_date,shift,expected_in,expected_out,morning_starts_at,afternoon_starts_at,tolerance_minutes,
  outlet_latitude,outlet_longitude,radius_m,clock_in,clock_out,in_latitude,in_longitude,in_accuracy_m,in_distance_m,selfie_path,
  selfie_captured_at,selfie_outlet_name,biometric_reference_id,biometric_model_id,selfie_sha256)
  values($1,$2,(clock_timestamp() at time zone 'Asia/Jakarta')::date-1,'morning',clock_timestamp()-interval '1 day',clock_timestamp()-interval '16 hours','07:00','15:00',0,
  -6.2,106.8,100,clock_timestamp()-interval '1 day',clock_timestamp()-interval '16 hours',-6.2,106.8,10,0,$3,
  clock_timestamp()-interval '1 day','Selfie Fiktif',$4,'face-api-1.7.15-v1',$5) returning to_jsonb(attendance) evidence`,[oldId,outlet.id,oldAuth+'/old-attendance.jpg',oldReference.id,'a'.repeat(64)]);
const oldAssignment=await row("insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by) values($1,(clock_timestamp() at time zone 'Asia/Jakarta')::date,$2,'morning','Receipt lama tetap privat',$1) returning id",[oldId,outlet.id]);
const oldPending=await row("insert into storage.objects(bucket_id,name) values('attendance-selfies',$1) returning id",[oldAuth+'/old-pending.jpg']);
await db.query(`insert into private.biometric_receipts(employee_id,reference_id,selfie_path,selfie_sha256,storage_object_id,shift,latitude,longitude,accuracy_m,
  geo_captured_at,selfie_captured_at,selfie_outlet_name,assignment_id,outlet_id)
  values($1,$2,$3,$4,$5,'morning',-6.2,106.8,10,clock_timestamp(),clock_timestamp(),'Selfie Fiktif',$6,$7)`,[oldId,oldReference.id,oldAuth+'/old-pending.jpg','a'.repeat(64),oldPending.id,oldAssignment.id,outlet.id]);
const snapshotSQL="select jsonb_build_object('references',(select jsonb_agg(to_jsonb(r) order by id) from public.biometric_references r),'material',(select jsonb_agg(to_jsonb(m) order by reference_id) from private.biometric_material m),'receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.biometric_receipts r),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a)) as snapshot";
const before=(await row(snapshotSQL)).snapshot;
// Preview historically grants service_role direct EXECUTE on these legacy
// functions. Reproduce that actual pre-release shape, then prove retirement
// explicitly closes it without weakening the consumer's owner-only internal call.
await db.exec(`grant execute on function public.attendance_clock_in(text,double precision,double precision,double precision,text),
public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text),
public.attendance_clock_in_verified(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid),
public.biometric_review(uuid,text,text),public.biometric_withdraw() to service_role`);
await db.exec(baselineProbe);
await apply(files[retirement]);
await db.exec(await faceRetirementReleaseProbe());
assert.deepEqual((await row(snapshotSQL)).snapshot,before,'upgrade preserves original references/material/audit bytes');
assert.deepEqual((await row('select to_jsonb(a) evidence from public.attendance a where id=$1',[historicalAttendance.evidence.id])).evidence,historicalAttendance.evidence,'upgrade preserves complete historical attendance including matching evidence');
assert.equal((await row("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='biometric_references'")).n,0);
const retired=[
  'public.biometric_server_material(uuid,boolean,boolean)','public.biometric_enroll_server(uuid,text,text,jsonb)',
  'public.biometric_stage_reference(uuid,text)','public.biometric_selfie_object(uuid,text)',
  'public.biometric_issue_receipt(uuid,uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text)',
  'public.biometric_review(uuid,text,text)','public.biometric_withdraw()',
  'public.attendance_clock_in_verified(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid)',
  'public.attendance_clock_in(text,double precision,double precision,double precision,text)',
  'public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text)'
];
for(const role of ['anon','authenticated','service_role'])for(const signature of retired)assert.equal((await row('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).allowed,false,role+':'+signature);
for(const role of ['anon','authenticated','service_role']){
  assert.equal((await row("select has_table_privilege($1,'public.biometric_references','SELECT') allowed",[role])).allowed,false);
  assert.equal((await row("select has_table_privilege($1,'private.attendance_selfie_receipts','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).allowed,false);
}
assert.equal((await row("select relrowsecurity from pg_class where oid='private.attendance_selfie_receipts'::regclass")).relrowsecurity,true);
await asUser('','service_role');await denied('delete from storage.objects where id=$1',[oldPending.id],'Selfie masih digunakan');await owner();
const path=cashAuth+'/fresh.jpg';
const object=await row("insert into storage.objects(bucket_id,name) values('attendance-selfies',$1) returning id",[path]);
const now=(await row('select clock_timestamp()::text at')).at;
const issueSQL='select * from public.attendance_issue_selfie_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
const issueArgs=[cashId,object.id,path,'b'.repeat(64),'morning',-6.2,106.8,10,now,now,'Selfie Fiktif'];
const clockSQL='select to_jsonb(public.attendance_clock_in_selfie($1,$2,$3,$4,$5,$6,$7,$8,$9)) attendance';
await asUser(cashAuth);
await denied(issueSQL,issueArgs);
await denied('select * from public.biometric_references');
await denied('select * from private.attendance_selfie_receipts');
await asUser('', 'service_role');
await denied(issueSQL,[cashId,'ffffffff-ffff-ffff-ffff-ffffffffffff',...issueArgs.slice(2)],'belum terverifikasi');
await denied(issueSQL,[cashId,object.id,otherAuth+'/fresh.jpg',...issueArgs.slice(3)],'belum terverifikasi');
await denied(issueSQL,[...issueArgs.slice(0,4),'afternoon',...issueArgs.slice(5)],'Penugasan shift berubah');
await denied(issueSQL,[...issueArgs.slice(0,8),'2000-01-01',...issueArgs.slice(9)],'terlalu lama');
await denied(issueSQL,[...issueArgs.slice(0,5),-7.2,...issueArgs.slice(6)],'radius');
await denied(issueSQL,[...issueArgs.slice(0,7),200,...issueArgs.slice(8)],'akurat');
const receipt=await row(issueSQL,issueArgs);
const args=['morning',-6.2,106.8,10,path,now,'Selfie Fiktif',now,receipt.id];
await asUser(otherAuth);await denied(clockSQL,args,'telah berakhir');
await asUser(cashAuth);await denied(clockSQL,[...args.slice(0,2),106.80001,...args.slice(3)],'Data absensi berubah');
assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path])).rows.length,0,'live receipt protects photo through Storage RLS');
assert.equal((await db.query('update storage.objects set name=$1 where name=$2 returning id',[cashAuth+'/replace.jpg',path])).rows.length,0,'browser cannot replace a selfie');
await asUser('','service_role');await denied('delete from storage.objects where name=$1',[path],'Selfie masih digunakan');
await owner();await db.query("update private.attendance_selfie_receipts set expires_at=clock_timestamp()-interval '1 second' where id=$1",[receipt.id]);
await asUser(cashAuth);await denied(clockSQL,args,'telah berakhir');
await owner();await db.query("update private.attendance_selfie_receipts set expires_at=clock_timestamp()+interval '90 seconds' where id=$1",[receipt.id]);
await db.query("update public.cashier_assignments set shift='afternoon' where id=$1",[assignment.id]);
await asUser(cashAuth);await denied(clockSQL,args,'Penugasan atau foto selfie berubah');
await owner();assert.equal((await row('select consumed_at from private.attendance_selfie_receipts where id=$1',[receipt.id])).consumed_at,null,'changed assignment failure does not consume receipt');
await db.query("update public.cashier_assignments set shift='morning' where id=$1",[assignment.id]);
// An expired unused receipt permits ordinary orphan deletion. A reupload with
// the identical path receives another Storage object ID and cannot redeem the
// old receipt, even when the fixture restores its expiry for this assertion.
await db.query("update private.attendance_selfie_receipts set expires_at=clock_timestamp()-interval '1 second' where id=$1",[receipt.id]);
await asUser('','service_role');await db.query('delete from storage.objects where name=$1',[path]);
await owner();const replaced=await row("insert into storage.objects(bucket_id,name) values('attendance-selfies',$1) returning id",[path]);assert.notEqual(replaced.id,object.id);
await db.query("update private.attendance_selfie_receipts set expires_at=clock_timestamp()+interval '90 seconds' where id=$1",[receipt.id]);
await asUser(cashAuth);await denied(clockSQL,args,'Penugasan atau foto selfie berubah');
await owner();assert.equal((await row('select consumed_at from private.attendance_selfie_receipts where id=$1',[receipt.id])).consumed_at,null,'reuploaded object failure does not consume receipt');
await db.query("update private.attendance_selfie_receipts set expires_at=clock_timestamp()-interval '1 second' where id=$1",[receipt.id]);
await asUser('','service_role');await db.query('delete from storage.objects where name=$1',[path]);
await owner();await db.query("insert into storage.objects(id,bucket_id,name) values($1,'attendance-selfies',$2)",[object.id,path]);
await db.query("update private.attendance_selfie_receipts set expires_at=clock_timestamp()+interval '90 seconds' where id=$1",[receipt.id]);
await db.query('update public.employees set can_clock=false where id=$1',[cashId]);
await asUser(cashAuth);await denied(clockSQL,args,'diizinkan');
await owner();await db.query('update public.employees set can_clock=true where id=$1',[cashId]);
const session=await asUser(cashAuth);await owner();await db.query('delete from auth.sessions where id=$1',[session.sessionId]);await db.exec('set role authenticated');
await denied(clockSQL,args,'Sesi');
await asUser(cashAuth);
const attendance=(await row(clockSQL,args)).attendance;
assert.equal(attendance.biometric_reference_id,null);assert.equal(attendance.biometric_model_id,null);assert.equal(attendance.selfie_sha256,'b'.repeat(64));
assert.equal(attendance.employee_id,cashId);assert.equal(attendance.assignment_id,assignment.id);assert.equal(attendance.selfie_path,path);
await denied(clockSQL,args,'telah berakhir');
assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path])).rows.length,0,'committed attendance preserves selfie');
await denied("select public.attendance_clock_out_fresh(-6.2,106.8,10,clock_timestamp()-interval '2 minutes')",[],'terlalu lama');
await db.query('select public.attendance_clock_out_fresh(-6.2,106.8,10,clock_timestamp())');
await owner();
assert.equal((await row('select consumed_at is not null used from private.attendance_selfie_receipts where id=$1',[receipt.id])).used,true);
assert.deepEqual((await row(snapshotSQL)).snapshot.references,before.references);assert.deepEqual((await row(snapshotSQL)).snapshot.material,before.material);
assert.deepEqual((await row(snapshotSQL)).snapshot.receipts,before.receipts,'old receipt original envelope/consumption are preserved');
assert.deepEqual((await row('select to_jsonb(a) evidence from public.attendance a where id=$1',[historicalAttendance.evidence.id])).evidence,historicalAttendance.evidence,'new selfie attendance never rewrites historical matching evidence');
assert.equal((await row('select count(*)::int n from public.biometric_references where employee_id=$1',[cashId])).n,0,'cashier clocks in with no face reference ever registered');
console.log('Face retirement isolated26→27 functional PASS: populated26 preserved; no face RPC/metadata access; fresh own server-bound selfie/GPS/assignment; revoked session/can_clock denied; receipt atomic/single-use; Storage guards; clockout unchanged.');

  const gates=[];
  async function rejects(label,mutate,pattern) {
    await db.exec('begin');
    try {
      await mutate();
      await assert.rejects(db.exec(probe),pattern,label);
    } finally { await db.exec('rollback'); }
    await db.exec(probe);
    gates.push(label);
  }
  async function changeBody(signature,before,after) {
    const definition=await row('select pg_get_functiondef($1::regprocedure) as definition,prosrc from pg_proc where oid=$1::regprocedure',[signature]);
    assert.ok(definition.prosrc.includes(before),'real target statement must exist for '+signature);
    await db.exec(definition.definition.replace(definition.prosrc,()=>definition.prosrc.replace(before,after)));
  }
  const issue='public.attendance_issue_selfie_receipt(uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text)';
  const consume='public.attendance_clock_in_selfie(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid)';
  await rejects('service authorization decoy in new receipt issuer',()=>changeBody(issue,'perform private.require_service();','perform 1; -- private.require_service() decoy'),/exact selfie-only helper body\/metadata contract differs/);
  await rejects('consumed receipt predicate bypass with original guard comment',()=>changeBody(consume,'v_receipt.consumed_at is not null','false /* v_receipt.consumed_at is not null */'),/exact selfie-only helper body\/metadata contract differs/);
  await rejects('pending selfie receipt deletion predicate bypass',()=>changeBody('private.protect_verified_selfie_delete()','or exists(select 1 from private.attendance_selfie_receipts','or exists(select 1 from private.attendance_selfie_receipts where false) or exists(select 1 from private.attendance_selfie_receipts'),/exact selfie-only helper body\/metadata contract differs/);
  await rejects('new receipt function security invoker metadata',()=>db.exec('alter function '+issue+' security invoker'),/exact selfie-only helper body\/metadata contract differs/);
  await rejects('new issue RPC opened to authenticated',()=>db.exec('grant execute on function '+issue+' to authenticated'),/selfie-only helper EXECUTE contract differs/);
  await rejects('retired face RPC inherited PUBLIC execution',()=>db.exec('grant execute on function public.biometric_server_material(uuid,boolean,boolean) to public'),/retired face\/legacy attendance EXECUTE contract differs/);
  await rejects('private selfie receipt destructive privilege',()=>db.exec('grant truncate on private.attendance_selfie_receipts to authenticated'),/selfie-only private\/retired table privilege contract differs/);
  await rejects('private selfie receipt RLS disabled',()=>db.exec('alter table private.attendance_selfie_receipts disable row level security'),/selfie-only private\/retired table RLS contract differs/);
  await rejects('receipt expiry made nullable',()=>db.exec('alter table private.attendance_selfie_receipts alter column expires_at drop not null'),/selfie receipt column\/nullability contract differs/);
  await rejects('receipt employee FK linkage removed',()=>db.exec('alter table private.attendance_selfie_receipts drop constraint attendance_selfie_receipts_employee_id_fkey'),/selfie receipt PK\/FK linkage contract differs/);
  await rejects('retired references returned to Realtime',()=>db.exec('alter publication supabase_realtime add table public.biometric_references'),/retired face references remain in Realtime publication/);
  await rejects('private reference bucket made public',()=>db.exec("update storage.buckets set public=true where id='biometric-references'"),/private selfie\/reference bucket contract differs/);
  await rejects('delete trigger WHEN false bypass',()=>db.exec(`drop trigger protect_verified_selfie_delete on storage.objects;
    create trigger protect_verified_selfie_delete before delete on storage.objects for each row when(false) execute function private.protect_verified_selfie_delete()`),/selfie Storage delete trigger contract differs/);
  await rejects('same-count release27 migration name mismatch',()=>db.exec("update supabase_migrations.schema_migrations set name='wrong_retirement' where version='20261103021143'"),/ordered 27-name face-retirement release contract/);

  await rejects('baseline independent live-session helper bypass',()=>changeBody('private.session_allowed()',
    "select (private.session_access_context()->>'allowed')::boolean;", "select true; -- private.session_access_context allowed decoy"),/helper definition differs from independent reviewed contract/);
  await rejects('baseline restrictive attendance policy bypass',()=>db.exec(
    'alter policy privileged_mfa_session on public.attendance using(true) with check(true)'),/restrictive live-session policy missing or weakened/);
  await rejects('baseline recovery tombstone decoy',()=>changeBody('public.auth_mfa_recovery_complete(uuid,boolean)',
    "raise exception 'Pemulihan autentikator sudah dihentikan.' using errcode='0A000';", "return '{}'::jsonb; -- Pemulihan autentikator sudah dihentikan."),/retired recovery tombstone body differs from exact contract/);
  await rejects('legacy core5 service-role bypass reopened',()=>db.exec(
    'grant execute on function public.attendance_clock_in(text,double precision,double precision,double precision,text) to service_role'),/retired face\/legacy attendance EXECUTE contract differs/);
  await rejects('legacy core7 service-role bypass reopened',()=>db.exec(
    'grant execute on function public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text) to service_role'),/retired face\/legacy attendance EXECUTE contract differs/);
  await assert.rejects(db.exec(baselineProbe),/ordered 26-name contract/,'original26 probe must reject final27 instead of silently accepting extra migrations');
  await db.exec('rollback');
  // Only the two independently enumerated complete history maps are accepted.
  // No hosted row or applied history is changed: this transaction is synthetic.
  const aliasPairs=[['20261023080451','20261025044841'],['20261023181824','20261025044859'],
    ['20261023183130','20261025044910'],['20261024110000','20261025045641'],
    ['20261024233053','20261025050057'],['20261027090000','20261027031129'],
    ['20261027090100','20261029032121'],['20261030031318','20261030033256']];
  await db.exec('begin');
  try {
    for(const [canonical,alias] of aliasPairs)await db.query('update supabase_migrations.schema_migrations set version=$1 where version=$2',[alias,canonical]);
    await db.exec(probe);
    await db.exec('savepoint known_preview');
    await db.query('update supabase_migrations.schema_migrations set version=$1 where version=$2',['20261025044842','20261025044841']);
    await assert.rejects(db.exec(probe),/ordered version-name contract/,'unknown Preview version pair must fail');
    await db.exec('rollback to known_preview');
    await db.exec(probe);
  } finally { await db.exec('rollback'); }
  await db.exec(await faceRetirementReleaseProbe());
  console.log('FACE_RETIREMENT_RELEASE_EVIDENCE '+JSON.stringify({contract:'isolated26-to27',database:'synthetic_pglite',
    canonical26_positive:true,preview26_broad_legacy_service_acl_reproduced:true,populated26_preserved:true,
    functional_no_reference_clockin:true,canonical27_positive:true,known_preview_alias27_positive:true,
    original26_rejects27:true,unknown_preview_version_rejected:true,negative_gates:gates,restored_positive:true,
    hosted:false,actual_native_concurrency:false}));
} finally { await db.close(); }
