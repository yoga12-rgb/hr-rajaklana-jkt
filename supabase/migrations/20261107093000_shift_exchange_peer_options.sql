-- Rekan tukar/pengganti sebelumnya hanya tersedia dari baris employees yang
-- dibaca klien.  RLS employee_read sengaja hanya membuka profil sendiri (atau
-- Admin HR), sehingga sesi kasir hanya menerima data rekan lewat
-- employee_directory().  Directory itu tidak memuat account_status, sehingga
-- setiap rekan dipetakan menjadi not_invited dan hilang dari daftar rekan.
-- Migrasi ini (1) menambah account_status ke directory supaya semua pemilih
-- berbasis activeEmployees benar dan (2) menyediakan RPC kandidat yang memakai
-- aturan yang sama dengan shift_exchange_submit, sehingga pratinjau jadwal
-- rekan tidak lagi bergantung pada RLS cashier_assignments milik sendiri.

drop function public.employee_directory();
create function public.employee_directory() returns table(
  id uuid,employee_number text,full_name text,department_id uuid,position_id uuid,outlet_id uuid,
  approver_employee_id uuid,approval_mode text,status text,account_status text,can_clock boolean,can_middle_shift boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_employee();
  return query select e.id,e.employee_number,e.full_name,e.department_id,e.position_id,e.outlet_id,
    e.approver_employee_id,e.approval_mode,e.status,e.account_status,e.can_clock,e.can_middle_shift
    from public.employees e where e.status='active';
end;
$$;
revoke all on function public.employee_directory() from public,anon,authenticated;
grant execute on function public.employee_directory() to authenticated;

-- Kandidat dikembalikan apa adanya beserta alasan blokir supaya UI dapat
-- menampilkan pilihan yang pasti ditolak server (bukan menebak dari jadwal
-- milik sendiri).  Hanya pengusul yang boleh membaca kandidat untuk jadwalnya.
create function public.shift_exchange_peer_options(p_requester_assignment_id uuid)
returns table(employee_id uuid,employee_number text,full_name text,assignment_id uuid,
  shift text,outlet_id uuid,work_date date,has_active_assignment boolean,blocked_reason text)
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee();
  v_requester public.cashier_assignments;
  v_today date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date;
begin
  select * into v_requester from public.cashier_assignments where id=p_requester_assignment_id;
  if not found then raise exception 'Jadwal pengusul tidak ditemukan'; end if;
  if v_requester.employee_id<>v_actor then
    raise exception 'Hanya pengusul yang dapat melihat kandidat jadwal ini' using errcode='42501';
  end if;
  return query
    select e.id,e.employee_number,e.full_name,a.id,a.shift,a.outlet_id,v_requester.work_date,
      coalesce(a.id is not null and a.status='active' and a.shift<>'off',false),
      case when not e.can_clock then 'Rekan harus kasir aktif'
           when a.id is not null and a.status='active' and a.shift='off' then 'Rekan sedang Libur pada tanggal ini'
           when a.shift='middle' and a.work_date<=v_today then 'Tukar Middle hari ini belum didukung'
      end
    from public.employees e
    left join public.cashier_assignments a on a.employee_id=e.id and a.work_date=v_requester.work_date
    where e.id<>v_actor and e.status='active' and e.account_status='active'
    order by e.full_name;
end;
$$;
revoke all on function public.shift_exchange_peer_options(uuid) from public,anon,authenticated;
grant execute on function public.shift_exchange_peer_options(uuid) to authenticated;
