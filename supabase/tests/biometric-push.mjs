// Real Postgres policy/RPC tests; only Supabase's managed Auth/Storage plumbing
// is represented locally. No hosted employee or biometric data is used.
import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text unique,updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
create publication supabase_realtime;`);
for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
  const sql=(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;','');
  await db.exec(sql);
}
const row=async(sql,args=[])=>((await db.query(sql,args)).rows[0]);
async function asUser(id,role='authenticated'){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id,role]);await db.exec('set role '+role);
}
async function denied(sql,args,fragment){await assert.rejects(()=>db.query(sql,args),e=>e.message.includes(fragment),fragment);}
const adminAuth='10000000-0000-0000-0000-000000000001',cashAuth='10000000-0000-0000-0000-000000000002',otherAuth='10000000-0000-0000-0000-000000000003';
const adminId='20000000-0000-0000-0000-000000000001',cashId='20000000-0000-0000-0000-000000000002',otherId='20000000-0000-0000-0000-000000000003';
const position=await row('select id,department_id from public.positions where is_cashier limit 1');
const outlet=await row("insert into public.outlets(name,latitude,longitude,radius_m) values('Fiktif Uji Identitas',-6.2,106.8,100) returning id");
await db.query("insert into auth.users(id,email) values($1,'qa-admin@example.invalid'),($2,'qa-cashier@example.invalid'),($3,'qa-other@example.invalid')",[adminAuth,cashAuth,otherAuth]);
for(const[id,auth,name]of[[adminId,adminAuth,'HR Fiktif'],[cashId,cashAuth,'Kasir Fiktif'],[otherId,otherAuth,'HR Kedua Fiktif']])await db.query("insert into public.employees(id,auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,can_clock) values($1,$2,$3,'081111111111',$4,$5,$6,'2025-01-01','active',true)",[id,auth,name,position.department_id,position.id,outlet.id]);
await db.query("insert into public.employee_roles(employee_id,role) values($1,'employee'),($1,'admin_hr'),($2,'employee'),($3,'employee'),($3,'admin_hr')",[adminId,cashId,otherId]);
const assignment=await row("insert into public.cashier_assignments(employee_id,work_date,outlet_id,shift,reason,created_by) values($1,(now() at time zone 'Asia/Jakarta')::date,$2,'morning','Uji absensi identitas',$3) returning id",[cashId,outlet.id,adminId]);
const reference=await row("insert into public.biometric_references(employee_id,consent_version) values($1,'2026-10-18') returning id",[cashId]);
await db.query("insert into private.biometric_material(reference_id,descriptor,image_path,image_sha256,model_id) values($1,$2,$3,$4,'face-api-1.7.15-v1')",[reference.id,Array(128).fill(0),cashAuth+'/reference.jpg','a'.repeat(64)]);
await asUser(cashAuth);
for(const signature of[
  'public.attendance_clock_in(text,double precision,double precision,double precision,text)',
  'public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text)',
  'public.attendance_clock_out(double precision,double precision,double precision)',
  'public.biometric_issue_receipt(uuid,uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text)',
  'public.biometric_server_material(uuid,boolean,boolean)'
])assert.equal((await row("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed",[signature])).allowed,false,signature);
await denied('select * from private.biometric_material',[],'permission denied');
await denied("update public.biometric_references set status='approved' where id=$1",[reference.id],'permission denied');
await denied("select public.biometric_review($1,'approved','Identitas telah diperiksa')",[reference.id],'Admin HR');
await asUser(adminAuth);
await db.query("select public.biometric_review($1,'approved','Identitas fiktif diperiksa HR lain')",[reference.id]);
await db.exec('reset role');
const adminRef=await row("insert into public.biometric_references(employee_id,consent_version) values($1,'2026-10-18') returning id",[adminId]);
await asUser(adminAuth);
await denied("select public.biometric_review($1,'approved','Saya menyetujui diri sendiri')",[adminRef.id],'sendiri');
await asUser(otherAuth);
assert.equal((await db.query('select * from public.biometric_references')).rows.length,2,'HR can see reference metadata for review');
await db.exec('reset role');
const selfie=cashAuth+'/new-selfie.jpg';
const object=await row("insert into storage.objects(bucket_id,name) values('attendance-selfies',$1) returning id",[selfie]);
const now=(await row('select clock_timestamp()::text as time')).time;
const issueArgs=[cashId,reference.id,object.id,selfie,'b'.repeat(64),'morning',-6.2,106.8,10,now,now,'Fiktif Uji Identitas'];
const issueSQL='select * from public.biometric_issue_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)';
await asUser(cashAuth);
await denied(issueSQL,issueArgs,'permission denied');
await asUser('', 'service_role');
await denied(issueSQL,[...issueArgs.slice(0,2),'ffffffff-ffff-ffff-ffff-ffffffffffff',...issueArgs.slice(3)],'belum terverifikasi');
const receipt=await row(issueSQL,issueArgs);
await asUser(cashAuth);
assert.equal((await db.query("delete from storage.objects where name=$1 returning id",[selfie])).rows.length,0,'live receipt prevents upload cleanup');
const verifiedSQL='select to_jsonb(public.attendance_clock_in_verified($1,$2,$3,$4,$5,$6,$7,$8,$9)) as attendance';
const args=['morning',-6.2,106.8,10,selfie,now,'Fiktif Uji Identitas',now,receipt.id];
await denied(verifiedSQL,[...args.slice(0,2),106.80001,...args.slice(3)],'Data absensi berubah');
await asUser(otherAuth);
await denied(verifiedSQL,args,'telah berakhir');
await db.exec('reset role');
await db.query("update private.biometric_receipts set expires_at=clock_timestamp()-interval '1 second' where id=$1",[receipt.id]);
await asUser(cashAuth);
await denied(verifiedSQL,args,'telah berakhir');
await db.exec('reset role');
await db.query("update private.biometric_receipts set expires_at=clock_timestamp()+interval '1 minute' where id=$1",[receipt.id]);
await db.query("update public.biometric_references set status='revoked' where id=$1",[reference.id]);
await asUser(cashAuth);await denied(verifiedSQL,args,'referensi selfie berubah');
await db.exec('reset role');await db.query("update public.biometric_references set status='approved' where id=$1",[reference.id]);
await asUser(cashAuth);
const attendance=(await row(verifiedSQL,args)).attendance;
assert.equal(attendance.biometric_reference_id,reference.id);assert.equal(attendance.selfie_sha256,'b'.repeat(64));assert.equal(attendance.biometric_model_id,'face-api-1.7.15-v1');
await denied(verifiedSQL,args,'telah berakhir');
assert.equal((await db.query("delete from storage.objects where name=$1 returning id",[selfie])).rows.length,0,'committed attendance preserves evidence');
await denied('select public.attendance_clock_out_fresh(-6.2,106.8,10,clock_timestamp()-interval \'2 minutes\')',[],'terlalu lama');
await db.query('select public.attendance_clock_out_fresh(-6.2,106.8,10,clock_timestamp())');
// Upload staging survives a failed/ambiguous enrollment without deleting a
// committed reference. Only unlinked, grace-expired paths become worker cleanup.
const stagedPath=cashAuth+'/staged-reference.jpg',failedPath=cashAuth+'/failed-reference.jpg';
await asUser('', 'service_role');
await db.query('select public.biometric_stage_reference($1,$2)',[cashId,stagedPath]);
await db.query('select public.biometric_stage_reference($1,$2)',[cashId,failedPath]);
assert.equal((await db.query('select * from public.biometric_cleanup_claim()')).rows.length,0,'new uploads receive a grace period');
await db.exec('reset role');
await db.query("insert into storage.objects(bucket_id,name) values('biometric-references',$1),('biometric-references',$2)",[stagedPath,failedPath]);
await asUser('', 'service_role');
await db.query('select public.biometric_enroll_server($1,$2,$3,$4)',[cashId,stagedPath,'c'.repeat(64),Array(128).fill(0)]);
await denied('select public.biometric_enroll_server($1,$2,$3,$4)',[cashId,failedPath,'d'.repeat(64),Array(128).fill(0)],'biometric_one_pending');
await db.exec('reset role');
assert.equal((await row('select count(*)::int as n from private.biometric_cleanup where image_path=$1',[stagedPath])).n,0,'committed material removes its staged cleanup atomically');
assert.equal((await row('select count(*)::int as n from private.biometric_cleanup where image_path=$1',[failedPath])).n,1,'failed enrollment leaves orphan cleanup queued');
await db.query("update private.biometric_cleanup set not_before=clock_timestamp()-interval '1 second' where image_path=$1",[failedPath]);
await asUser('', 'service_role');
assert.deepEqual((await db.query('select * from public.biometric_cleanup_claim()')).rows,[{image_path:failedPath}]);
await asUser(cashAuth);
await db.query('select public.biometric_withdraw()');
await db.exec('reset role');
assert.equal((await row('select count(*)::int as n from private.biometric_material where reference_id=$1',[reference.id])).n,0,'withdraw deletes descriptor immediately');
assert.equal((await row('select status from public.biometric_references where id=$1',[reference.id])).status,'revoked');
console.log('Biometric security OK: no legacy bypass, no descriptor access/self-approval, exact object/reference/data binding, fresh location, single-use receipt, immutable evidence and consent withdrawal');

const endpoint='https://fcm.googleapis.com/fcm/send/fictional-test-only',key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,7)]).toString('base64url'),auth=Buffer.alloc(16,2).toString('base64url');
await asUser(cashAuth);
await denied('select public.push_subscribe($1,$2,$3,$4)',['https://127.0.0.1/test',key,auth,'Fiktif'],'tidak valid');
await db.query('select public.push_subscribe($1,$2,$3,$4)',[endpoint,key,auth,'Perangkat Fiktif']);
await denied('select * from private.push_subscriptions',[],'permission denied');
await denied('select * from public.push_claim(10)',[],'permission denied');
const pushStatusSQL='select public.push_subscription_status($1) as active';
assert.equal((await row(pushStatusSQL,[endpoint])).active,true,'own active endpoint is registered');
assert.equal((await row(pushStatusSQL,[endpoint+'-missing'])).active,false,'missing endpoint is not registered');
assert.equal((await row(pushStatusSQL,[null])).active,false,'null endpoint is not registered');
await asUser(otherAuth);
assert.equal((await row(pushStatusSQL,[endpoint])).active,false,'another account cannot inspect endpoint ownership');
await asUser('', 'anon');
await denied(pushStatusSQL,[endpoint],'permission denied');
await db.exec('reset role');
for(const role of['anon','service_role'])assert.equal((await row("select has_function_privilege($1,'public.push_subscription_status(text)','EXECUTE') as allowed",[role])).allowed,false,role+' cannot execute status lookup');
assert.equal((await row("select has_table_privilege('authenticated','private.push_subscriptions','SELECT') as allowed")).allowed,false,'status lookup does not grant direct private table access');
const statusFunction=await row("select prosecdef,provolatile,proconfig from pg_proc where oid='public.push_subscription_status(text)'::regprocedure");
assert.equal(statusFunction.prosecdef,true);assert.equal(statusFunction.provolatile,'s');assert.deepEqual(statusFunction.proconfig,['search_path=""']);
for(const[column,value]of[['status','inactive'],['account_status','disabled']]) {
  await db.query('update public.employees set '+column+'=$1 where id=$2',[value,cashId]);
  await asUser(cashAuth);
  await denied(pushStatusSQL,[endpoint],'Akun karyawan tidak aktif');
  await db.exec('reset role');
  await db.query('update public.employees set '+column+"='active' where id=$1",[cashId]);
}
await asUser(cashAuth);
await db.query('select public.push_unsubscribe($1)',[endpoint]);
assert.equal((await row(pushStatusSQL,[endpoint])).active,false,'disabled own endpoint is not registered');
await db.query('select public.push_subscribe($1,$2,$3,$4)',[endpoint,key,auth,'Perangkat Fiktif']);
assert.equal((await row(pushStatusSQL,[endpoint])).active,true,'explicit opt-in restores registration state');
await db.exec('reset role');
const notif=await row("insert into public.notifications(employee_id,entity_id,entity_type,title,body,href) values($1,$2::uuid,'attendance_reminder','Uji','Rincian hanya di aplikasi','/attendance?record='||$2::uuid::text) returning id",[cashId,attendance.id]);
assert.equal((await row('select count(*)::int as n from private.push_outbox where notification_id=$1',[notif.id])).n,1);
await asUser('', 'service_role');
let claims=(await db.query('select * from public.push_claim(10)')).rows;assert.equal(claims.length,1);
assert.equal((await db.query('select * from public.push_claim(10)')).rows.length,0,'concurrent wake cannot claim leased item twice');
await db.query('select public.push_complete($1,$2,201)',[claims[0].id,'ffffffff-ffff-ffff-ffff-ffffffffffff']);
await db.exec('reset role');assert.equal((await row('select delivered_at from private.push_outbox where id=$1',[claims[0].id])).delivered_at,null,'wrong lease cannot complete another delivery');
await asUser('', 'service_role');await db.query('select public.push_complete($1,$2,503)',[claims[0].id,claims[0].lease_token]);
await db.exec('reset role');
const retry=await row('select attempts,delivered_at,lease_token,next_attempt_at>now() as delayed from private.push_outbox where id=$1',[claims[0].id]);assert.equal(retry.attempts,1);assert.equal(retry.delayed,true);assert.equal(retry.lease_token,null);
await db.query("update private.push_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",[claims[0].id]);
await asUser('', 'service_role');claims=(await db.query('select * from public.push_claim(10)')).rows;
await db.query('select public.push_complete($1,$2,410)',[claims[0].id,claims[0].lease_token]);
await db.exec('reset role');assert.ok((await row('select disabled_at from private.push_subscriptions where endpoint=$1',[endpoint])).disabled_at,'410 disables invalid subscription');
await asUser(cashAuth);assert.equal((await row(pushStatusSQL,[endpoint])).active,false,'worker-disabled endpoint is reported inactive');
await asUser(cashAuth);await db.query('select public.push_subscribe($1,$2,$3,$4)',[endpoint,key,auth,'Fiktif']);
await db.exec('reset role');
const notif2=await row("insert into public.notifications(employee_id,entity_id,entity_type,title,body,href) values($1,$2::uuid,'attendance_reminder','Uji','Rahasia','/attendance?record='||$2::uuid::text) returning id",[cashId,attendance.id]);
await asUser(cashAuth);await db.query('select public.notifications_mark_read($1)',[notif2.id]);
await asUser('', 'service_role');assert.equal((await db.query('select * from public.push_claim(10)')).rows.length,0,'read inbox items are not pushed');
await asUser(otherAuth);await db.query('select public.push_subscribe($1,$2,$3,$4)',[endpoint,key,auth,'Browser bersama']);
await db.exec('reset role');assert.equal((await row('select employee_id from private.push_subscriptions where endpoint=$1',[endpoint])).employee_id,otherId,'browser endpoint rebinds to current account');
assert.equal((await row('select count(*)::int as n from private.push_outbox')).n,0,'old account queue is cleared on browser rebind');
await asUser(cashAuth);assert.equal((await row(pushStatusSQL,[endpoint])).active,false,'previous browser account sees no active registration after rebind');
await asUser(otherAuth);assert.equal((await row(pushStatusSQL,[endpoint])).active,true,'current browser account sees its own active registration after rebind');
console.log('Push security OK: own active status only, inactive/anonymous denial, private grants, opt-in ownership, SSRF allowlist, private keys, durable trigger, exclusive lease, authenticated result binding, retry, 410 disable, read suppression and shared-browser isolation');
await db.close();
