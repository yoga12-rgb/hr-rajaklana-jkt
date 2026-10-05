export const dateLabel = (value: string, full = false) => value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: full ? 'long' : 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value.length === 10 ? `${value}T12:00:00+07:00` : value)) : '—';
export const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—';
export const durationLabel = (minutes: number | null) => minutes === null ? 'Belum selesai' : `${Math.floor(minutes / 60)} jam${minutes % 60 ? ` ${Math.round(minutes % 60)} menit` : ''}`;
export const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
export const leaveTypeLabel: Record<string, string> = { annual: 'Cuti tahunan', personal: 'Izin pribadi', sick: 'Izin sakit' };
export const leaveStatusLabel: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', needs_info: 'Perlu dilengkapi', cancelled: 'Dibatalkan' };
export const leaveTone = (status: string): 'green' | 'amber' | 'red' | 'muted' | 'blue' => ({ approved: 'green', pending: 'amber', rejected: 'red', needs_info: 'blue', cancelled: 'muted' }[status] as 'green' | 'amber' | 'red' | 'muted' | 'blue') || 'muted';
