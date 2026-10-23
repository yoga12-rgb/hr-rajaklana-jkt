import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{ console.error(error.message, error.code ?? '', error.detail ?? ''); process.exit(1); });
const root = new URL('../../', import.meta.url);
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage; create schema extensions;
  create table auth.users(id uuid primary key, email text unique, updated_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true); $$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema public,auth,storage to authenticated,service_role;
  grant select,insert,update,delete on storage.objects to authenticated;
  alter default privileges in schema public revoke all on tables from service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/'); $$;
  create publication supabase_realtime;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key);
`);
const migrations = (await readdir(new URL('supabase/migrations/', root))).filter(file=>file.endsWith('.sql')).sort();
for (const name of migrations) {
  let sql = await readFile(new URL(`supabase/migrations/${name}`, root),'utf8');
  sql = sql.replace('create extension if not exists pgcrypto with schema extensions;', '');
  await db.exec(sql);
  await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[name.slice(0,name.indexOf('_'))]);
}
await db.exec(`
  insert into auth.users(id,email) values('10000000-0000-4000-8000-000000000001','admin-fixture@example.invalid'),('10000000-0000-4000-8000-000000000002','subject-fixture@example.invalid');
  insert into public.outlets(name) values('Readiness fixture');
  insert into public.employees(full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,auth_user_id)
  select 'Admin readiness','081200001',p.department_id,p.id,o.id,'2020-01-01','active','10000000-0000-4000-8000-000000000001'
  from public.positions p cross join public.outlets o limit 1;
  insert into public.employees(full_name,whatsapp,department_id,position_id,outlet_id,starts_on,account_status,auth_user_id)
  select 'Subject readiness','081200002',p.department_id,p.id,o.id,'2020-01-01','active','10000000-0000-4000-8000-000000000002'
  from public.positions p cross join public.outlets o limit 1;
  insert into public.employee_roles(employee_id,role)
  select e.id,r.role from public.employees e cross join (values('employee'),('admin_hr')) as r(role) where e.full_name='Admin readiness';
  insert into public.employee_roles(employee_id,role) select id,'employee' from public.employees where full_name='Subject readiness';
`);
const script = await readFile(new URL('supabase/deployment/verify-readiness-preview.sql',root),'utf8');
const snapshot = async () => (await db.query(`select jsonb_build_object(
  'employees',(select jsonb_agg(to_jsonb(e) order by id) from public.employees e),
  'roles',(select jsonb_agg(to_jsonb(r) order by employee_id,role) from public.employee_roles r),
  'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a),
  'followups',(select jsonb_agg(to_jsonb(f) order by id) from public.spv_followups f),
  'tokens',(select jsonb_agg(to_jsonb(t) order by id) from public.account_tokens t),
  'notifications',(select jsonb_agg(to_jsonb(n) order by id) from public.notifications n)
) as snapshot`)).rows[0].snapshot;
const before = await snapshot();
await db.exec(script);
assert.deepEqual(await snapshot(),before,'all fixture state must be byte-equivalent after mandatory rollback');
await db.exec(script);
assert.deepEqual(await snapshot(),before,'repeated probe must remain side-effect-free');
await db.query("update public.employees set account_status='disabled' where full_name='Subject readiness'");
const failBefore = await snapshot();
await assert.rejects(db.exec(script), /No unlocked safe linked nonadmin fixture/);
assert.deepEqual(await snapshot(),failBefore,'fail-closed path must leave all fixture state intact');
console.log('PASS: probe twice, full-state rollback equality, and missing-safe-fixture fail-closed');
await db.close();
