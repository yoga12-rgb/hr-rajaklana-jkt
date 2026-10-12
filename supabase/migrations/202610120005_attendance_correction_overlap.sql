-- Correcting a session must preserve one timeline per employee, including
-- sessions crossing midnight. Lock the employee before the attendance row,
-- matching clock-in/out and manual recording so concurrent writes serialize.
create or replace function public.attendance_correct(p_id uuid,p_clock_in timestamptz,p_clock_out timestamptz,p_reason text,p_shift text default null)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_employee_id uuid;
  v_before public.attendance; v_row public.attendance; v_shift text; v_expected timestamptz;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Alasan koreksi wajib diisi'; end if;
  select employee_id into strict v_employee_id from public.attendance where id=p_id;
  perform 1 from public.employees where id=v_employee_id for update;
  select * into strict v_before from public.attendance where id=p_id for update;
  if v_actor=v_before.employee_id then raise exception 'Catatan absensi sendiri tidak boleh dikoreksi'; end if;
  if p_clock_in is null or p_clock_in>now() or p_clock_out>now() or p_clock_out<p_clock_in then raise exception 'Waktu koreksi tidak valid'; end if;
  if (p_clock_in at time zone 'Asia/Jakarta')::date<>v_before.work_date then raise exception 'Tanggal kerja tidak dapat diubah'; end if;
  v_shift:=coalesce(p_shift,v_before.shift);
  if v_shift not in ('morning','afternoon','middle') then raise exception 'Shift tidak valid'; end if;
  if exists(select 1 from public.attendance a where a.employee_id=v_before.employee_id and a.id<>p_id
    and tstzrange(a.clock_in,a.clock_out,'[)') && tstzrange(p_clock_in,p_clock_out,'[)')) then
    raise exception 'Waktu absensi bertabrakan dengan catatan yang sudah ada'; end if;
  v_expected:=case v_shift when 'morning' then (v_before.work_date+v_before.morning_starts_at) at time zone 'Asia/Jakarta'
    when 'afternoon' then (v_before.work_date+v_before.afternoon_starts_at) at time zone 'Asia/Jakarta' else null end;
  update public.attendance set clock_in=p_clock_in,clock_out=p_clock_out,corrected=true,shift=v_shift,
    expected_in=v_expected,expected_out=coalesce(v_expected,p_clock_in)+interval '8 hours',
    worked_minutes=case when p_clock_out is null then null else floor(extract(epoch from(p_clock_out-p_clock_in))/60)::integer end,
    late_minutes=case when v_expected is null or p_clock_in<=v_expected+make_interval(mins=>tolerance_minutes) then 0
      else ceil(extract(epoch from(p_clock_in-v_expected))/60)::integer end
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('attendance',p_id,v_actor,'corrected',p_reason,to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;
