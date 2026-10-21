import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { get } from 'svelte/store';
import { actions,app } from './state/app';
import { initialDemo } from './state/demo';
import { assertCashierAssignment,assignmentFor,saveAssignmentInState } from './cashier-workflows';
import type { AttendanceCorrectionInput,CashierAssignmentInput,SpvFollowup } from './types';

vi.mock('./state/client',()=>({configured:false,supabase:null}));
const actor=(id:string)=>app.update(s=>({...s,user:s.employees.find(e=>e.id===id)!}));
const assignment=(overrides:Partial<CashierAssignmentInput>={}):CashierAssignmentInput=>({employeeId:'employee-4',workDate:'2026-10-06',outletId:'outlet-a',shift:'morning',reason:'Penugasan dikonfirmasi HR',...overrides});
const correction=(overrides:Partial<AttendanceCorrectionInput>={}):AttendanceCorrectionInput=>({attendanceId:null,workDate:'2026-10-05',clockIn:'2026-10-05T00:10:00Z',clockOut:'2026-10-05T08:10:00Z',shift:'morning',reason:'Kamera gagal, jam dikonfirmasi SPV',...overrides});
const clockInput=()=>({outletId:'outlet-a',shift:'morning' as const,latitude:-6.2,longitude:106.816666,accuracy:10,geoCapturedAt:new Date().toISOString(),selfie:new Blob(['foto'],{type:'image/jpeg'})});
const unassignedFollowup=(id:string,workDate:string,status:SpvFollowup['status']='new'):SpvFollowup=>({id,caseKey:`unassigned:employee-4:${workDate}`,issueType:'unassigned',sourceType:'roster',sourceId:null,workDate,outletId:'outlet-a',employeeId:'employee-4',shift:'morning',ownerId:null,status,note:'',resolutionNote:status==='completed'?'Kasus sudah ditutup':'',createdBy:'employee-1',updatedBy:'employee-1',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',reopenedCount:0});
const assignmentFollowup=(id:string,sourceId:string,workDate:string,status:SpvFollowup['status']='new'):SpvFollowup=>({id,caseKey:`assignment:${sourceId}`,issueType:'missing_clockin',sourceType:'assignment',sourceId,workDate,outletId:'outlet-a',employeeId:'employee-4',shift:'morning',ownerId:status==='in_progress'?'employee-1':null,status,note:status==='in_progress'?'Sedang menghubungi kasir':'',resolutionNote:status==='completed'?'Kasus sudah ditutup':'',createdBy:'employee-1',updatedBy:'employee-1',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',reopenedCount:0});

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-06T03:00:00Z'));
  vi.stubGlobal('navigator',{onLine:true});
  const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:session-photo');
  const state=initialDemo();state.initialized=true;state.cashierAssignments=[];state.attendanceRecords=[];state.attendanceCorrectionRequests=[];
  state.user=state.employees.find(e=>e.id==='employee-1')!;app.set(state);
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});

describe('Penugasan harian kasir',()=>{
  it('mewajibkan HR aktif, kasir aktif, dan penugasan oleh akun lain',()=>{
    const state=get(app);state.user=state.employees.find(e=>e.id==='employee-4')!;
    expect(()=>assertCashierAssignment(state,assignment())).toThrow('Admin HR');
    state.user.roles.push('admin_hr');expect(()=>assertCashierAssignment(state,assignment())).toThrow('sendiri');
    state.user=state.employees[0];expect(()=>assertCashierAssignment(state,assignment({employeeId:'employee-5'}))).toThrow('kasir aktif');
    state.user.accountStatus='disabled';expect(()=>assertCashierAssignment(state,assignment())).toThrow('HR aktif');
  });
  it('mengizinkan penugasan historis yang belum dipakai tetapi menolak tanggal sebelum bekerja atau tanggal rusak',()=>{
    const state=get(app);expect(saveAssignmentInState(state,assignment({workDate:'2026-10-05'})).workDate).toBe('2026-10-05');
    for(const workDate of ['2024-12-31','2026-02-30','invalid']) expect(()=>assertCashierAssignment(state,assignment({workDate}))).toThrow();
  });
  it('memperbarui satu penugasan per tanggal, membatalkan, lalu mengaktifkan kembali tanpa ID ganda',async()=>{
    const id=await actions.saveCashierAssignment(assignment());
    await actions.saveCashierAssignment(assignment({id,shift:'afternoon',reason:'Perubahan shift dikonfirmasi HR'}));
    expect(get(app).cashierAssignments).toHaveLength(1);expect(assignmentFor(get(app),'employee-4')?.shift).toBe('afternoon');
    await actions.saveCashierAssignment(assignment({id,cancel:true,reason:'Penugasan dibatalkan oleh HR'}));
    expect(assignmentFor(get(app),'employee-4')).toBeUndefined();
    expect(await actions.saveCashierAssignment(assignment({reason:'Penugasan diaktifkan kembali'}))).toBe(id);
    expect(get(app).cashierAssignments).toHaveLength(1);
    await expect(actions.saveCashierAssignment(assignment({id,workDate:'2026-10-07'}))).rejects.toThrow('tidak dapat diubah');
  });
  it('menolak Middle tanpa izin dan outlet nonaktif',async()=>{
    app.update(s=>({...s,employees:s.employees.map(e=>e.id==='employee-4'?{...e,canMiddleShift:false}:e)}));
    await expect(actions.saveCashierAssignment(assignment({shift:'middle'}))).rejects.toThrow('Middle');
    app.update(s=>({...s,outlets:s.outlets.map(o=>o.id==='outlet-a'?{...o,active:false}:o)}));
    await expect(actions.saveCashierAssignment(assignment())).rejects.toThrow('outlet aktif');
  });
  it('dapat membatalkan penugasan saat outlet dinonaktifkan dan izin Middle dicabut',async()=>{
    const id=await actions.saveCashierAssignment(assignment({outletId:'outlet-b',shift:'middle'}));
    app.update(s=>({...s,outlets:s.outlets.map(o=>o.id==='outlet-b'?{...o,active:false}:o),employees:s.employees.map(e=>e.id==='employee-4'?{...e,canMiddleShift:false}:e)}));
    await actions.saveCashierAssignment(assignment({id,outletId:'outlet-b',shift:'middle',cancel:true,reason:'Dibatalkan setelah outlet ditutup'}));
    expect(get(app).cashierAssignments?.find(a=>a.id===id)).toMatchObject({status:'cancelled',outletId:'outlet-b',shift:'middle'});
  });
  it('pembatalan tidak menimpa outlet atau shift lama dari formulir yang tertinggal',async()=>{
    const id=await actions.saveCashierAssignment(assignment({outletId:'outlet-b',shift:'afternoon'}));
    await actions.saveCashierAssignment(assignment({id,outletId:'outlet-a',shift:'morning',cancel:true,reason:'Pembatalan dari formulir lama'}));
    expect(get(app).cashierAssignments?.find(a=>a.id===id)).toMatchObject({status:'cancelled',outletId:'outlet-b',shift:'afternoon'});
    const before=get(app);await expect(actions.saveCashierAssignment(assignment({id,cancel:true}))).rejects.toThrow('aktif tidak ditemukan');expect(get(app)).toBe(before);
  });
  it('memindahkan konteks kasus terbuka mengikuti assignment, pembatalan dan aktivasi ulang serta menjaga riwayat selesai',async()=>{
    app.update(s=>({...s,spvFollowups:[unassignedFollowup('case-open','2026-10-06'),unassignedFollowup('case-completed','2026-10-06','completed')]}));
    const completedBefore=get(app).spvFollowups?.find(row=>row.id==='case-completed');
    const assignmentId=await actions.saveCashierAssignment(assignment({outletId:'outlet-b'}));
    expect(get(app).spvFollowups?.find(row=>row.id==='case-open')).toMatchObject({outletId:'outlet-b',updatedBy:'employee-1'});
    expect(get(app).spvFollowups?.find(row=>row.id==='case-completed')).toEqual(completedBefore);
    expect(get(app).auditEntries.some(row=>row.entityId==='case-open'&&row.action==='spv_followup_context_refreshed')).toBe(true);

    await actions.saveCashierAssignment(assignment({id:assignmentId,outletId:'outlet-b',cancel:true}));
    expect(get(app).spvFollowups?.find(row=>row.id==='case-open')?.outletId).toBe('outlet-a');
    await actions.saveCashierAssignment(assignment({id:assignmentId,outletId:'outlet-b',shift:'afternoon',reason:'Aktifkan kembali penempatan',cancel:false}));
    expect(get(app).spvFollowups?.find(row=>row.id==='case-open')?.outletId).toBe('outlet-b');
    expect(get(app).spvFollowups?.find(row=>row.id==='case-completed')).toEqual(completedBefore);
  });
  it('menyelaraskan konteks kasus setelah simpan batch dan perubahan outlet utama karyawan',async()=>{
    app.update(s=>({...s,spvFollowups:[unassignedFollowup('case-batch','2026-10-12'),unassignedFollowup('case-employee','2026-10-13'),unassignedFollowup('case-employee-completed','2026-10-13','completed')]}));
    await actions.saveCashierRosterBatch('2026-10-12',[{employeeId:'employee-4',workDate:'2026-10-12',outletId:'outlet-b',shift:'morning',reason:'Jadwal bantuan outlet mingguan',expectedUpdatedAt:null}],crypto.randomUUID());
    expect(get(app).spvFollowups?.find(row=>row.id==='case-batch')).toMatchObject({outletId:'outlet-b',updatedBy:'employee-1'});
    expect(get(app).auditEntries.some(row=>row.entityId==='case-batch'&&row.action==='spv_followup_context_refreshed')).toBe(true);

    const cashier=get(app).employees.find(employee=>employee.id==='employee-4')!;
    await actions.saveEmployee({...cashier,outletId:'outlet-b'});
    expect(get(app).spvFollowups?.find(row=>row.id==='case-employee')).toMatchObject({outletId:'outlet-b',updatedBy:'employee-1'});
    expect(get(app).spvFollowups?.find(row=>row.id==='case-employee-completed')?.outletId).toBe('outlet-a');
    expect(get(app).auditEntries.some(row=>row.entityId==='case-employee'&&row.action==='spv_followup_context_refreshed')).toBe(true);
  });
  it('menyinkronkan konteks kasus assignment pada pindah outlet, Libur, pembatalan dan aktivasi tanpa mengubah riwayat selesai',async()=>{
    const id=await actions.saveCashierAssignment(assignment());
    app.update(s=>({...s,spvFollowups:[assignmentFollowup('assignment-open',id,'2026-10-06','in_progress'),assignmentFollowup('assignment-completed',id,'2026-10-06','completed')]}));
    const completedBefore=structuredClone(get(app).spvFollowups?.find(row=>row.id==='assignment-completed'));

    vi.advanceTimersByTime(1);
    await actions.saveCashierAssignment(assignment({id,outletId:'outlet-b',shift:'off',reason:'Jadwal berubah menjadi Libur'}));
    let open=get(app).spvFollowups?.find(row=>row.id==='assignment-open');
    expect(open).toMatchObject({sourceType:'assignment',sourceId:id,workDate:'2026-10-06',outletId:'outlet-b',employeeId:'employee-4',shift:'off',status:'in_progress',ownerId:'employee-1',note:'Sedang menghubungi kasir',updatedBy:'employee-1'});
    expect(get(app).auditEntries.some(row=>row.entityId==='assignment-open'&&row.action==='spv_followup_context_refreshed')).toBe(true);
    expect(get(app).spvFollowups?.find(row=>row.id==='assignment-completed')).toEqual(completedBefore);

    vi.advanceTimersByTime(1);
    await actions.saveCashierAssignment(assignment({id,outletId:'outlet-b',shift:'off',cancel:true,reason:'Penugasan Libur dibatalkan'}));
    open=get(app).spvFollowups?.find(row=>row.id==='assignment-open');
    expect(open).toMatchObject({outletId:'outlet-b',shift:'off',status:'in_progress',ownerId:'employee-1',note:'Sedang menghubungi kasir'});
    expect(get(app).spvFollowups?.find(row=>row.id==='assignment-completed')).toEqual(completedBefore);

    vi.advanceTimersByTime(1);
    await actions.saveCashierAssignment(assignment({id,outletId:'outlet-a',shift:'afternoon',reason:'Aktifkan kembali di outlet utama'}));
    open=get(app).spvFollowups?.find(row=>row.id==='assignment-open');
    expect(open).toMatchObject({outletId:'outlet-a',shift:'afternoon',status:'in_progress',ownerId:'employee-1',note:'Sedang menghubungi kasir'});
    expect(get(app).auditEntries.filter(row=>row.entityId==='assignment-open'&&row.action==='spv_followup_context_refreshed')).toHaveLength(2);
    expect(get(app).spvFollowups?.find(row=>row.id==='assignment-completed')).toEqual(completedBefore);
  });
  it('menyinkronkan semua kasus assignment terbuka dalam satu batch dan mencatat audit per konteks',async()=>{
    const firstId=await actions.saveCashierAssignment(assignment({workDate:'2026-10-07'}));
    const secondId=await actions.saveCashierAssignment(assignment({workDate:'2026-10-08'}));
    app.update(s=>({...s,spvFollowups:[assignmentFollowup('batch-case-moved',firstId,'2026-10-07'),assignmentFollowup('batch-case-off',secondId,'2026-10-08'),assignmentFollowup('batch-case-completed',firstId,'2026-10-07','completed')]}));
    const completedBefore=structuredClone(get(app).spvFollowups?.find(row=>row.id==='batch-case-completed'));
    const rows=get(app).cashierAssignments ?? [];
    const first=rows.find(row=>row.id===firstId)!,second=rows.find(row=>row.id===secondId)!;

    await actions.saveCashierRosterBatch('2026-10-05',[
      {id:firstId,employeeId:'employee-4',workDate:first.workDate,outletId:'outlet-b',shift:'afternoon',reason:'Pindahkan kasus terbuka ke shift sore',expectedUpdatedAt:first.updatedAt},
      {id:secondId,employeeId:'employee-4',workDate:second.workDate,outletId:'outlet-b',shift:'off',reason:'Tetapkan Libur saat kasus ditinjau',expectedUpdatedAt:second.updatedAt}
    ],crypto.randomUUID());
    expect(get(app).spvFollowups?.find(row=>row.id==='batch-case-moved')).toMatchObject({outletId:'outlet-b',shift:'afternoon'});
    expect(get(app).spvFollowups?.find(row=>row.id==='batch-case-off')).toMatchObject({outletId:'outlet-b',shift:'off'});
    expect(get(app).auditEntries.filter(row=>['batch-case-moved','batch-case-off'].includes(row.entityId)&&row.action==='spv_followup_context_refreshed')).toHaveLength(2);
    expect(get(app).spvFollowups?.find(row=>row.id==='batch-case-completed')).toEqual(completedBefore);
  });
  it('mewajibkan penugasan kerja aktif dan mencegah kasir libur melakukan clock in',async()=>{
    actor('employee-4');await expect(actions.clockIn(clockInput())).rejects.toThrow('penugasan');
    actor('employee-1');await actions.saveCashierAssignment(assignment({shift:'off'}));
    actor('employee-4');await expect(actions.clockIn(clockInput())).rejects.toThrow('libur');
    expect(get(app).attendanceRecords).toHaveLength(0);
  });
  it('memakai outlet bantuan, menolak perubahan sesudah clock in dan menyimpan snapshot untuk clock out',async()=>{
    app.update(s=>({...s,outlets:s.outlets.map(o=>o.id==='outlet-b'?{...o,latitude:-6.25,longitude:106.85,radiusMeters:100}:o)}));
    const id=await actions.saveCashierAssignment(assignment({outletId:'outlet-b'}));actor('employee-4');
    await expect(actions.clockIn(clockInput())).rejects.toThrow('penugasan harian');
    await actions.clockIn({...clockInput(),outletId:'outlet-b',latitude:-6.25,longitude:106.85});
    expect(get(app).attendanceRecords[0].outletId).toBe('outlet-b');actor('employee-1');const before=get(app);
    await expect(actions.saveCashierAssignment(assignment({id,outletId:'outlet-b',shift:'afternoon'}))).rejects.toThrow('dipakai absensi');expect(get(app)).toBe(before);
    app.update(s=>({...s,cashierAssignments:s.cashierAssignments?.map(a=>({...a,status:'cancelled'})),outlets:s.outlets.map(o=>o.id==='outlet-b'?{...o,latitude:0,longitude:0,active:false}:o)}));
    actor('employee-4');vi.setSystemTime(new Date('2026-10-06T11:00:00Z'));
    await actions.clockOut({latitude:-6.25,longitude:106.85,accuracy:10,geoCapturedAt:new Date().toISOString()});
    expect(get(app).attendanceRecords[0]).toMatchObject({clockOut:'2026-10-06T11:00:00.000Z',durationMinutes:480,outDistance:0});
  });
  it('menolak GPS lama pada masuk dan pulang, termasuk waktu perangkat terlalu jauh di depan',async()=>{
    await actions.saveCashierAssignment(assignment());actor('employee-4');
    for(const offset of [-60_001,6_000]) await expect(actions.clockIn({...clockInput(),geoCapturedAt:new Date(Date.now()+offset).toISOString()})).rejects.toThrow('kedaluwarsa');
    expect(get(app).attendanceRecords).toHaveLength(0);
    await actions.clockIn({...clockInput(),geoCapturedAt:new Date(Date.now()-60_000).toISOString()});
    const before=get(app);await expect(actions.clockOut({...clockInput(),geoCapturedAt:new Date(Date.now()-60_001).toISOString()})).rejects.toThrow('kedaluwarsa');expect(get(app)).toBe(before);
  });
});

describe('Permintaan koreksi kehadiran',()=>{
  it('membuat catatan manual setelah persetujuan HR, menyimpan sumber tanpa bukti GPS/selfie palsu',async()=>{
    const assignmentId=await actions.saveCashierAssignment(assignment({workDate:'2026-10-05',outletId:'outlet-b'}));actor('employee-4');
    const id=await actions.submitAttendanceCorrection(correction());
    expect(get(app).attendanceRecords).toHaveLength(0);await expect(actions.submitAttendanceCorrection(correction())).rejects.toThrow('menunggu');
    await expect(actions.decideAttendanceCorrection(id,true,'Kasir mencoba menyetujui sendiri')).rejects.toThrow('Admin HR');
    actor('employee-1');await actions.decideAttendanceCorrection(id,true,'Jam dikonfirmasi melalui SPV outlet');
    const state=get(app),record=state.attendanceRecords[0];
    expect(record).toMatchObject({employeeId:'employee-4',outletId:'outlet-b',assignmentId,source:'manual',corrected:true,inLatitude:null,inLongitude:null,selfiePath:'',durationMinutes:480});
    expect(state.attendanceCorrectionRequests?.find(r=>r.id===id)).toMatchObject({status:'approved',attendanceId:record.id,decisionBy:'employee-1'});
    expect(state.leaveLedger).toHaveLength(0);
    const before=get(app);await expect(actions.decideAttendanceCorrection(id,true,'Persetujuan berulang tidak diizinkan')).rejects.toThrow('diproses');expect(get(app)).toBe(before);
  });
  it('pencatatan manual langsung memakai outlet dan ID penugasan historis termasuk hari off',async()=>{
    const assignmentId=await actions.saveCashierAssignment(assignment({workDate:'2026-10-05',outletId:'outlet-b',shift:'off'}));
    await actions.recordManualAttendance({employeeId:'employee-4',shift:'morning',clockIn:correction().clockIn,clockOut:correction().clockOut,reason:'Kerja pengecualian hari off dikonfirmasi HR'});
    expect(get(app).attendanceRecords[0]).toMatchObject({outletId:'outlet-b',assignmentId,source:'manual',shift:'morning'});
    expect(get(app).cashierAssignments?.find(a=>a.id===assignmentId)?.shift).toBe('off');
  });
  it('membatasi pembatalan pada pemilik dan masih menunggu, kemudian dapat mengirim ulang setelah ditolak',async()=>{
    actor('employee-4');const id=await actions.submitAttendanceCorrection(correction());actor('employee-6');
    await expect(actions.cancelAttendanceCorrection(id)).rejects.toThrow('sendiri');actor('employee-4');await actions.cancelAttendanceCorrection(id);
    await expect(actions.cancelAttendanceCorrection(id)).rejects.toThrow('menunggu');const retry=await actions.submitAttendanceCorrection(correction());
    actor('employee-1');await actions.decideAttendanceCorrection(retry,false,'Waktu belum sesuai bukti konfirmasi');actor('employee-4');
    expect(await actions.submitAttendanceCorrection(correction())).not.toBe(retry);expect(get(app).attendanceRecords).toHaveLength(0);
  });
  it('menolak persetujuan permintaan sendiri meskipun pemohon mempunyai akses HR',async()=>{
    app.update(s=>({...s,employees:s.employees.map(e=>e.id==='employee-4'?{...e,roles:[...e.roles,'admin_hr']}:e)}));actor('employee-4');
    const id=await actions.submitAttendanceCorrection(correction());await expect(actions.decideAttendanceCorrection(id,true,'Keputusan HR yang merupakan pemohon')).rejects.toThrow('sendiri');
    expect(get(app).attendanceRecords).toHaveLength(0);
  });
  it('menolak proposal yang tertinggal perubahan absensi dari HR lain tanpa menimpa data terbaru',async()=>{
    await actions.recordManualAttendance({employeeId:'employee-4',shift:'morning',clockIn:correction().clockIn,clockOut:correction().clockOut,reason:'Konfirmasi awal dari SPV'});
    const recordId=get(app).attendanceRecords[0].id;actor('employee-4');
    const id=await actions.submitAttendanceCorrection(correction({attendanceId:recordId,clockIn:'2026-10-05T00:05:00Z'}));actor('employee-1');
    await actions.correctAttendance(recordId,{clockIn:'2026-10-05T00:06:00Z',clockOut:'2026-10-05T08:06:00Z',reason:'HR lain mengoreksi sebelum persetujuan'});
    const before=get(app);await expect(actions.decideAttendanceCorrection(id,true,'Menggunakan proposal sebelum perubahan')).rejects.toThrow('berubah');expect(get(app)).toBe(before);
    expect(get(app).attendanceCorrectionRequests?.find(r=>r.id===id)?.status).toBe('pending');
  });
  it('menolak persetujuan jika outlet penugasan berubah setelah permintaan dibuat',async()=>{
    actor('employee-4');const id=await actions.submitAttendanceCorrection(correction());actor('employee-1');
    await actions.saveCashierAssignment(assignment({workDate:'2026-10-05',outletId:'outlet-b'}));const before=get(app);
    await expect(actions.decideAttendanceCorrection(id,true,'Periksa perubahan outlet terlebih dahulu')).rejects.toThrow('berubah');expect(get(app)).toBe(before);
  });
  it('menolak tumpang tindih lintas tengah malam secara atomik',async()=>{
    await actions.recordManualAttendance({employeeId:'employee-4',shift:'morning',clockIn:'2026-10-05T00:00:00Z',clockOut:'2026-10-05T08:00:00Z',reason:'Catatan pagi telah dikonfirmasi'});actor('employee-4');
    const id=await actions.submitAttendanceCorrection(correction({workDate:'2026-10-04',clockIn:'2026-10-04T16:00:00Z',clockOut:'2026-10-05T01:00:00Z',shift:'afternoon'}));actor('employee-1');
    const before=get(app);await expect(actions.decideAttendanceCorrection(id,true,'Proposal malam berbenturan sesi pagi')).rejects.toThrow('bertabrakan');expect(get(app)).toBe(before);
    expect(get(app).attendanceRecords).toHaveLength(1);
  });
  it('menolak tanggal sebelum mulai bekerja, waktu mendatang dan tanggal kerja yang tidak sesuai',async()=>{
    actor('employee-4');for(const input of [correction({workDate:'2024-12-31',clockIn:'2024-12-31T00:00:00Z'}),correction({clockIn:'2026-10-07T00:00:00Z'}),correction({workDate:'2026-10-04'})]) await expect(actions.submitAttendanceCorrection(input)).rejects.toThrow();
    expect(get(app).attendanceCorrectionRequests).toHaveLength(0);
  });
});
