import { describe,expect,it } from 'vitest';
import { leaveAuditDetail } from './leave-audit';

describe('Riwayat cuti sebelum dan sesudah koreksi', () => {
  it('menampilkan alasan, tanggal, jam, status dan alokasi tahun asal', () => {
    const detail = leaveAuditDetail('  Koreksi setelah konfirmasi  ',
      { starts_on:'2025-12-31',ends_on:'2026-01-01',starts_at:null,ends_at:null,status:'approved',deductions:{ 2025:1,2026:2 } },
      { starts_on:'2026-01-01',ends_on:'2026-01-01',starts_at:'10:00:00',ends_at:'12:30:00',status:'cancelled',deductions:{} });
    expect(detail).toBe('Koreksi setelah konfirmasi\nSebelum: 2025-12-31–2026-01-01 · Disetujui · potongan 2025: 1 hari, 2026: 2 hari\nSesudah: 2026-01-01 · jam 10:00–12:30 WIB · Dibatalkan · tanpa potongan');
  });
  it('membedakan keputusan permintaan pembatalan dari status pengajuan asli', () => {
    expect(leaveAuditDetail(null,null,{ leave_request_id:'leave',type:'cancel',status:'approved' })).toBe('Sesudah: Permintaan pembatalan · Disetujui');
  });
  it('mengabaikan metadata pribadi dan lampiran, serta bertahan pada snapshot lama atau rusak', () => {
    const detail = leaveAuditDetail('Alasan tetap tersedia',{ attachment_path:'secret/evidence.pdf',employee_id:'secret-id',full_name:'Pribadi',salary:99_000_000,profile:{ address:'Alamat rahasia' } },
      { starts_on:'invalid',starts_at:'99:99',status:'arbitrary private text',deductions:{ salary:99_000_000,2026:-1 } });
    expect(detail).toBe('Alasan tetap tersedia\nSesudah: tanpa potongan');
    expect(leaveAuditDetail('Riwayat lama',null,[])).toBe('Riwayat lama');
  });
});
