// Test-only representation of managed Auth. No actual JWT, TOTP seed, or user
// data is used. Business fixtures explicitly select an already verified session;
// mfa-access.mjs separately exercises aal1, revocation, and lost-factor behavior.
export async function installAuthSessionFixture(db) {
  await db.exec(`
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text,factor_type text);
    create table auth.sessions(id uuid primary key,user_id uuid,factor_id uuid,aal text,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
    $$;
  `);
}

export async function fixtureSession(db, userId, role = 'authenticated', aal = 'aal2') {
  await db.exec('reset role');
  if (userId && role === 'authenticated') {
    await db.query(`insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$1,'verified','totp')
      on conflict(id) do update set status='verified'`, [userId]);
    await db.query(`insert into auth.sessions(id,user_id,factor_id,aal,not_after) values($1,$1,$1,$2,null)
      on conflict(id) do update set aal=excluded.aal,factor_id=excluded.factor_id,not_after=null`, [userId, aal]);
  }
  const claims = userId && role === 'authenticated' ? { sub:userId,role,aal,session_id:userId } : { role };
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)", [userId,role,JSON.stringify(claims)]);
}
