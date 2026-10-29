import { expect, test, type Page, type Route } from '@playwright/test';

// Real browser + Supabase SDK/storage, isolated Auth/Edge/PostgREST fixture.
// Every identity and password below is synthetic; no hosted credentials.
const backend = 'http://127.0.0.1:54329';
const authA = '10000000-0000-4000-8000-000000000001', authB = '10000000-0000-4000-8000-000000000002';
const actorA = '20000000-0000-4000-8000-000000000001', actorB = '20000000-0000-4000-8000-000000000002';
const target = '20000000-0000-4000-8000-000000000003';
const reason = 'Identitas petugas dikonfirmasi oleh HR melalui prosedur uji';
const namespace = 'rajaklana:mfa-recovery:v1:';
type RecoveryBody = { action: string; employee_id: string; request_id: string; reason: string };
function jwt(userId: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,aud:'authenticated',role:'authenticated',aal:'aal2',session_id:'synthetic-session',exp:Math.floor(Date.now()/1000)+3600})}.synthetic-signature`;
}
async function respond(route: Route, data: unknown, status = 200) {
  const count = Array.isArray(data) ? data.length : null;
  await route.fulfill({status,contentType:'application/json',headers:count === null ? {} : {'content-range':count ? `0-${count-1}/${count}` : '*/0'},body:JSON.stringify(data)});
}
async function fixture(page: Page) {
  const requests: RecoveryBody[] = [], receipts = new Map<string,string>();
  let commits = 0, loseResponse = true;
  const now = new Date().toISOString();
  const user = (id: string) => ({id,aud:'authenticated',role:'authenticated',email:`${id}@synthetic.example.test`,app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:now});
  const session = (id: string) => ({access_token:jwt(id),refresh_token:`synthetic-refresh-${id}`,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:user(id)});
  const employee = (id: string, authId: string, fullName: string, number: string) => ({id,auth_user_id:authId,full_name:fullName,employee_number:number,whatsapp:'081200000000',department_id:'department',position_id:'position',outlet_id:'outlet',starts_on:'2020-01-01',status:'active',account_status:'active',weekly_off_days:[]});
  const tables: Record<string,Record<string,unknown>[]> = {
    employees:[employee(actorA,authA,'Admin Pemulihan A','RK000001'),employee(actorB,authB,'Admin Pemulihan B','RK000002'),employee(target,'10000000-0000-4000-8000-000000000003','Petugas Pemulihan','RK000003')],
    employee_roles:[{employee_id:actorA,role:'admin_hr'},{employee_id:actorB,role:'admin_hr'},{employee_id:target,role:'head_baker'}],
    departments:[{id:'department',name:'Tim Uji',active:true}],positions:[{id:'position',department_id:'department',name:'Petugas',active:true,is_cashier:false}],
    outlets:[{id:'outlet',name:'Outlet Uji',active:true,opens_at:'07:00:00',closes_at:'23:00:00',morning_starts_at:'07:00:00',afternoon_starts_at:'15:00:00',radius_m:500}]
  };
  await page.route(`${backend}/**`,async route => {
    const request=route.request(),path=new URL(request.url()).pathname;
    let authId=authA;
    try { authId=JSON.parse(Buffer.from((request.headers().authorization??'').split('.')[1]??'','base64url').toString()).sub; } catch { /* Synthetic unauthenticated login. */ }
    if(path==='/functions/v1/hr-api') {
      const body=request.postDataJSON();
      if(body.action==='login') {await respond(route,{session:session(body.employee_number==='RK000002'?authB:authA)});return;}
      if(body.action==='recover_mfa') {
        requests.push(structuredClone(body));
        const fingerprint=JSON.stringify(body),previous=receipts.get(body.request_id);
        if(previous && previous!==fingerprint) {await respond(route,{error:'Original payload changed'},409);return;}
        if(!previous) {receipts.set(body.request_id,fingerprint);commits+=1;}
        if(loseResponse) {loseResponse=false;await respond(route,{error:'Konfirmasi pemulihan tertunda. Coba lagi permintaan yang sama.'},503);return;}
        await respond(route,{ok:true,request_id:body.request_id});return;
      }
    }
    if(path==='/auth/v1/user') {await respond(route,user(authId));return;}
    if(path==='/auth/v1/logout') {await respond(route,{});return;}
    if(path==='/auth/v1/token') {await respond(route,session(authId));return;}
    if(path==='/rest/v1/rpc/auth_access_context') {await respond(route,{employee_id:authId===authB?actorB:actorA,requires_mfa:true,current_level:'aal2',allowed:true,reason:null});return;}
    if(path==='/rest/v1/rpc/leave_balance') {await respond(route,{expired:false,remaining:12});return;}
    if(path==='/rest/v1/rpc/spv_followup_page') {await respond(route,{items:[],total:0});return;}
    if(path.startsWith('/rest/v1/rpc/')) {await respond(route,[]);return;}
    if(path.startsWith('/rest/v1/')) {await respond(route,tables[path.slice('/rest/v1/'.length)]??[]);return;}
    await respond(route,{});
  });
  return {requests,get commits(){return commits;}};
}
async function login(page: Page, number='RK000001') {
  await page.goto('/login');await page.getByLabel('Nomor karyawan').fill(number);await page.getByLabel('Kata sandi').fill('Synthetic-Password-123');await page.getByRole('button',{name:'Masuk',exact:false}).click();
  await expect(page).toHaveURL(/\/dashboard$/);await page.goto('/employees');
}
async function openRecovery(page: Page, fullName='Petugas Pemulihan') {
  await page.getByRole('button',{name:`Lihat profil ${fullName}`,exact:true}).click();
  await page.getByRole('button',{name:'Pulihkan verifikasi dua langkah',exact:true}).click();
}
async function submitFirst(page: Page) {
  await openRecovery(page);await page.getByLabel('Alasan dan hasil verifikasi identitas').fill(reason);
  await page.getByRole('button',{name:'Konfirmasi pemulihan',exact:true}).click();
  await expect(page.getByText('Konfirmasi pemulihan tertunda. Coba lagi permintaan yang sama.',{exact:true})).toBeVisible();
}
async function closeRecovery(page: Page) {await page.locator('dialog[open]').getByRole('button',{name:'Tutup',exact:true}).last().click();}
async function pending(page: Page) {return page.evaluate(prefix=>Object.entries(sessionStorage).filter(([key])=>key.startsWith(prefix)),namespace);}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK,'Requires isolated live-mock server.');

test('MFA recovery preserves exact request across close, different target, reload and retry',async({page})=>{
  const mock=await fixture(page);await login(page);await submitFirst(page);
  expect(mock.requests).toHaveLength(1);const first=structuredClone(mock.requests[0]);
  const before=await pending(page);expect(before).toHaveLength(1);expect(JSON.parse(before[0][1]).payload).toEqual({employeeId:target,requestId:first.request_id,reason});
  await closeRecovery(page);await openRecovery(page,'Admin Pemulihan B');
  await expect(page.locator('dialog[open]')).toContainText('Selesaikan permintaan tersimpan terlebih dahulu');
  await expect(page.getByLabel('Alasan dan hasil verifikasi identitas')).toHaveValue(reason);
  await expect(page.getByLabel('Alasan dan hasil verifikasi identitas')).toBeDisabled();
  expect(await pending(page)).toEqual(before);await closeRecovery(page);await page.reload();
  await page.getByRole('button',{name:'Lanjutkan pemulihan tersimpan',exact:true}).click();
  await expect(page.getByLabel('Alasan dan hasil verifikasi identitas')).toHaveValue(reason);
  await page.getByRole('button',{name:'Coba lagi permintaan yang sama',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Faktor lama sudah dipulihkan dan sesi terkait dicabut.'})).toBeVisible();
  expect(mock.requests).toEqual([first,first]);expect(mock.commits).toBe(1);expect(await pending(page)).toHaveLength(0);
});

test('MFA recovery pending for A is hidden from B and restored only after returning to A',async({page})=>{
  const mock=await fixture(page);await login(page);await submitFirst(page);const original=await pending(page);await closeRecovery(page);
  await page.getByRole('button',{name:'Keluar akun',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
  await login(page,'RK000002');await expect(page.getByRole('button',{name:'Lanjutkan pemulihan tersimpan',exact:true})).toHaveCount(0);
  await openRecovery(page);await expect(page.getByLabel('Alasan dan hasil verifikasi identitas')).toHaveValue('');
  expect(await pending(page)).toEqual(original);expect(mock.requests).toHaveLength(1);await closeRecovery(page);
  await page.getByRole('button',{name:'Keluar akun',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
  await login(page);await page.getByRole('button',{name:'Lanjutkan pemulihan tersimpan',exact:true}).click();
  await expect(page.getByLabel('Alasan dan hasil verifikasi identitas')).toHaveValue(reason);expect(await pending(page)).toEqual(original);
});

test('MFA recovery blocks network call when pending storage cannot persist',async({page})=>{
  await page.addInitScript(prefix=>{
    const setItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key.startsWith(prefix))throw new DOMException('Synthetic disabled storage','QuotaExceededError');return setItem.call(this,key,value);};
  },namespace);
  const mock=await fixture(page);await login(page);await openRecovery(page);await page.getByLabel('Alasan dan hasil verifikasi identitas').fill(reason);
  await page.getByRole('button',{name:'Konfirmasi pemulihan',exact:true}).click();
  await expect(page.locator('dialog[open]')).toContainText('Penyimpanan pemulihan belum dapat dipastikan');
  expect(mock.requests).toHaveLength(0);expect(await pending(page)).toHaveLength(0);
});

test('MFA recovery rejects an untrusted stored envelope without erasing or submitting it',async({page})=>{
  const mock=await fixture(page);await login(page);
  const key=`${namespace}preview:${encodeURIComponent(backend)}:${authA}:${actorA}`;
  const raw=JSON.stringify({version:1,scope:{environment:'preview',projectOrigin:backend,authUserId:authA,actorEmployeeId:actorA},payload:{employeeId:target,requestId:'30000000-0000-4000-8000-000000000001',reason,secret:'synthetic-disallowed-field'}});
  await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key,raw});await page.reload();
  await expect(page.getByRole('alert')).toContainText('Penyimpanan pemulihan belum dapat dipastikan');
  await page.getByRole('button',{name:'Lihat profil Petugas Pemulihan',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pulihkan verifikasi dua langkah',exact:true})).toBeDisabled();
  expect(mock.requests).toHaveLength(0);expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(raw);
});
