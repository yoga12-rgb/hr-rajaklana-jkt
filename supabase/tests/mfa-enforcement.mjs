// Executes every source migration against isolated Postgres. Auth state is a
// small platform fixture; JWT claims below are trusted fixture values only.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db=new PGlite();
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
try {
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create schema extensions;
    create table auth.users(id uuid primary key,email text unique,updated_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),factor_id uuid,aal text,not_after timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users(id),status text,factor_type text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    create publication supabase_realtime;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text);
    -- No network is used. This models the managed extension's default PUBLIC
    -- function grants, including an owner-only routine that must stay private.
    create schema net;
    grant usage on schema net to public;
    create table net.fixture_requests(id bigint generated always as identity primary key,timeout integer);
    create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 2000)
    returns bigint language plpgsql security definer set search_path='' as $$
      declare v_id bigint;begin insert into net.fixture_requests(timeout) values(timeout_milliseconds) returning id into v_id;return v_id;end;
    $$;
    create function net.worker_restart() returns boolean language sql as $$select true$$;
    create function net.owner_only() returns boolean language sql as $$select true$$;
    revoke all on function net.owner_only() from public,anon,authenticated,service_role;
  `);
  const migrationDir=new URL('../migrations/',import.meta.url);
  const historical25Version='20261027090100';
  const historical25Migrations=(await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()
    .filter(n=>n.slice(0,n.indexOf('_')) <= historical25Version);
  assert.equal(historical25Migrations.at(-1)?.slice(0,historical25Migrations.at(-1).indexOf('_')),historical25Version,
    'historical MFA harness must stop exactly at migration25 before retirement migration26');
  for (const name of historical25Migrations) {
    const sql=(await readFile(new URL(name,migrationDir),'utf8')).replace('create extension if not exists pgcrypto with schema extensions;','');
    await db.exec(sql);
    await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[name.slice(0,name.indexOf('_')),name.slice(name.indexOf('_')+1,-4)]);
  }
  // Application migration25 intentionally cannot claim to restrict managed
  // extension objects it does not own. Keep that finding visible and test the
  // separate authorized operator procedure, including the refusal path.
  const catalogProbe=await readFile(new URL('../deployment/verify-mfa-readiness-preview.sql',import.meta.url),'utf8');
  await db.exec(catalogProbe);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    assert.equal((await scalar("select net.http_post('https://fixture.invalid') as id")).id>0,true,
      'baseline reproduces direct network execution through PUBLIC despite MFA catalog success');
    await db.exec('reset role');
  }
  await db.exec(`create role fixture_managed_owner;create role fixture_migration_actor;
    alter schema net owner to fixture_managed_owner;
    alter table net.fixture_requests owner to fixture_managed_owner;
    alter function net.http_post(text,jsonb,jsonb,jsonb,integer) owner to fixture_managed_owner;
    alter function net.worker_restart() owner to fixture_managed_owner;
    alter function net.owner_only() owner to fixture_managed_owner;`);
  const operator=await readFile(new URL('../deployment/restrict-network-extension-managed-owner.sql',import.meta.url),'utf8');
  const networkSnapshot=async()=>(await scalar(`select jsonb_build_object(
    'schema',(select nspacl::text from pg_namespace where nspname='net'),
    'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl::text) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net')
  ) as value`)).value;
  const beforeRefusal=await networkSnapshot();
  await db.exec('set role fixture_migration_actor');
  await assert.rejects(db.exec(operator),/Managed network owner required/);
  await db.exec('rollback;reset role');
  assert.deepEqual(await networkSnapshot(),beforeRefusal,'nonowner refusal leaves every extension ACL unchanged');
  const inventory=await readFile(new URL('../deployment/inspect-network-extension-access.sql',import.meta.url),'utf8');
  await db.exec(inventory);
  assert.deepEqual(await networkSnapshot(),beforeRefusal,'read-only inventory never changes grants');
  await db.exec(operator);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select net.http_post('https://fixture.invalid')"),/permission denied/);
    await assert.rejects(db.query('select net.worker_restart()'),/permission denied/);
    await db.exec('reset role');
    assert.equal((await scalar("select has_schema_privilege($1,'net','USAGE,CREATE') as allowed",[role])).allowed,false);
    assert.equal((await scalar("select has_function_privilege($1,'net.http_post(text,jsonb,jsonb,jsonb,integer)','EXECUTE') as allowed",[role])).allowed,false);
  }
  await db.exec('set role service_role');
  assert.equal((await scalar("select net.http_post('https://fixture.invalid') as id")).id>0,true,
    'previously effective service-role function/schema access is preserved');
  assert.equal((await scalar('select net.worker_restart() as allowed')).allowed,true);
  await assert.rejects(db.query('select net.owner_only()'),/permission denied/,
    'hardening does not give service access to previously private extension routines');
  await db.exec('reset role');
  const beforeWake=(await scalar('select count(*)::integer as count from net.fixture_requests')).count;
  await db.exec("insert into private.push_worker_config(singleton,url,wake_secret) values(true,'https://fixture.invalid','synthetic-fixture-not-a-secret')");
  await db.exec('select private.wake_push_worker()');
  assert.equal((await scalar('select count(*)::integer as count from net.fixture_requests')).count,beforeWake+1,
    'actual internal SECURITY DEFINER push wake still invokes its network dependency');
  await db.exec('delete from private.push_worker_config');
  console.log('Managed network operator LOCAL OK: baseline public execution reproduced, nonowner refused without ACL mutation, authorized operator denies anon/auth and retains service/internal wake; hosted execution remains OPEN');
  await db.exec(catalogProbe);
  await db.exec(catalogProbe);
  const rejectedProbe=async(pattern)=>{
    await assert.rejects(db.exec(catalogProbe),pattern);
    await db.exec('rollback');
  };
  const latestMigration=(await scalar('select version,name from supabase_migrations.schema_migrations order by version desc limit 1'));
  await db.query('update supabase_migrations.schema_migrations set name=$1 where version=$2',['unexpected_migration',latestMigration.version]);
  await rejectedProbe(/Expected exact ordered MFA Preview baseline 25/);
  await db.query('update supabase_migrations.schema_migrations set name=$1 where version=$2',[latestMigration.name,latestMigration.version]);
  await db.exec('grant insert on public.shift_handovers to authenticated');
  await rejectedProbe(/Operational ACL differs/);
  await db.exec('revoke insert on public.shift_handovers from authenticated');
  await db.exec('drop policy privileged_mfa_session on storage.objects');
  await rejectedProbe(/Storage restrictive MFA session policy/);
  await db.exec('create policy privileged_mfa_session on storage.objects as restrictive to authenticated using((select private.session_allowed())) with check((select private.session_allowed()))');
  await db.exec(catalogProbe);
  console.log('MFA catalog probe OK: exact ordered baseline25, safe repetition, missing policy/broad application grant/history drift refused; managed pg_net is separately inventoried');
  assert.equal((await scalar(`select count(*)::integer as missing from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and not exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polname='privileged_mfa_session' and not p.polpermissive)`)).missing,0,
    'all public RLS tables must have the restrictive MFA/session gate');
  const dep=(await scalar("insert into public.departments(name) values('MFA fixture') returning id")).id;
  const pos=(await scalar("insert into public.positions(name,department_id,is_cashier) values('Kasir MFA',$1,true) returning id",[dep])).id;
  const outlet=(await scalar("insert into public.outlets(name) values('Outlet MFA') returning id")).id;
  const people={};
  const createPerson=async(name,roles=['employee'])=>{
    const authId=crypto.randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)',[authId,`${authId}@fixture.invalid`]);
    const employee=(await scalar(`insert into public.employees(auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status)
      values($1,$2,'081234567890',$3,$4,$5,'2020-01-01','active') returning id`,[authId,name,dep,pos,outlet])).id;
    for(const role of roles) await db.query('insert into public.employee_roles(employee_id,role) values($1,$2)',[employee,role]);
    const session=crypto.randomUUID(),factor=crypto.randomUUID();
    await db.query("insert into auth.sessions(id,user_id,factor_id,aal) values($1,$2,$3,'aal2')",[session,authId,factor]);
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[factor,authId]);
    return {employee,authId,session,factor};
  };
  people.hr=await createPerson('Admin HR MFA',['employee','admin_hr']);
  people.otherHr=await createPerson('Admin HR MFA Kedua',['employee','admin_hr']);
  people.cashier=await createPerson('Kasir MFA');
  people.reporter=await createPerson('Pelapor MFA');
  people.supervisor=await createPerson('Supervisor MFA');
  people.baker=await createPerson('Head Baker MFA',['employee','head_baker']);
  people.approver=await createPerson('Pemberi Persetujuan MFA');
  await db.query('update public.employees set approver_employee_id=$1 where id=$2',[people.approver.employee,people.cashier.employee]);
  await db.query("insert into public.supervisor_capabilities(employee_id,capability,outlet_id,granted_by) values($1,'issue_report',$2,$3),($4,'summary_view',$2,$3)",
    [people.reporter.employee,outlet,people.hr.employee,people.supervisor.employee]);
  const as=async(person,aal='aal2',extra={})=>{
    await db.exec('reset role');
    const claims={sub:person?.authId??'',role:person?'authenticated':'anon',aal,session_id:person?.session,...extra};
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",
      [claims.sub,claims.role,JSON.stringify(claims)]);
    await db.exec(`set role ${claims.role}`);
  };
  const context=async()=> (await scalar('select public.auth_access_context() as value')).value;
  const denied=async(sql,args=[],pattern=/Verifikasi dua langkah|tidak berlaku|tidak aktif|permission denied|row-level security|Akses Admin HR|tidak memiliki akses|Id permintaan|Pemulihan MFA sendiri/)=>{
    await assert.rejects(db.query(sql,args),pattern);
  };

  // Reproduce the exact weak fallback: the existing unused issue-photo DELETE
  // policy checks auth.uid()/unreferenced status, not private.employee_id().
  // DELETE without WHERE/RETURNING isolates that policy from SELECT filtering.
  // This is a database-policy test, not evidence of a hosted Storage workflow.
  const issuePhoto=crypto.randomUUID(),issuePhotoPath=`${people.hr.authId}/mfa-unused-issue.jpg`;
  const seedIssuePhoto=()=>db.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)',
    [issuePhoto,'outlet-issue-photos',issuePhotoPath]);
  await seedIssuePhoto();
  await db.exec('drop policy privileged_mfa_session on storage.objects');
  await as(people.hr,'aal1');
  await db.query('delete from storage.objects');
  await db.exec('reset role');
  assert.equal((await scalar('select count(*)::integer as count from storage.objects where id=$1',[issuePhoto])).count,0,
    'without restrictive MFA policy, aal1 can pass the pre-existing unused-photo DELETE predicate');
  await db.exec('create policy privileged_mfa_session on storage.objects as restrictive to authenticated using((select private.session_allowed())) with check((select private.session_allowed()))');
  await seedIssuePhoto();
  await as(people.hr,'aal1');
  await db.query('delete from storage.objects');
  await db.exec('reset role');
  assert.equal((await scalar('select count(*)::integer as count from storage.objects where id=$1',[issuePhoto])).count,1,
    'restrictive MFA policy retains the exact own unused issue photo for privileged aal1');
  await as(people.hr,'aal2');
  await db.query('delete from storage.objects');
  await db.exec('reset role');
  assert.equal((await scalar('select count(*)::integer as count from storage.objects where id=$1',[issuePhoto])).count,0,
    'valid aal2 owner can still use the existing unused-photo DELETE predicate');

  await as(null);
  await denied('select public.auth_access_context()');
  for(const person of [people.hr,people.baker,people.approver,people.supervisor]) {
    await as(person,'aal1');
    assert.deepEqual(await context(),{employee_id:person.employee,requires_mfa:true,current_level:'aal1',allowed:false,reason:'mfa_required'});
    assert.equal((await db.query('select * from public.employees')).rows.length,0,'aal1 must not see privileged employee data');
    assert.equal((await db.query('select * from public.outlets')).rows.length,0,'MFA gate also covers broad master-data SELECT');
    await denied('select * from public.employee_directory()');
    await denied('select public.update_my_profile($1)',[{address:'Tidak boleh tersimpan'}]);
  }
  await as(people.hr,'aal1');
  await denied('select public.hr_set_roles($1,$2)',[people.cashier.employee,['employee','admin_hr']]);
  await denied('insert into public.departments(name) values($1)',['DML aal1 harus ditolak']);
  await denied('insert into storage.objects(bucket_id,name) values($1,$2)',['attendance-selfies',`${people.hr.authId}/${crypto.randomUUID()}.jpg`]);
  await as(people.hr,'aal2');
  assert.equal((await context()).allowed,true);
  await db.query('select public.update_my_profile($1)',[{address:'Profil dengan MFA terverifikasi'}]);
  await db.query('insert into public.departments(name) values($1)',['DML aal2 sesuai hak HR']);
  assert.ok((await db.query('select * from public.employees')).rows.length>=Object.keys(people).length);

  for(const person of [people.cashier,people.reporter]) {
    await as(person,'aal1');
    assert.equal((await context()).requires_mfa,false,'ordinary cashier and report-only capability do not force MFA');
    assert.equal((await context()).allowed,true);
    await db.query('select public.update_my_profile($1)',[{address:'Self service dengan password'}]);
    await denied('select public.hr_set_roles($1,$2)',[person.employee,['employee','admin_hr']]);
  }
  await as(people.cashier,'aal2',{user_metadata:{role:'admin_hr',aal:'aal2'}});
  await denied('select public.hr_set_roles($1,$2)',[people.cashier.employee,['employee','admin_hr']]);
  await as(people.hr,'aal1',{user_metadata:{aal:'aal2'}});
  assert.equal((await context()).reason,'mfa_required','user-editable metadata never supplies assurance');

  await db.exec('reset role');
  await db.query("update auth.sessions set aal='aal1',factor_id=null where id=$1",[people.hr.session]);
  await as(people.hr,'aal2');
  assert.equal((await context()).reason,'session_revoked','JWT aal2 must match live upgraded session');
  await denied('select public.update_my_profile($1)',[{}]);
  await db.exec('reset role');
  await db.query("update auth.sessions set aal='aal2',factor_id=$2 where id=$1",[people.hr.session,people.hr.factor]);
  await db.query("update auth.mfa_factors set status='unverified' where id=$1",[people.hr.factor]);
  await as(people.hr,'aal2');
  assert.equal((await context()).reason,'session_revoked','revoked/unverified factor immediately blocks an older aal2 JWT');
  await db.exec('reset role');
  await db.query("update auth.mfa_factors set status='verified' where id=$1",[people.hr.factor]);
  // A previously valid aal2 JWT must also lose Storage access as soon as its
  // verified factor is deleted, even though auth.sessions still exists.
  const revokedSelfie=crypto.randomUUID();
  await seedIssuePhoto();
  await db.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)',
    [revokedSelfie,'attendance-selfies',`${people.hr.authId}/mfa-revoked-selfie.jpg`]);
  await as(people.hr,'aal2');
  assert.equal((await db.query('select id from storage.objects where id=$1',[revokedSelfie])).rows.length,1,
    'verified aal2 owner can initially read its fixture selfie');
  await db.exec('reset role');
  await db.query('delete from auth.mfa_factors where id=$1',[people.hr.factor]);
  await as(people.hr,'aal2');
  assert.equal((await context()).reason,'session_revoked');
  assert.equal((await db.query('select id from storage.objects')).rows.length,0,
    'deleted factor prevents Storage reads by a still-unexpired old aal2 JWT');
  await db.query('delete from storage.objects');
  await db.exec('reset role');
  assert.equal((await scalar('select count(*)::integer as count from storage.objects where id=any($1::uuid[])',[[issuePhoto,revokedSelfie]])).count,2,
    'deleted factor prevents Storage DELETE and preserves both exact fixture objects');
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[people.hr.factor,people.hr.authId]);
  await as(people.hr,'aal2');
  await db.query('delete from storage.objects');
  await db.exec('reset role');
  assert.equal((await scalar('select count(*)::integer as count from storage.objects where id=any($1::uuid[])',[[issuePhoto,revokedSelfie]])).count,0,
    'restoring the local verified-factor fixture restores legitimate owner cleanup');
  console.log('Storage MFA regression OK: weak unused-photo fallback reproduced, aal1 DELETE denied/row retained, valid aal2 cleanup retained, deleted factor blocks old-JWT read and delete');
  await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[people.hr.session]);
  await as(people.hr,'aal2');
  assert.equal((await context()).reason,'session_revoked','expired session is not accepted');
  await db.exec('reset role');
  await db.query('update auth.sessions set not_after=null where id=$1',[people.hr.session]);
  await as(people.hr,'aal2',{session_id:people.cashier.session});
  assert.equal((await context()).reason,'session_revoked','session is bound to the actual auth uid');
  await as(people.hr,'aal2',{session_id:null});
  assert.equal((await context()).reason,'session_revoked','an absent session id is fail-closed');
  await as(people.hr,'aal2');
  assert.equal((await context()).allowed,true,'reload/retry uses the same verified session without granting a new role');

  await db.exec('reset role');
  await db.query("insert into public.supervisor_capabilities(employee_id,capability,outlet_id,granted_by) values($1,'issue_handle',$2,$3)",
    [people.reporter.employee,outlet,people.hr.employee]);
  await as(people.reporter,'aal1');
  assert.equal((await context()).reason,'mfa_required','granting a privileged capability immediately requires MFA without waiting for a JWT role refresh');
  await denied('select public.update_my_profile($1)',[{}]);
  await as(people.reporter,'aal2');
  assert.equal((await context()).allowed,true);

  await as(people.hr,'aal2');
  const request=crypto.randomUUID(),reason='Perangkat autentikator hilang dan identitas dikonfirmasi';
  const authorized=(await scalar('select public.auth_mfa_recovery_authorize($1,$2,$3) as value',[people.otherHr.employee,request,reason])).value;
  assert.deepEqual(authorized.factor_ids,[people.otherHr.factor]);
  await denied('select public.auth_mfa_recovery_authorize($1,$2,$3)',[people.hr.employee,crypto.randomUUID(),reason]);
  await denied('select public.auth_mfa_recovery_authorize($1,$2,$3)',[people.otherHr.employee,request,'Alasan berubah tidak boleh memutar ulang']);
  await denied('select public.auth_mfa_recovery_complete($1,true)',[request]);
  await db.exec('reset role');
  const addedFactor=crypto.randomUUID();
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[addedFactor,people.otherHr.authId]);
  await as(people.hr);
  const replay=(await scalar('select public.auth_mfa_recovery_authorize($1,$2,$3) as value',[people.otherHr.employee,request,reason])).value;
  assert.deepEqual(replay,authorized,'recovery retry retains the original immutable factor snapshot');
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
  await db.exec('set role service_role');
  const complete=(await scalar('select public.auth_mfa_recovery_complete($1,true) as value',[request])).value;
  assert.equal(complete.status,'completed');
  assert.deepEqual((await scalar('select public.auth_mfa_recovery_complete($1,false) as value',[request])).value,complete,'late failed retries cannot downgrade completed recovery');
  await as(people.hr);
  const completed=(await scalar('select public.auth_mfa_recovery_authorize($1,$2,$3) as value',[people.otherHr.employee,request,reason])).value;
  assert.equal(completed.status,'completed');
  assert.deepEqual(completed.factor_ids,[people.otherHr.factor],'completed recovery never sweeps a newly enrolled factor');
  assert.equal((await db.query("select * from public.audit_events where entity='auth_mfa' and after_data->>'request_id'=$1",[request])).rows.length,2,'authorization/completion are each audited once');
  await as(people.cashier,'aal2');
  await denied('select public.auth_mfa_recovery_authorize($1,$2,$3)',[people.otherHr.employee,crypto.randomUUID(),reason]);
  await as(people.hr,'aal1');
  await denied('select public.auth_mfa_recovery_authorize($1,$2,$3)',[people.otherHr.employee,crypto.randomUUID(),reason]);

  await db.exec('reset role');
  await db.query("update public.employees set status='inactive',account_status='disabled' where id=$1",[people.hr.employee]);
  await as(people.hr);
  assert.equal((await context()).reason,'inactive');
  assert.equal((await context()).employee_id,null);
  assert.equal((await db.query('select * from public.audit_events')).rows.length,0);
  await denied('select * from public.employee_directory()');
  console.log('MFA enforcement OK: privileged aal1 blocked by RPC/RLS/Storage, valid aal2 retains scope, cashier/report-only aal1 retained, metadata spoof denied, session/factor revocation bound, recovery snapshot/replay/audit protected');
} finally { await db.close(); }
