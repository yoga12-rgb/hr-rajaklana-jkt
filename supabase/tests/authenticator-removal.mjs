// Final password-only contract test. This intentionally uses a fresh PGlite
// catalog and executes every migration; the historical MFA harness remains a
// bounded baseline25 artifact and is not used as proof for migration26+.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const migrationDir = new URL('../migrations/', import.meta.url);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text unique,updated_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),factor_id uuid,aal text,not_after timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users(id),status text,factor_type text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select on auth.sessions to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    create publication supabase_realtime;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text);
  `);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, migrationDir), 'utf8')).replace('create extension if not exists pgcrypto with schema extensions;', '');
    await db.exec(sql);
    await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)', [name.slice(0, name.indexOf('_')), name.slice(name.indexOf('_') + 1, -4)]);
  }
  const probe = await readFile(new URL('../deployment/verify-authenticator-removed-preview.sql', import.meta.url), 'utf8');
  await db.exec(probe);
  await db.exec(`
    create table public.__auth_fixture_marker(id uuid primary key);
    insert into auth.users(id,email) values('10000000-0000-4000-8000-000000000001','fixture@example.invalid');
    insert into auth.users(id,email) values('10000000-0000-4000-8000-000000000002','fixture-b@example.invalid');
    insert into auth.sessions(id,user_id,aal) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aal1');
    insert into auth.sessions(id,user_id,aal) values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','aal1');
  `);
  const dep = (await scalar("insert into public.departments(name) values('Final fixture') returning id")).id;
  const pos = (await scalar("insert into public.positions(name,department_id,is_cashier) values('Final fixture',$1,false) returning id", [dep])).id;
  const outlet = (await scalar("insert into public.outlets(name) values('Final fixture') returning id", [])).id;
  const employee = (await scalar(`insert into public.employees(auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status)
    values('10000000-0000-4000-8000-000000000001','Final fixture','081200000000',$1,$2,$3,'2025-01-01','active') returning id`, [dep, pos, outlet])).id;
  await db.query('insert into public.employee_roles(employee_id,role) values($1,$2)', [employee, 'admin_hr']);
  const employeeB = (await scalar(`insert into public.employees(auth_user_id,full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status)
    values('10000000-0000-4000-8000-000000000002','Fixture akun B','081200000001',$1,$2,$3,'2025-01-01','active') returning id`, [dep, pos, outlet])).id;
  await db.query("insert into public.employee_roles(employee_id,role) values($1,'employee')", [employeeB]);
  const ownUnusedId = '40000000-0000-4000-8000-000000000001';
  const referencedId = '40000000-0000-4000-8000-000000000002';
  const otherUserId = '40000000-0000-4000-8000-000000000003';
  const storageAuthId = '10000000-0000-4000-8000-000000000002';
  const storageSessionId = '20000000-0000-4000-8000-000000000002';
  const otherAuthId = '10000000-0000-4000-8000-000000000001';
  const ownUnusedPath = `${storageAuthId}/sec31-unused.jpg`;
  const referencedPath = `${storageAuthId}/sec31-referenced.jpg`;
  const otherUserPath = `${otherAuthId}/sec31-other.jpg`;
  await db.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3),($4,$2,$5),($6,$2,$7)',
    [ownUnusedId, 'attendance-selfies', ownUnusedPath, referencedId, referencedPath, otherUserId, otherUserPath]);
  await db.query(`insert into public.attendance(employee_id,outlet_id,work_date,shift,expected_out,morning_starts_at,afternoon_starts_at,tolerance_minutes,
    outlet_latitude,outlet_longitude,radius_m,clock_in,in_latitude,in_longitude,in_accuracy_m,in_distance_m,selfie_path,selfie_captured_at,selfie_outlet_name)
    values($1,$2,'2026-10-31','morning',now()+interval '8 hours','07:00','15:00',10,0,0,500,now(),0,0,10,0,$3,now(),'Fixture')`,
    [employeeB, outlet, referencedPath]);
  const setAuthSession = async (userId, sessionId, overrides = {}) => {
    await db.exec('reset role');
    const claims = { sub: userId, role: 'authenticated', aal: 'aal1', ...overrides };
    if (sessionId !== undefined) claims.session_id = sessionId;
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$2,false)", [userId, JSON.stringify(claims)]);
    await db.exec('set role authenticated');
  };
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$2,false)", ['10000000-0000-4000-8000-000000000001', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', role: 'authenticated', aal: 'aal1', session_id: '20000000-0000-4000-8000-000000000001' })]);
  await db.exec('set role authenticated');
  assert.deepEqual((await scalar('select public.auth_access_context() as value')).value, { employee_id: employee, requires_mfa: false, current_level: 'aal1', allowed: true, reason: null });
  assert.equal((await db.query('select id from public.employees')).rows.length, 2, 'valid password-only HR session retains its scoped employee read');
  await assert.rejects(db.query('select public.auth_mfa_recovery_authorize(null,null,\'retired feature\')'), /permission denied|hentikan/);

  await setAuthSession(storageAuthId, storageSessionId);
  assert.equal((await db.query('select id from storage.objects where id=$1', [ownUnusedId])).rows.length, 1, 'final26 aal1 without a factor can read its own selfie');
  assert.equal((await db.query('select id from storage.objects where id=$1', [otherUserId])).rows.length, 0, 'another account selfie remains unreadable');
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['attendance-selfies', `${storageAuthId}/sec31-upload.jpg`]);
  await db.query('delete from storage.objects where id=$1', [otherUserId]);
  await db.exec('reset role');
  assert.equal((await scalar('select count(*)::int as count from storage.objects where id=$1', [otherUserId])).count, 1, 'valid account cannot delete another account selfie');
  await setAuthSession(storageAuthId, storageSessionId);
  await db.query('delete from storage.objects where id=$1', [ownUnusedId]);
  assert.equal((await scalar('select count(*)::int as count from storage.objects where id=$1', [ownUnusedId])).count, 0, 'valid owner can clean its own unused selfie');
  await db.query('delete from storage.objects where id=$1', [referencedId]);
  assert.equal((await scalar('select count(*)::int as count from storage.objects where id=$1', [referencedId])).count, 1, 'referenced attendance evidence stays immutable');
  const freshUnusedId = '40000000-0000-4000-8000-000000000004';
  const freshUnusedPath = `${storageAuthId}/sec31-denied-delete.jpg`;
  await db.exec('reset role');
  await db.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)', [freshUnusedId, 'attendance-selfies', freshUnusedPath]);
  const assertDeniedStorage = async (label, changeBefore = async () => {}, restoreAfter = async () => {}, sessionId = '20000000-0000-4000-8000-000000000001') => {
    await changeBefore();
    const before = (await scalar('select count(*)::int as count from storage.objects')).count;
    await setAuthSession(storageAuthId, sessionId === 'omit' ? undefined : sessionId);
    assert.equal((await db.query('select id from storage.objects')).rows.length, 0, `${label}: revoked session cannot SELECT Storage`);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',
      ['attendance-selfies', `${storageAuthId}/${crypto.randomUUID()}.jpg`]), /row-level security/i, `${label}: revoked session cannot INSERT Storage`);
    await db.query('delete from storage.objects');
    await db.exec('reset role');
    assert.equal((await scalar('select count(*)::int as count from storage.objects')).count, before, `${label}: DELETE without WHERE/RETURNING leaves all objects unchanged`);
    assert.equal((await scalar('select count(*)::int as count from storage.objects where id=$1', [freshUnusedId])).count, 1, `${label}: exact target evidence remains`);
    await restoreAfter();
  };
  await assertDeniedStorage('missing session_id', async () => {}, async () => {}, 'omit');
  await assertDeniedStorage('malformed session_id', async () => {}, async () => {}, 'not-a-uuid');
  await assertDeniedStorage('real session belongs to another Auth user', async () => {}, async () => {}, '20000000-0000-4000-8000-000000000001');
  await assertDeniedStorage('expired session',
    () => db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1', [storageSessionId]),
    () => db.query('update auth.sessions set not_after=null where id=$1', [storageSessionId]));
  await assertDeniedStorage('revoked session row',
    () => db.query('delete from auth.sessions where id=$1', [storageSessionId]),
    () => db.query('insert into auth.sessions(id,user_id,aal) values($1,$2,\'aal1\')', [storageSessionId, storageAuthId]));
  await assertDeniedStorage('inactive employee',
    () => db.query('update public.employees set status=\'inactive\' where id=$1', [employeeB]),
    () => db.query('update public.employees set status=\'active\' where id=$1', [employeeB]));
  await assertDeniedStorage('disabled account',
    () => db.query('update public.employees set account_status=\'disabled\' where id=$1', [employeeB]),
    () => db.query('update public.employees set account_status=\'active\' where id=$1', [employeeB]));
  await setAuthSession(storageAuthId, storageSessionId);
  await db.query('delete from storage.objects where id=$1', [freshUnusedId]);
  assert.equal((await scalar('select count(*)::int as count from storage.objects where id=$1', [freshUnusedId])).count, 0, 'restored valid session regains legitimate unused-photo cleanup');
  await db.exec('reset role');
  // A legacy aal2 claim remains compatible with a live session, and factor
  // presence/absence is no longer an authorization input after retirement.
  await db.query("update auth.sessions set not_after=null,aal='aal2' where id='20000000-0000-4000-8000-000000000001'");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", ['10000000-0000-4000-8000-000000000001', JSON.stringify({ sub:'10000000-0000-4000-8000-000000000001', role:'authenticated', aal:'aal2', session_id:'20000000-0000-4000-8000-000000000001' })]);
  await db.exec('set role authenticated');
  assert.equal((await scalar('select public.auth_access_context() as value')).value.allowed, true, 'legacy aal2 session remains valid without a factor');
  await db.exec('reset role');
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','unverified','totp')");
  await db.query("delete from auth.mfa_factors where id='30000000-0000-4000-8000-000000000001'");
  await db.exec('set role authenticated');
  assert.equal((await scalar('select public.auth_access_context() as value')).value.allowed, true, 'deleting a factor does not revoke an otherwise live password session');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:'10000000-0000-4000-8000-000000000001', role:'authenticated', aal:'aal1', session_id:'not-a-uuid' })]);
  assert.equal((await scalar('select public.auth_access_context() as value')).value.reason, 'session_revoked', 'malformed session id fails closed');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:'10000000-0000-4000-8000-000000000001', role:'authenticated', aal:'aal1', session_id:'20000000-0000-0000-0000-000000000099' })]);
  assert.equal((await scalar('select public.auth_access_context() as value')).value.reason, 'session_revoked', 'session/user mismatch fails closed');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:'10000000-0000-4000-8000-000000000001', role:'authenticated', aal:'aal1', session_id:'20000000-0000-4000-8000-000000000002' })]);
  await db.exec('reset role');
  assert.equal((await scalar('select user_id from auth.sessions where id=(current_setting(\'request.jwt.claims\',true)::jsonb->>\'session_id\')::uuid')).user_id,'10000000-0000-4000-8000-000000000002',
    'mismatch fixture must point at a real session owned by a different Auth user');
  await db.exec('set role authenticated');
  assert.equal((await scalar('select public.auth_access_context() as value')).value.reason,'session_revoked','real cross-user session binding fails closed');
  await db.exec('reset role');
  await db.query("update auth.sessions set not_after=now()-interval '1 second' where id='20000000-0000-4000-8000-000000000001'");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:'10000000-0000-4000-8000-000000000001', role:'authenticated', aal:'aal1', session_id:'20000000-0000-4000-8000-000000000001' })]);
  await db.exec('set role authenticated');
  assert.equal((await scalar('select public.auth_access_context() as value')).value.reason, 'session_revoked');
  await db.exec('reset role');
  await db.exec(probe);
  const probeRejects = async (pattern, label) => {
    await assert.rejects(db.exec(probe), pattern, label);
    // A failed DO block aborts the read-only transaction; make the fixture
    // reusable before restoring the isolated mutation.
    await db.exec('rollback').catch(() => undefined);
  };
  await db.exec('grant insert on table public.shift_handovers to authenticated');
  await probeRejects(/sensitive operational ACL/, 'probe rejects an authenticated direct INSERT grant');
  await db.exec('revoke insert on table public.shift_handovers from authenticated');

  await db.exec('drop policy privileged_mfa_session on public.employees');
  await probeRejects(/restrictive live-session policy missing or weakened on employees/, 'probe rejects a missing employees policy');
  await db.exec('create policy privileged_mfa_session on public.employees as restrictive to authenticated using ((select private.session_allowed())) with check ((select private.session_allowed()))');

  await db.exec('drop policy privileged_mfa_session on storage.objects');
  await db.exec('create policy privileged_mfa_session on storage.objects as restrictive to authenticated using (true) with check (true)');
  await probeRejects(/Storage restrictive live-session policy/, 'probe rejects an always-true Storage predicate');
  await db.exec('drop policy privileged_mfa_session on storage.objects');
  await db.exec('create policy privileged_mfa_session on storage.objects as restrictive to authenticated using ((select private.session_allowed())) with check ((select private.session_allowed()))');

  // Semantic policy bypasses must be rejected even when the live-session
  // helper name is retained in an always-allow expression.
  await db.exec('drop policy privileged_mfa_session on storage.objects');
  await db.exec('create policy privileged_mfa_session on storage.objects as restrictive to authenticated using ((select private.session_allowed()) or 1=1) with check ((select private.session_allowed()) or 1=1)');
  await probeRejects(/Storage restrictive live-session policy/, 'probe rejects Storage OR 1=1 bypass');
  await db.exec('drop policy privileged_mfa_session on storage.objects');
  await db.exec('create policy privileged_mfa_session on storage.objects as restrictive to authenticated using ((select private.session_allowed())) with check ((select private.session_allowed()))');

  // Command/role shape is part of the contract; an UPDATE-only policy is not
  // equivalent to the all-command restrictive guard.
  await db.exec('drop policy privileged_mfa_session on public.employees');
  await db.exec('create policy privileged_mfa_session on public.employees as restrictive for update to authenticated using ((select private.session_allowed())) with check ((select private.session_allowed()))');
  await probeRejects(/restrictive live-session policy missing or weakened on employees/, 'probe rejects UPDATE-only live-session policy');
  await db.exec('drop policy privileged_mfa_session on public.employees');
  await db.exec('create policy privileged_mfa_session on public.employees as restrictive to authenticated using ((select private.session_allowed())) with check ((select private.session_allowed()))');

  // Internal session helpers must not become a callable authenticated API.
  await db.exec('grant execute on function private.raw_employee_id() to authenticated');
  await probeRejects(/internal helper EXECUTE/, 'probe rejects authenticated raw helper grant');
  await db.exec('revoke execute on function private.raw_employee_id() from authenticated');

  // A helper body that returns a constant true is rejected even if its name
  // and SECURITY DEFINER/search_path metadata remain intact.
  const originalSessionAllowedDefinition = (await scalar("select pg_get_functiondef('private.session_allowed()'::regprocedure) as definition")).definition;
  await db.exec("create or replace function private.session_allowed() returns boolean language sql stable security definer set search_path='' as $$ select true $$");
  await probeRejects(/helper definition differs from independent reviewed contract: private\.session_allowed/, 'probe rejects constant-true session_allowed helper');
  await db.exec(originalSessionAllowedDefinition);

  const deniedContext = (await scalar('select public.auth_access_context() as value')).value;
  assert.equal(deniedContext.allowed, false, 'IS NOT NULL mutation is evaluated against a denied session context');
  const sessionAllowedMutations = [
    ['IS NOT NULL bypass', "select (private.session_access_context()->>'allowed')::boolean is not null;", true],
    ['negated allowed predicate', "select not ((private.session_access_context()->>'allowed')::boolean);", true],
    ['decoy comment around IS NOT NULL', "select ((private.session_access_context()->>'allowed')::boolean is not null) /* private.session_access_context() allowed ::boolean */;", true]
  ];
  for (const [label, source, unsafeResult] of sessionAllowedMutations) {
    await db.exec(`create or replace function private.session_allowed() returns boolean language sql stable security definer set search_path='' as $$ ${source} $$`);
    assert.equal((await scalar('select private.session_allowed() as allowed')).allowed, unsafeResult, `${label} must reproduce its unsafe/altered behavior under the denied fixture`);
    await probeRejects(/helper definition differs from independent reviewed contract: private\.session_allowed/, `probe rejects ${label}`);
    await db.exec(originalSessionAllowedDefinition);
    await db.exec(probe);
  }

  const originalContextDefinition = (await scalar("select pg_get_functiondef('private.session_access_context()'::regprocedure) as definition")).definition;
  const contextWithoutExpiry = originalContextDefinition.replace(/\(s\.not_after is null or s\.not_after>statement_timestamp\(\)\)/, 'true /* not_after */');
  assert.notEqual(contextWithoutExpiry, originalContextDefinition, 'expiry mutation fixture must change the real session predicate');
  await db.exec(contextWithoutExpiry);
  assert.equal((await scalar('select public.auth_access_context() as value')).value.allowed, true, 'expiry removal with a decoy token reproduces the lost session guard');
  await probeRejects(/helper definition differs from independent reviewed contract: private\.session_access_context/, 'probe rejects expiry removal despite a not_after decoy comment');
  await db.exec(originalContextDefinition);
  await db.exec(probe);

  const originalRequireHrDefinition = (await scalar("select pg_get_functiondef('private.require_hr()'::regprocedure) as definition")).definition;
  await db.exec(`create or replace function private.require_hr() returns uuid language plpgsql stable security definer set search_path='' as $$
    declare v_actor uuid:=private.require_employee(); begin
      -- private.has_role('admin_hr') is a decoy comment; the actual guard was removed.
      return v_actor;
    end;
  $$`);
  await db.query("update auth.sessions set not_after=null where id='20000000-0000-4000-8000-000000000001'");
  await db.query("delete from public.employee_roles where employee_id=$1 and role='admin_hr'", [employee]);
  assert.equal((await scalar('select private.require_hr() as actor')).actor, employee, 'decoy comment does not protect an actually weakened HR helper');
  await probeRejects(/helper definition differs from independent reviewed contract: private\.require_hr/, 'probe rejects a require_hr decoy with its role guard removed');
  await db.exec(originalRequireHrDefinition);
  await db.query("insert into public.employee_roles(employee_id,role) values($1,'admin_hr')", [employee]);
  await db.exec(probe);

  await db.query("update supabase_migrations.schema_migrations set name='wrong_foundation' where version=(select min(version) from supabase_migrations.schema_migrations)");
  await probeRejects(/ordered 26-name contract/, 'probe rejects a wrong migration name with the same count');
  await db.query("update supabase_migrations.schema_migrations set name='hr_foundation' where version=(select min(version) from supabase_migrations.schema_migrations)");

  const secondHistory = await scalar('select version,name from supabase_migrations.schema_migrations order by version offset 1 limit 1');
  await db.query('update supabase_migrations.schema_migrations set version=$1 where version=$2', [`${secondHistory.version}.5`, secondHistory.version]);
  await probeRejects(/ordered version-name contract/, 'probe rejects a changed version when the migration-name ordering is unchanged');
  await db.query('update supabase_migrations.schema_migrations set version=$1 where version=$2', [secondHistory.version, `${secondHistory.version}.5`]);
  await db.exec(probe);

  await db.exec('grant execute on function public.auth_mfa_recovery_authorize(uuid,uuid,text) to public');
  await probeRejects(/retired recovery function is executable/, 'probe rejects an inherited PUBLIC recovery grant');
  await db.exec('revoke execute on function public.auth_mfa_recovery_authorize(uuid,uuid,text) from public');

  await db.exec('alter table public.employees disable row level security');
  await probeRejects(/public table\/RLS missing: employees/, 'probe rejects disabled employees RLS');
  await db.exec('alter table public.employees enable row level security');
  await db.exec(probe);
  console.log('Authenticator removal mutation gates OK: ACL, policy, Storage, ordered history, inherited PUBLIC grant and disabled RLS are all rejected and restored');
  console.log('Authenticator removal LOCAL OK: migration26, password-only aal1 fixture without factor, live-session revocation, tombstoned recovery RPCs, restrictive Storage policy and history preservation');
} finally {
  await db.close();
}
