import { get, writable } from 'svelte/store';
import type { AppState, AttendanceRecord, ClockInInput, ClockOutInput, Department, Employee, LeaveDecision, LeaveInput, LeaveRequest, Outlet, Position, Role, Shift } from '../types';
import { attendanceTiming, dateRange, deductionByYear, haversineMeters, jakartaDate, leaveEntitlement } from '../domain';
import { initialDemo } from './demo';
import { hasApproverAccess } from '../access';
import { configured, supabase } from './client';

const KEY = 'rajaklana-hr-demo-v1';
export const app = writable<AppState>(initialDemo());
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
let refreshing = false, timer: ReturnType<typeof setTimeout> | undefined;
let refreshPromise: Promise<void> | null = null;
let refreshRequested = false;
let authRevision = 0;
const id = () => crypto.randomUUID();
async function demoPasswordHash(password: string, salt: string) { const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${salt}:${password}`)); return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''); }
function readDemoToken(token: string) {
  const links = JSON.parse(localStorage.getItem('rk-demo-links') ?? '{}');
  const link = links[token], expiresAt = new Date(link?.expiresAt ?? '').getTime();
  if (!link || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) throw new Error('Tautan tidak berlaku atau sudah kedaluwarsa. Hubungi HR.');
  const employee = get(app).employees.find(e => e.id === link.employeeId);
  if (!employee || employee.status !== 'active') throw new Error('Akun karyawan tidak aktif. Hubungi HR.');
  return { links, link, employee };
}
const user = () => { const u = get(app).user; if (!u || u.status !== 'active') throw new Error('Silakan masuk dengan akun aktif.'); return u; };
export const isAdmin = (employee: Employee | undefined | null = get(app).user) => employee?.roles.includes('admin_hr') ?? false;
export const isApprover = (employee: Employee | undefined | null = get(app).user) => hasApproverAccess(employee, get(app).employees);
export const isCashier = (employee: Employee | undefined | null = get(app).user) => !!employee && get(app).positions.some(p => p.id === employee.positionId && p.isCashier);
export const displayName = (employeeId: string) => get(app).employees.find(e => e.id === employeeId)?.fullName ?? 'Karyawan';
export const shiftLabel = (shift: Shift) => ({ morning: 'Pagi', afternoon: 'Sore', middle: 'Middle' })[shift];
export function attendancePermission(record: AttendanceRecord): string {
  const permission = get(app).leaveRequests.find(r=>r.employeeId===record.employeeId&&r.status==='approved'&&r.extent==='late_arrival'&&r.startDate===jakartaDate(record.clockIn));
  if (!permission) return '';
  if (!permission.startTime) return 'Izin datang terlambat disetujui';
  const actual = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(record.clockIn));
  return `Izin datang sampai ${permission.startTime} WIB${actual > permission.startTime ? ' · masuk melewati waktu izin' : ' disetujui'}`;
}
export function canDecideLeave(request: LeaveRequest): boolean {
  const s = get(app), u = s.user, employee = s.employees.find(e => e.id === request.employeeId);
  if (!u || u.status !== 'active' || !employee || u.id === employee.id) return false;
  return employee.approvalMode === 'external' ? isAdmin(u) : employee.managerId === u.id;
}
export function leaveBalance(employeeId: string, year = Number(jakartaDate().slice(0, 4))): number {
  const s = get(app), employee = s.employees.find(e => e.id === employeeId);
  if (!employee || year < Number(jakartaDate().slice(0, 4))) return 0;
  if (s.mode === 'live') return s.balanceCache?.[`${employeeId}:${year}`] ?? 0;
  return Math.max(0, Math.round((leaveEntitlement(employee.joinDate, year) - s.leaveLedger.filter(e => e.employeeId === employeeId && e.year === year).reduce((a, b) => a + b.days, 0)) * 100) / 100);
}
function persist(state: AppState) {
  if (typeof localStorage !== 'undefined' && state.mode === 'demo') localStorage.setItem(KEY, JSON.stringify({ ...state, user: state.user ? { ...state.user, photoUrl: undefined } : null, employees: state.employees.map(({ photoUrl, ...employee }) => employee), attendanceRecords: state.attendanceRecords.map(({ selfieUrl, ...record }) => record), leaveRequests: state.leaveRequests.map(({ attachmentUrl, ...request }) => request) }));
}
function commit(change: (state: AppState) => void, action?: string, entityId = '', detail = '') {
  const state = structuredClone(get(app)); change(state);
  if (action) state.auditEntries.unshift({ id: id(), actorId: state.user?.id ?? '', action, entityId, at: new Date().toISOString(), detail });
  if (state.user) state.user = state.employees.find(e => e.id === state.user?.id) ?? null;
  persist(state); app.set(state);
}
function requireAdmin() { if (!isAdmin(user())) throw new Error('Tindakan ini hanya untuk Admin HR.'); }
function fail(error: unknown): never { throw new Error(error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Permintaan belum berhasil. Coba kembali.'); }
async function rpc(name: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const { data, error } = await supabase.rpc(name, args); if (error) fail(error); return data;
}
async function edge(action: string, body: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const { data, error } = await supabase.functions.invoke('hr-api', { body: { action, ...body } });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) { try { const detail = await response.json(); throw new Error(detail.error || detail.message || error.message); } catch (e) { fail(e); } }
    fail(error);
  }
  if (data?.error) throw new Error(data.error); return data;
}
const cutTime = (v: string | null | undefined) => v?.slice(0, 5) ?? '';
function mapEmployee(r: any, roles: any[]): Employee {
  return { id: r.id, employeeNumber: r.employee_number, fullName: r.full_name, phone: r.whatsapp ?? '', departmentId: r.department_id ?? '', positionId: r.position_id ?? '', outletId: r.outlet_id ?? '', managerId: r.approver_employee_id, joinDate: r.starts_on ?? '', status: r.status ?? 'active', employmentType: 'permanent', accountStatus: ({ uninvited: 'not_invited', pending: 'invited', active: 'active', disabled: 'disabled' } as const)[r.account_status as 'uninvited'] ?? 'not_invited', authUserId: r.auth_user_id, roles: roles.filter(x => x.employee_id === r.id).map(x => x.role), canMiddleShift: r.can_middle_shift ?? false, weeklyOffDays: r.weekly_off_days ?? [], approvalMode: r.approval_mode ?? 'internal', address: r.address ?? '', birthDate: r.birthday ?? '', gender: r.gender === 'unspecified' ? '' : r.gender ?? '', emergencyName: r.emergency_name ?? '', emergencyPhone: r.emergency_phone ?? '', photoUrl: r.photo_path, exitDate: r.ends_on ?? '', exitReason: r.exit_reason ?? '' };
}
async function refresh() {
  if (!supabase) return;
  if (refreshPromise) { refreshRequested = true; return refreshPromise; }
  refreshPromise = (async () => { do { refreshRequested = false; await refreshNow(); } while (refreshRequested); })();
  try { await refreshPromise; } finally { refreshPromise = null; }
}
function clearLiveState(error: string | null = null) {
  app.set({ ...initialDemo(), mode: 'live', initialized: true, loading: false, user: null, employees: [], departments: [], positions: [], outlets: [], leaveRequests: [], attendanceRecords: [], auditEntries: [], leaveLedger: [], balanceCache: {}, connected: navigator.onLine, error });
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
}
async function readAll(table: string, fields = '*'): Promise<any[]> {
  if (!supabase) return [];
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from(table).select(fields).order(table === 'employee_roles' ? 'employee_id' : 'id');
    if (table === 'employee_roles') query = query.order('role');
    const { data, error } = await query.range(offset, offset + 999);
    if (error) fail(error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
async function refreshNow() {
  if (!supabase || refreshing) return; refreshing = true;
  const revision = authRevision;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { if (revision === authRevision) clearLiveState(); return; }
    const tables = ['employees', 'employee_roles', 'departments', 'positions', 'outlets', 'leave_requests', 'leave_adjustments', 'attendance', 'leave_ledger'];
    const [employeeRows, roleRows, departmentRows, positionRows, outletRows, leaveRows, adjustmentRows, attendanceRows, ledgerRows] = await Promise.all(tables.map(name => readAll(name)));
    const employees = employeeRows.map(r => mapEmployee(r, roleRows));
    const current = employees.find(e => e.authUserId === session.user.id);
    if (!current || current.status !== 'active') { if (revision === authRevision) { clearLiveState('Akses akun tidak aktif. Hubungi Admin HR.'); await supabase.auth.signOut(); } return; }
    const directory = await rpc('employee_directory', {});
    for (const d of directory ?? []) if (!employees.some(e => e.id === d.id)) employees.push(mapEmployee(d, []));
    const attendanceRecords: AttendanceRecord[] = await Promise.all(attendanceRows.map(async r => {
      const signed = r.selfie_path ? await supabase!.storage.from('attendance-selfies').createSignedUrl(r.selfie_path, 300) : null;
      return { id: r.id, employeeId: r.employee_id, outletId: r.outlet_id, shift: r.shift, clockIn: r.clock_in, clockOut: r.clock_out, scheduledStart: r.expected_in, lateMinutes: r.late_minutes, durationMinutes: r.worked_minutes, inLatitude: r.in_latitude, inLongitude: r.in_longitude, inAccuracy: r.in_accuracy_m, inDistance: r.in_distance_m, outLatitude: r.out_latitude, outLongitude: r.out_longitude, outDistance: r.out_distance_m, outAccuracy: r.out_accuracy_m, selfiePath: r.selfie_path ?? '', selfieUrl: signed?.data?.signedUrl, corrected: r.corrected, correctionReason: '', source: r.source === 'manual' ? 'manual' : 'device' };
    }));
    let auditEntries: AppState['auditEntries'] = [];
    if (isAdmin(current)) {
      const data = await readAll('audit_events', 'id,actor_employee_id,entity_id,action,reason,created_at');
      auditEntries = data.map(r => ({ id: r.id, actorId: r.actor_employee_id, entityId: r.entity_id, action: r.action, at: r.created_at, detail: r.reason ?? '' })).sort((a,b) => b.at.localeCompare(a.at));
      for (const record of attendanceRecords) record.correctionReason = auditEntries.find(entry => entry.entityId === record.id && entry.detail)?.detail ?? '';
    }
    const balanceCache: Record<string, number> = {};
    const year = Number(jakartaDate().slice(0,4));
    const balanceYears = new Set<number>([year, year + 1]);
    for (const row of [...leaveRows, ...adjustmentRows]) for (const date of [row.starts_on, row.ends_on]) if (date) balanceYears.add(Number(date.slice(0,4)));
    const balanceIds = isAdmin(current) ? employeeRows.map(e => e.id) : [...new Set([current.id,...leaveRows.map(r => r.employee_id)])];
    await Promise.all(balanceIds.flatMap(employeeId => [...balanceYears].map(async balanceYear => { const balance = await rpc('leave_balance', { p_employee_id: employeeId, p_year: balanceYear }); balanceCache[`${employeeId}:${balanceYear}`] = balance.expired ? 0 : Number(balance.remaining); })));
    for (const employee of employees.filter(e => e.photoUrl)) { const signed = await supabase.storage.from('profile-photos').createSignedUrl(employee.photoUrl!,300); employee.photoUrl = signed.data?.signedUrl; }
    const leaveRequests: LeaveRequest[] = await Promise.all(leaveRows.map(async r => {
      const history = adjustmentRows.filter(a => a.leave_request_id === r.id).sort((a,b) => b.created_at.localeCompare(a.created_at));
      const adjustment = history.find(a => a.status === 'pending') ?? history[0];
      const attachment = r.attachment_path ? await supabase!.storage.from('leave-attachments').createSignedUrl(r.attachment_path,300) : null;
      return { id: r.id, employeeId: r.employee_id, type: r.kind, extent: r.extent, attachmentUrl: attachment?.data?.signedUrl, attachmentName: r.attachment_path ? 'Lampiran pengajuan' : undefined, startDate: r.starts_on, endDate: r.ends_on, startTime: cutTime(r.starts_at), endTime: cutTime(r.ends_at), reason: r.reason, status: r.status, deductionDays: Object.values(r.deductions ?? {}).reduce((a: number, b) => a + Number(b), 0), approverId: r.decision_by ?? employees.find(e => e.id === r.employee_id)?.managerId ?? null, note: r.decision_note ?? '', externalApproverName: r.external_decider ?? '', createdAt: r.created_at, adjustment: adjustment ? { id: adjustment.id, type: adjustment.type, startDate: adjustment.starts_on, endDate: adjustment.ends_on, reason: adjustment.reason, status: adjustment.status, requestedAt: adjustment.created_at, note: adjustment.decision_note ?? '', decidedAt: adjustment.decided_at ?? undefined, deciderName: adjustment.external_decider || employees.find(e => e.id === adjustment.decision_by)?.fullName } : null };
    }));
    const { data: { session: latestSession } } = await supabase.auth.getSession();
    if (revision !== authRevision || latestSession?.user.id !== session.user.id) return;
    app.set({ mode: 'live', initialized: true, loading: false, user: current, connected: navigator.onLine, error: null, balanceCache, employees, departments: departmentRows.map(r => ({ id: r.id, name: r.name, code: r.code ?? '', active: r.active })), positions: positionRows.map(r => ({ id: r.id, name: r.name, departmentId: r.department_id, active: r.active, isCashier: r.is_cashier })), outlets: outletRows.map(r => ({ id: r.id, code: r.code, name: r.name, address: r.address, active: r.active, isProduction: r.production_location, latitude: r.latitude, longitude: r.longitude, radiusMeters: r.radius_m, opensAt: cutTime(r.opens_at), closesAt: cutTime(r.closes_at), morningStart: cutTime(r.morning_starts_at), afternoonStart: cutTime(r.afternoon_starts_at), lateToleranceMinutes: r.late_tolerance_minutes })), attendanceRecords, auditEntries, leaveLedger: ledgerRows.map(r => ({ id: r.id, employeeId: r.employee_id, year: r.year, days: -Number(r.amount), requestId: r.leave_request_id })), leaveRequests });
    if (!channel) {
      channel = supabase.channel(`hr-${session.user.id}`);
      for (const table of ['employees', 'attendance', 'leave_requests', 'leave_adjustments', 'leave_ledger', 'outlets', 'departments', 'positions', 'employee_roles']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 300); });
      channel.subscribe(status => app.update(s => ({ ...s, connected: status === 'SUBSCRIBED' && navigator.onLine })));
    }
  } catch (e) { if (revision === authRevision) app.update(s => ({ ...s, initialized: true, loading: false, error: e instanceof Error ? e.message : 'Data belum berhasil dimuat.' })); }
  finally { refreshing = false; }
}
function validateGeo(input: ClockOutInput, outlet: Outlet): number {
  if (!navigator.onLine) throw new Error('Absensi membutuhkan koneksi internet.');
  if (outlet.latitude === null || outlet.longitude === null) throw new Error('Lokasi outlet belum diatur. Hubungi Admin HR.');
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180 || !Number.isFinite(input.accuracy) || input.accuracy <= 0 || input.accuracy > 100) throw new Error('Akurasi lokasi belum cukup. Aktifkan lokasi presisi dan coba kembali.');
  const distance = haversineMeters(input.latitude, input.longitude, outlet.latitude, outlet.longitude);
  if (distance > outlet.radiusMeters) throw new Error(`Anda berjarak ${Math.round(distance)} m dari outlet. Radius yang diizinkan ${outlet.radiusMeters} m.`);
  return distance;
}
function validateLeavePeriod(input: Pick<LeaveInput, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'extent'>) {
  dateRange(input.startDate, input.endDate);
  const extent = input.extent ?? (input.startTime ? 'temporary_exit' : 'full_day');
  if (extent !== 'full_day' && (input.startDate !== input.endDate || (!input.startTime && !input.endTime))) throw new Error('Izin sebagian hari memerlukan satu tanggal dan jam izin.');
  if (extent === 'temporary_exit' && (!input.startTime || !input.endTime)) throw new Error('Izin keluar sementara memerlukan jam keluar dan kembali.');
  for (const time of [input.startTime, input.endTime]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Jam izin tidak valid.');
  if (input.startTime && input.endTime && input.endTime <= input.startTime) throw new Error('Jam selesai harus setelah jam mulai.');
  return extent;
}
function updateCharge(state: AppState, request: LeaveRequest, start: string, end: string, days: number) {
  const allocation = deductionByYear(start, end, days), currentYear = Number(jakartaDate().slice(0,4));
  state.leaveLedger = state.leaveLedger.filter(e => e.requestId !== request.id);
  const employee = state.employees.find(e => e.id === request.employeeId)!;
  for (const [yearText, amount] of Object.entries(allocation)) {
    const year = Number(yearText), used = state.leaveLedger.filter(e => e.employeeId === employee.id && e.year === year).reduce((a,b) => a + b.days, 0);
    if (amount > 0 && (year < currentYear || amount > leaveEntitlement(employee.joinDate, year) - used)) throw new Error(`Saldo cuti tahun ${year} tidak cukup atau sudah kedaluwarsa.`);
    if (amount) state.leaveLedger.push({ id: id(), employeeId: employee.id, requestId: request.id, year, days: amount });
  }
}
export const actions = {
  async init() {
    if (get(app).initialized) return;
    if (configured) { app.set({ ...initialDemo(), mode: 'live', employees: [], departments: [], positions: [], outlets: [], leaveRequests: [], loading: true }); await refresh(); supabase!.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { authRevision += 1; clearLiveState(); } setTimeout(() => void refresh(), 0); }); window.setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); }, 60000); }
    else { try { const saved = localStorage.getItem(KEY); if (saved) { const parsed = JSON.parse(saved); if (parsed.mode === 'demo' && Array.isArray(parsed.employees) && Array.isArray(parsed.leaveLedger)) app.set(parsed); } } catch { /* damaged demo data resets safely */ } app.update(s => ({ ...s, initialized: true, connected: navigator.onLine })); }
    window.addEventListener('online', () => { app.update(s => ({ ...s, connected: true })); void refresh(); });
    window.addEventListener('offline', () => app.update(s => ({ ...s, connected: false })));
    window.addEventListener('focus', () => void refresh());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  },
  refresh,
  async login(employeeNumber: string, password: string) {
    if (configured) { const data = await edge('login', { employee_number: employeeNumber, password }); const { error } = await supabase!.auth.setSession(data.session); if (error) fail(error); await refresh(); if (!get(app).user) throw new Error(get(app).error ?? 'Akun belum dapat dimuat.'); }
    else { const employee = get(app).employees.find(e => e.employeeNumber === employeeNumber.trim().toUpperCase() && e.status === 'active' && e.accountStatus === 'active'); if (!employee) throw new Error('Nomor karyawan atau kata sandi tidak sesuai.'); const passwords = JSON.parse(localStorage.getItem('rk-demo-passwords') ?? '{}'), stored = passwords[employee.id]; const valid = stored ? await demoPasswordHash(password,stored.salt) === stored.hash : password === 'DemoRajaklana123!'; if(!valid) throw new Error('Nomor karyawan atau kata sandi tidak sesuai. Kata sandi akun contoh: DemoRajaklana123!'); commit(s => { s.user = employee; }); }
  },
  async logout() { if (supabase) { const { error } = await supabase.auth.signOut(); if (error) fail(error); } authRevision += 1; if (channel && supabase) await supabase.removeChannel(channel); channel = null; if (supabase) { app.set({ ...initialDemo(),mode:'live',initialized:true,user:null,employees:[],departments:[],positions:[],outlets:[],leaveRequests:[],attendanceRecords:[],leaveLedger:[],auditEntries:[],balanceCache:{},connected:navigator.onLine }); } else commit(s => { s.user = null; }); },
  async bootstrap(input: { fullName: string; phone: string; outletName: string; secret: string; password: string }) { if(!configured)throw new Error('Hubungkan proyek Supabase terlebih dahulu.'); return edge('bootstrap',{full_name:input.fullName,whatsapp:input.phone,outlet_name:input.outletName,bootstrap_secret:input.secret,password:input.password}); },
  async switchDemoUser(employeeId: string) { if (configured) throw new Error('Pergantian akun contoh hanya tersedia dalam demo.'); const employee = get(app).employees.find(e => e.id === employeeId && e.status === 'active'); if (!employee) throw new Error('Akun contoh tidak ditemukan.'); commit(s => { s.user = employee; }); },
  async saveEmployee(input: Partial<Employee>) {
    requireAdmin(); const s = get(app), before = s.employees.find(e => e.id === input.id);
    if (!input.fullName?.trim() || !input.phone?.trim() || !input.joinDate || !input.departmentId || !input.positionId || !input.outletId) throw new Error('Lengkapi nama, WhatsApp, tanggal masuk, departemen, jabatan, dan outlet.');
    if (!s.positions.some(p => p.id === input.positionId && p.departmentId === input.departmentId)) throw new Error('Jabatan tidak sesuai departemen.');
    if (input.managerId === input.id && input.id) throw new Error('Karyawan tidak dapat menjadi atasannya sendiri.');
    let cursor = input.managerId; const seen = new Set<string>();
    while (cursor) { if (cursor === input.id || seen.has(cursor)) throw new Error('Hubungan atasan tidak boleh membentuk lingkaran.'); seen.add(cursor); cursor = s.employees.find(e => e.id === cursor)?.managerId; }
    if (input.status === 'inactive' && (s.employees.some(e => e.managerId === input.id && e.status === 'active') || input.id === user().id)) throw new Error('Alihkan anggota tim terlebih dahulu. Anda tidak dapat menonaktifkan akun sendiri.');
    if (input.status === 'inactive' && (!input.exitDate || !input.exitReason?.trim())) throw new Error('Tanggal dan alasan keluar wajib diisi.');
    if (input.id === user().id && JSON.stringify([...(input.roles ?? [])].sort()) !== JSON.stringify([...user().roles].sort())) throw new Error('Perubahan hak akses sendiri harus dilakukan admin lain.');
    if (configured) {
      const row = { full_name: input.fullName.trim(), whatsapp: input.phone, department_id: input.departmentId, position_id: input.positionId, outlet_id: input.outletId, approver_employee_id: input.managerId || null, starts_on: input.joinDate, approval_mode: input.approvalMode, status: input.status, can_middle_shift: input.canMiddleShift, can_clock: s.positions.find(p => p.id === input.positionId)?.isCashier ?? false, weekly_off_days: input.weeklyOffDays ?? [], birthday: input.birthDate || null, gender: input.gender || 'unspecified', address: input.address ?? '', emergency_name: input.emergencyName ?? '', emergency_phone: input.emergencyPhone ?? '', ends_on: input.exitDate || null, exit_reason: input.exitReason || null };
      const saved = await rpc('hr_save_employee', { p_id: input.id ?? null, p_employee: row, p_reason: input.exitReason || 'Pembaruan data karyawan' });
      const roles = [...new Set(['employee', ...(input.roles ?? [])])];
      if (!before || JSON.stringify([...before.roles].sort()) !== JSON.stringify([...roles].sort())) await rpc('hr_set_roles', { p_employee_id: saved.id, p_roles: roles });
      await refresh(); return;
    }
    const employeeId = input.id ?? id(); commit(state => {
      const employee: Employee = { ...initialDemo().employees[0], ...input, id: employeeId, roles: [...new Set<Role>(['employee', ...(input.roles ?? [])])], employeeNumber: before?.employeeNumber ?? `RK${String(Math.max(0, ...state.employees.map(e => Number(e.employeeNumber.slice(2)))) + 1).padStart(6, '0')}`, accountStatus: input.status === 'inactive' ? 'disabled' : before?.accountStatus ?? 'not_invited' };
      const index = state.employees.findIndex(e => e.id === employeeId); if (index < 0) state.employees.push(employee); else state.employees[index] = employee;
    }, 'employee_saved', employeeId, 'Perubahan data karyawan');
  },
  async saveDepartment(input: Partial<Department>) {
    requireAdmin(); if (!input.name?.trim()) throw new Error('Nama departemen wajib diisi.');
    if (configured) { const body = { name: input.name.trim(), active: input.active ?? true }; const result = input.id ? await supabase!.from('departments').update(body).eq('id', input.id) : await supabase!.from('departments').insert(body); if (result.error) fail(result.error); await refresh(); return; }
    commit(s => { const row = { id: input.id ?? id(), code: input.code ?? '', name: input.name!.trim(), active: input.active ?? true }; const i = s.departments.findIndex(x => x.id === row.id); if (i < 0) s.departments.push(row); else s.departments[i] = row; }, 'department_saved', input.id);
  },
  async savePosition(input: Partial<Position>) {
    requireAdmin(); if (!input.name?.trim() || !input.departmentId) throw new Error('Nama jabatan dan departemen wajib diisi.');
    if (configured) { const body = { name: input.name.trim(), department_id: input.departmentId, active: input.active ?? true, is_cashier: input.isCashier ?? false }; const result = input.id ? await supabase!.from('positions').update(body).eq('id', input.id) : await supabase!.from('positions').insert(body); if (result.error) fail(result.error); await refresh(); return; }
    commit(s => { const row = { id: input.id ?? id(), name: input.name!.trim(), departmentId: input.departmentId!, active: input.active ?? true, isCashier: input.isCashier ?? false }; const i = s.positions.findIndex(x => x.id === row.id); if (i < 0) s.positions.push(row); else s.positions[i] = row; }, 'position_saved', input.id);
  },
  async saveOutlet(input: Partial<Outlet>) {
    requireAdmin(); if (!input.name?.trim() || !input.opensAt || !input.closesAt) throw new Error('Lengkapi nama dan jam operasional outlet.');
    if ((input.radiusMeters ?? 0) < 10 || (input.radiusMeters ?? 0) > 2000) throw new Error('Radius absensi harus antara 10 dan 2.000 meter.');
    if (input.latitude !== null && (!Number.isFinite(input.latitude) || Math.abs(input.latitude!) > 90)) throw new Error('Latitude tidak valid.');
    if (input.longitude !== null && (!Number.isFinite(input.longitude) || Math.abs(input.longitude!) > 180)) throw new Error('Longitude tidak valid.');
    if (configured) { const body = { code: input.code || `OT${Date.now().toString().slice(-7)}`, name: input.name, address: input.address ?? '', latitude: input.latitude, longitude: input.longitude, radius_m: input.radiusMeters, opens_at: input.opensAt, closes_at: input.closesAt, morning_starts_at: input.morningStart, afternoon_starts_at: input.afternoonStart, late_tolerance_minutes: input.lateToleranceMinutes, production_location: input.isProduction, active: input.active ?? true }; const result = input.id ? await supabase!.from('outlets').update(body).eq('id', input.id) : await supabase!.from('outlets').insert(body); if (result.error) fail(result.error); await refresh(); return; }
    commit(s => { const row = { ...input, id: input.id ?? id(), code: input.code || `OT${String(s.outlets.length + 1).padStart(3,'0')}` } as Outlet; const i = s.outlets.findIndex(x => x.id === row.id); if (i < 0) s.outlets.push(row); else s.outlets[i] = row; }, 'outlet_saved', input.id);
  },
  async updateProfile(input: Partial<Employee> & { photoFile?: File }) {
    const u = user(), allowed = { address: input.address ?? '', emergencyName: input.emergencyName ?? '', emergencyPhone: input.emergencyPhone ?? '' };
    if(input.photoFile && (input.photoFile.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(input.photoFile.type))) throw new Error('Foto profil harus JPG, PNG, atau WebP maksimal 5 MB.');
    if (configured) {
      let path: string | undefined;
      if(input.photoFile) { const { data: { session } } = await supabase!.auth.getSession(); path=`${session!.user.id}/${id()}.${input.photoFile.type==='image/png'?'png':input.photoFile.type==='image/webp'?'webp':'jpg'}`; const uploaded=await supabase!.storage.from('profile-photos').upload(path,input.photoFile); if(uploaded.error)fail(uploaded.error); }
      try { await rpc('update_my_profile', { p_profile: { address: allowed.address, emergency_name: allowed.emergencyName, emergency_phone: allowed.emergencyPhone, ...(path?{photo_path:path}:{}) } }); } catch(e){if(path)await supabase!.storage.from('profile-photos').remove([path]);throw e;}
      await refresh(); return;
    }
    commit(s => { Object.assign(s.employees.find(e => e.id === u.id)!, allowed, input.photoFile ? {photoUrl:URL.createObjectURL(input.photoFile)} : {}); }, 'profile_updated', u.id);
  },
  async issueLink(employeeId: string, purpose: 'activate' | 'reset') {
    requireAdmin(); if (configured) { const result = await edge(purpose === 'activate' ? 'issue_activation' : 'issue_reset', { employee_id: employeeId }); await refresh(); return { url: result.url, message: result.message, expiresAt: result.expires_at }; }
    const employee = get(app).employees.find(e => e.id === employeeId); if (!employee) throw new Error('Karyawan tidak ditemukan.');
    if (employee.status !== 'active') throw new Error('Akun karyawan tidak aktif. Hubungi HR.');
    const token = id() + id(), expiresAt = new Date(Date.now() + 86400000).toISOString();
    const links = JSON.parse(localStorage.getItem('rk-demo-links') ?? '{}');
    for (const key of Object.keys(links)) if (links[key].employeeId === employeeId && links[key].purpose === purpose) delete links[key];
    links[token] = { employeeId, purpose, expiresAt }; localStorage.setItem('rk-demo-links', JSON.stringify(links));
    const url = `${location.origin}/activate#token=${token}`;
    commit(s => { const e = s.employees.find(e => e.id === employeeId)!; if (purpose === 'activate') e.accountStatus = 'invited'; }, 'link_issued', employeeId, purpose);
    return { url, expiresAt, message: `Halo ${employee.fullName}, ${purpose === 'activate' ? 'aktifkan akun' : 'buat kata sandi baru untuk akun'} HR Rajaklana Anda (${employee.employeeNumber}) melalui ${url}. Berlaku 24 jam. Tautan ini khusus untuk Anda. [DEMO: hanya bekerja pada browser yang sama]` };
  },
  async inspectToken(token: string) {
    if (configured) return edge('inspect_token', { token });
    const { link, employee } = readDemoToken(token);
    return { purpose: link.purpose, employee_number: employee.employeeNumber, full_name: employee.fullName, expires_at: link.expiresAt };
  },
  async activate(token: string, password: string, purpose = 'activate') {
    if (password.length < 10 || password.length > 128) throw new Error('Kata sandi harus 10–128 karakter.');
    if (configured) return edge(purpose === 'reset' ? 'reset_password' : 'activate', { token, password });
    const inspected = readDemoToken(token);
    if (inspected.link.purpose !== purpose) throw new Error('Jenis tautan tidak sesuai.');
    const salt = id(), hash = await demoPasswordHash(password, salt);
    // Hashing yields control: recheck that the employee and token still permit activation.
    const { links, link } = readDemoToken(token);
    if (link.purpose !== purpose || link.employeeId !== inspected.employee.id) throw new Error('Jenis tautan tidak sesuai.');
    const passwords=JSON.parse(localStorage.getItem('rk-demo-passwords')??'{}');passwords[link.employeeId]={salt,hash};localStorage.setItem('rk-demo-passwords',JSON.stringify(passwords));
    commit(s => { s.employees.find(e => e.id === link.employeeId)!.accountStatus = 'active'; }, 'account_activated', link.employeeId); delete links[token]; localStorage.setItem('rk-demo-links', JSON.stringify(links));
    return { ok: true, employee_number: get(app).employees.find(e => e.id === link.employeeId)!.employeeNumber };
  },
  async submitLeave(input: LeaveInput) {
    const u = user(), extent = validateLeavePeriod(input); if (input.reason.trim().length < 3) throw new Error('Alasan pengajuan minimal 3 karakter.');
    if (input.startDate < jakartaDate()) throw new Error('Tanggal pengajuan tidak boleh sebelum hari ini. Untuk koreksi, hubungi HR.');
    if (input.type === 'annual' && !leaveEntitlement(u.joinDate, Number(input.startDate.slice(0,4)))) throw new Error('Hak cuti tahunan belum tersedia setelah masa kerja 3 bulan.');
    if (!u.managerId && u.approvalMode !== 'external') throw new Error('Atasan belum ditetapkan. Hubungi HR.');
    if (configured) {
      let path: string | null = null;
      if (input.attachment) { if (input.attachment.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(input.attachment.type)) throw new Error('Lampiran harus foto/PDF maksimal 5 MB.'); const { data: { session } } = await supabase!.auth.getSession(); path = `${session!.user.id}/${id()}.${input.attachment.type === 'application/pdf' ? 'pdf' : 'jpg'}`; const result = await supabase!.storage.from('leave-attachments').upload(path, input.attachment); if (result.error) fail(result.error); }
      try { await rpc('leave_submit', { p_kind: input.type, p_starts_on: input.startDate, p_ends_on: input.endDate, p_reason: input.reason, p_extent: extent, p_starts_at: input.startTime || null, p_ends_at: input.endTime || null, p_attachment_path: path }); }
      catch(e) { if(path) await supabase!.storage.from('leave-attachments').remove([path]); throw e; } await refresh(); return;
    }
    const requestId = id(); commit(s => { s.leaveRequests.unshift({ id: requestId, employeeId: u.id, type: input.type, extent, attachmentUrl: input.attachment ? URL.createObjectURL(input.attachment) : undefined, attachmentName: input.attachment?.name, startDate: input.startDate, endDate: input.endDate, startTime: input.startTime ?? '', endTime: input.endTime ?? '', reason: input.reason, status: 'pending', deductionDays: 0, approverId: u.managerId, note: '', externalApproverName: '', createdAt: new Date().toISOString(), adjustment: null }); }, 'leave_submitted', requestId);
  },
  async decideLeave(requestId: string, decision: LeaveDecision) {
    const request = get(app).leaveRequests.find(r => r.id === requestId); if (!request || !canDecideLeave(request)) throw new Error('Anda bukan pemberi keputusan untuk pengajuan ini.');
    if (!['pending', 'needs_info'].includes(request.status)) throw new Error('Pengajuan sudah diproses.');
    const employee = get(app).employees.find(e => e.id === request.employeeId)!;
    if (employee.approvalMode === 'external' && (decision.externalApproverName?.trim().length ?? 0) < 3) throw new Error('Nama pemberi keputusan eksternal minimal 3 karakter.');
    if (decision.decision !== 'approve' && (decision.note?.trim().length ?? 0) < 3) throw new Error('Catatan keputusan minimal 3 karakter.');
    if (configured) { await rpc('leave_decide', { p_id: requestId, p_decision: ({ approve: 'approved', reject: 'rejected', needs_info: 'needs_info' })[decision.decision], p_deductions: decision.decision === 'approve' ? deductionByYear(request.startDate, request.endDate, decision.deductionDays) : {}, p_note: decision.note || null, p_external_decider: decision.externalApproverName || null }); await refresh(); return; }
    commit(s => { const r = s.leaveRequests.find(x => x.id === requestId)!; if (decision.decision === 'approve') updateCharge(s, r, r.startDate, r.endDate, decision.deductionDays); r.status = ({ approve: 'approved', reject: 'rejected', needs_info: 'needs_info' } as const)[decision.decision]; r.deductionDays = decision.decision === 'approve' ? decision.deductionDays : 0; r.note = decision.note ?? ''; r.externalApproverName = decision.externalApproverName ?? ''; }, 'leave_decided', requestId, decision.note);
  },
  async changeLeave(requestId: string, input: { startDate: string; endDate: string; reason: string }) {
    const r = get(app).leaveRequests.find(x => x.id === requestId); if (!r || r.employeeId !== user().id) throw new Error('Pengajuan hanya dapat diubah pemiliknya.');
    validateLeavePeriod({ ...input, startTime: r.startTime, endTime: r.endTime, extent: r.extent }); if(input.reason.trim().length < 3 || input.startDate < jakartaDate() || r.startDate < jakartaDate()) throw new Error('Perubahan tanggal yang sudah dijalani harus melalui HR. Alasan minimal 3 karakter.');
    if (configured) { await rpc('leave_request_change', { p_id: requestId, p_starts_on: input.startDate, p_ends_on: input.endDate, p_reason: input.reason, p_starts_at: r.startTime || null, p_ends_at: r.endTime || null }); await refresh(); return; }
    commit(s => { const request = s.leaveRequests.find(x => x.id === requestId)!; if (request.adjustment?.status === 'pending') throw new Error('Masih ada perubahan yang menunggu keputusan.'); if (['pending','needs_info'].includes(request.status)) Object.assign(request, input, { status: 'pending' }); else if(request.status === 'approved') request.adjustment = { ...input, id: id(), type: 'change', status: 'pending', requestedAt: new Date().toISOString() }; else throw new Error('Pengajuan ini tidak dapat diubah.'); }, 'leave_change_requested', requestId, input.reason);
  },
  async cancelLeave(requestId: string, reason: string) {
    const r = get(app).leaveRequests.find(x => x.id === requestId); if (!r || r.employeeId !== user().id) throw new Error('Pengajuan hanya dapat dibatalkan pemiliknya.'); if (reason.trim().length < 3) throw new Error('Alasan pembatalan minimal 3 karakter.');
    if (r.status === 'approved' && r.startDate < jakartaDate()) throw new Error('Pembatalan tanggal lampau harus dikoreksi HR.');
    if (configured) { await rpc('leave_request_cancel', { p_id: requestId, p_reason: reason }); await refresh(); return; }
    commit(s => { const request = s.leaveRequests.find(x => x.id === requestId)!; if(request.adjustment?.status === 'pending') throw new Error('Masih ada perubahan yang menunggu keputusan.'); if(['pending','needs_info'].includes(request.status)) request.status = 'cancelled'; else if(request.status === 'approved') request.adjustment = { id:id(),type:'cancel',reason,status:'pending',requestedAt:new Date().toISOString() }; else throw new Error('Pengajuan ini tidak dapat dibatalkan.'); }, 'leave_cancel_requested', requestId, reason);
  },
  async decideAdjustment(requestId: string, decision: { decision: 'approve' | 'reject'; deductionDays: number; note?: string; externalApproverName?: string }) {
    const r = get(app).leaveRequests.find(x => x.id === requestId); if(!r?.adjustment || !canDecideLeave(r)) throw new Error('Anda tidak dapat memutuskan perubahan ini.');
    if (r.status !== 'approved' || r.adjustment.status !== 'pending') throw new Error('Perubahan sudah diproses.');
    const employee = get(app).employees.find(e => e.id === r.employeeId)!; if(employee.approvalMode === 'external' && (decision.externalApproverName?.trim().length ?? 0) < 3) throw new Error('Nama pemberi keputusan eksternal minimal 3 karakter.');
    if (decision.decision === 'reject' && (decision.note?.trim().length ?? 0) < 3) throw new Error('Alasan penolakan minimal 3 karakter.');
    if(configured) { await rpc('leave_decide_adjustment', { p_id: r.adjustment.id, p_approved: decision.decision === 'approve', p_deductions: r.adjustment.type === 'cancel' ? {} : deductionByYear(r.adjustment.startDate!,r.adjustment.endDate!,decision.deductionDays), p_note: decision.note || null, p_external_decider: decision.externalApproverName || null }); await refresh(); return; }
    commit(s => { const request = s.leaveRequests.find(x => x.id === requestId)!, a = request.adjustment!; if(decision.decision === 'approve') { if(a.type === 'cancel') { s.leaveLedger = s.leaveLedger.filter(e => e.requestId !== request.id); request.status = 'cancelled'; request.deductionDays = 0; } else { updateCharge(s,request,a.startDate!,a.endDate!,decision.deductionDays); request.startDate = a.startDate!; request.endDate = a.endDate!; request.deductionDays = decision.deductionDays; } } a.status = decision.decision === 'approve' ? 'approved' : 'rejected'; a.note = decision.note?.trim() ?? ''; a.decidedAt = new Date().toISOString(); a.deciderName = decision.externalApproverName?.trim() || user().fullName; }, 'leave_adjustment_decided', requestId, `${r.adjustment.type === 'cancel' ? 'Pembatalan' : 'Perubahan tanggal'} ${decision.decision === 'approve' ? 'disetujui' : 'ditolak'}${decision.externalApproverName ? ` oleh ${decision.externalApproverName.trim()}` : ''}${decision.note ? `: ${decision.note.trim()}` : ''}`);
  },
  async clockIn(input: ClockInInput) {
    const u = user(), s = get(app), outlet = s.outlets.find(o => o.id === u.outletId); if(!isCashier(u) || !outlet || input.outletId !== outlet.id) throw new Error('Absensi hanya untuk kasir pada outlet penempatannya.');
    if (!outlet.active) throw new Error('Outlet tidak aktif. Hubungi Admin HR.');
    if (!['morning', 'afternoon', 'middle'].includes(input.shift)) throw new Error('Shift tidak valid.');
    const distance = validateGeo(input,outlet); if(input.shift === 'middle' && !u.canMiddleShift) throw new Error('Shift Middle memerlukan izin SPV.');
    if(!input.selfie.size || input.selfie.size > 5 * 1024 * 1024 || !input.selfie.type.startsWith('image/')) throw new Error('Ambil selfie langsung dari kamera, maksimal 5 MB.');
    if(s.attendanceRecords.some(r => r.employeeId === u.id && !r.clockOut)) throw new Error('Masih ada sesi kerja yang belum clock out.');
    if(s.attendanceRecords.some(r => r.employeeId === u.id && jakartaDate(r.clockIn) === jakartaDate())) throw new Error('Clock in hari ini sudah tercatat. Untuk koreksi, hubungi SPV.');
    if(configured) { const { data: { session } } = await supabase!.auth.getSession(); const path = `${session!.user.id}/${id()}.jpg`; const upload = await supabase!.storage.from('attendance-selfies').upload(path,input.selfie,{contentType:'image/jpeg'}); if(upload.error) fail(upload.error); try { await rpc('attendance_clock_in',{p_shift:input.shift,p_latitude:input.latitude,p_longitude:input.longitude,p_accuracy_m:input.accuracy,p_selfie_path:path}); } catch(e) { await supabase!.storage.from('attendance-selfies').remove([path]); throw e; } await refresh(); return; }
    const now = new Date().toISOString(), recordId = id(); commit(state => { state.attendanceRecords.unshift({ id:recordId,employeeId:u.id,outletId:outlet.id,shift:input.shift,clockIn:now,clockOut:null,...attendanceTiming(now,input.shift,outlet),durationMinutes:null,inLatitude:input.latitude,inLongitude:input.longitude,inAccuracy:input.accuracy,inDistance:distance,selfiePath:'demo-session-only',selfieUrl:URL.createObjectURL(input.selfie),corrected:false,correctionReason:'' }); },'clock_in',recordId);
  },
  async clockOut(input: ClockOutInput) {
    const u = user(), record = get(app).attendanceRecords.find(r => r.employeeId === u.id && !r.clockOut); if(!record) throw new Error('Tidak ada sesi kerja aktif.'); const outlet = get(app).outlets.find(o => o.id === record.outletId)!; const distance = validateGeo(input,outlet);
    if(configured) { await rpc('attendance_clock_out',{p_latitude:input.latitude,p_longitude:input.longitude,p_accuracy_m:input.accuracy}); await refresh(); return; }
    const now = new Date().toISOString(); commit(s => { const r = s.attendanceRecords.find(x => x.id === record.id)!; r.clockOut = now; r.durationMinutes = Math.floor((+new Date(now)-+new Date(r.clockIn))/60000); r.outLatitude = input.latitude; r.outLongitude = input.longitude; r.outDistance = distance; r.outAccuracy = input.accuracy; },'clock_out',record.id);
  },
  async correctAttendance(recordId: string, input: { clockIn: string; clockOut: string | null; shift?: Shift; reason: string }) {
    requireAdmin(); const r = get(app).attendanceRecords.find(x => x.id === recordId); if(!r || r.employeeId === user().id) throw new Error('Anda tidak dapat mengoreksi absensi sendiri.'); if(input.reason.trim().length < 5) throw new Error('Alasan koreksi minimal 5 karakter.');
    const clockIn = +new Date(input.clockIn), clockOut = input.clockOut === null ? null : +new Date(input.clockOut);
    if (!Number.isFinite(clockIn) || clockIn > Date.now() || (clockOut !== null && (!Number.isFinite(clockOut) || clockOut < clockIn || clockOut > Date.now()))) throw new Error('Waktu koreksi tidak valid atau belum terjadi.');
    if (jakartaDate(input.clockIn) !== jakartaDate(r.clockIn)) throw new Error('Tanggal kerja tidak dapat diubah.');
    if (!['morning', 'afternoon', 'middle'].includes(input.shift ?? r.shift)) throw new Error('Shift tidak valid.');
    if (!input.clockOut && get(app).attendanceRecords.some(row => row.id !== r.id && row.employeeId === r.employeeId && !row.clockOut)) throw new Error('Masih ada sesi kerja lain yang belum clock out.');
    if(configured) { await rpc('attendance_correct',{p_id:recordId,p_clock_in:input.clockIn,p_clock_out:input.clockOut || null,p_shift:input.shift ?? null,p_reason:input.reason}); await refresh(); return; }
    commit(s => { const row = s.attendanceRecords.find(x => x.id === recordId)!; const before = JSON.stringify(row); Object.assign(row,{ clockIn:input.clockIn,clockOut:input.clockOut,shift:input.shift ?? row.shift,corrected:true,correctionReason:input.reason,durationMinutes:input.clockOut?Math.floor((+new Date(input.clockOut)-+new Date(input.clockIn))/60000):null }); Object.assign(row,attendanceTiming(input.clockIn,row.shift,s.outlets.find(o => o.id === row.outletId)!)); s.auditEntries.unshift({id:id(),actorId:user().id,action:'attendance_original',entityId:recordId,at:new Date().toISOString(),detail:before}); },'attendance_corrected',recordId,input.reason);
  },
  async recordManualAttendance(input: { employeeId: string; shift: Shift; clockIn: string; clockOut: string | null; reason: string }) {
    requireAdmin(); const employee=get(app).employees.find(e=>e.id===input.employeeId);
    if(!employee || employee.id===user().id || !isCashier(employee) || employee.status!=='active')throw new Error('Pilih kasir aktif selain diri sendiri.');
    if(input.reason.trim().length < 5)throw new Error('Alasan dan sumber konfirmasi minimal 5 karakter.');
    if (!['morning', 'afternoon', 'middle'].includes(input.shift)) throw new Error('Shift tidak valid.');
    if(input.shift==='middle'&&!employee.canMiddleShift)throw new Error('Kasir ini belum diizinkan menggunakan Middle.');
    if(!Number.isFinite(+new Date(input.clockIn)) || +new Date(input.clockIn)>Date.now() || (input.clockOut && (!Number.isFinite(+new Date(input.clockOut)) || input.clockOut<input.clockIn || +new Date(input.clockOut)>Date.now())))throw new Error('Waktu absensi tidak valid atau belum terjadi.');
    if(configured){await rpc('attendance_record_manual',{p_employee_id:input.employeeId,p_shift:input.shift,p_clock_in:input.clockIn,p_clock_out:input.clockOut,p_reason:input.reason});await refresh();return;}
    const outlet=get(app).outlets.find(o=>o.id===employee.outletId)!;
    const recordId=id();commit(s=>{if(s.attendanceRecords.some(r=>r.employeeId===employee.id&&(!r.clockOut||jakartaDate(r.clockIn)===jakartaDate(input.clockIn))))throw new Error('Catatan pada tanggal ini sudah ada atau sesi sebelumnya belum selesai. Gunakan koreksi.');if(s.attendanceRecords.some(r=>r.employeeId===employee.id && +new Date(r.clockIn)<(input.clockOut ? +new Date(input.clockOut) : Infinity) && +new Date(input.clockIn)<(r.clockOut ? +new Date(r.clockOut) : Infinity)))throw new Error('Waktu absensi bertabrakan dengan catatan yang sudah ada.');s.attendanceRecords.unshift({id:recordId,employeeId:employee.id,outletId:outlet.id,shift:input.shift,clockIn:input.clockIn,clockOut:input.clockOut,...attendanceTiming(input.clockIn,input.shift,outlet),durationMinutes:input.clockOut?Math.floor((+new Date(input.clockOut)-+new Date(input.clockIn))/60000):null,inLatitude:null,inLongitude:null,inAccuracy:null,inDistance:null,selfiePath:'',corrected:true,correctionReason:input.reason,source:'manual'});},'attendance_manual',recordId,input.reason);
  }
};
