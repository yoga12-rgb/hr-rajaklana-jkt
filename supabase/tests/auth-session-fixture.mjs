// Test-only representation of managed Auth. No actual JWT, TOTP seed, or user
// data is used. Final fixtures are password-only (aal1, no factor); historical
// MFA tests opt in to aal2 explicitly so they cannot silently become the final
// product contract.
import { randomUUID } from 'node:crypto';
export async function installAuthSessionFixture(db) {
  await db.exec(`
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text,factor_type text);
    create table auth.sessions(id uuid primary key,user_id uuid,factor_id uuid,aal text,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
    $$;
  `);
}

export async function fixtureSession(db, userId, role = 'authenticated', aal = 'aal1', options = {}) {
  await db.exec('reset role');
  if (userId && role === 'authenticated') {
    const sessionId = options.sessionId ?? randomUUID();
    const factorId = options.factorId ?? randomUUID();
    if (aal === 'aal2') await db.query(`insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')
      on conflict(id) do update set status='verified',user_id=excluded.user_id`, [factorId, userId]);
    await db.query(`insert into auth.sessions(id,user_id,factor_id,aal,not_after) values($1,$2,$3,$4,null)
      on conflict(id) do update set user_id=excluded.user_id,aal=excluded.aal,factor_id=excluded.factor_id,not_after=null`, [sessionId, userId, aal === 'aal2' ? factorId : null, aal]);
    const claims = { sub:userId,role,aal,session_id:sessionId };
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)", [userId,role,JSON.stringify(claims)]);
    return { sessionId, factorId: aal === 'aal2' ? factorId : null };
  }
  const claims = { role };
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)", [userId,role,JSON.stringify(claims)]);
  return { sessionId: null, factorId: null };
}
