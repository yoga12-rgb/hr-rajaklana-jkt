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
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$2,false)", ['10000000-0000-4000-8000-000000000001', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', role: 'authenticated', aal: 'aal1', session_id: '20000000-0000-4000-8000-000000000001' })]);
  await db.exec('set role authenticated');
  assert.deepEqual((await scalar('select public.auth_access_context() as value')).value, { employee_id: employee, requires_mfa: false, current_level: 'aal1', allowed: true, reason: null });
  assert.equal((await db.query('select id from public.employees')).rows.length, 1, 'valid password-only HR session retains its scoped employee read');
  await assert.rejects(db.query('select public.auth_mfa_recovery_authorize(null,null,\'retired feature\')'), /permission denied|hentikan/);
  await db.exec('reset role');
  // A legacy aal2 claim remains compatible with a live session, and factor
  // presence/absence is no longer an authorization input after retirement.
  await db.query("update auth.sessions set not_after=null,aal='aal2' where id='20000000-0000-4000-8000-000000000001'");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:'10000000-0000-4000-8000-000000000001', role:'authenticated', aal:'aal2', session_id:'20000000-0000-4000-8000-000000000001' })]);
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
  await probeRejects(/actor\/HR helper chain/, 'probe rejects constant-true session_allowed helper');
  await db.exec(originalSessionAllowedDefinition);

  await db.query("update supabase_migrations.schema_migrations set name='wrong_foundation' where version=(select min(version) from supabase_migrations.schema_migrations)");
  await probeRejects(/ordered 26-name contract/, 'probe rejects a wrong migration name with the same count');
  await db.query("update supabase_migrations.schema_migrations set name='hr_foundation' where version=(select min(version) from supabase_migrations.schema_migrations)");

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
