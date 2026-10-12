-- Keep capture-time evidence separate from the authoritative clock-in instant.
-- Older device rows and manual records legitimately have no capture metadata.
alter table public.attendance
  add column selfie_captured_at timestamptz,
  add column selfie_outlet_name text,
  add constraint attendance_selfie_metadata_pair check (
    (selfie_captured_at is null and selfie_outlet_name is null)
    or (source='clock' and selfie_captured_at is not null and isfinite(selfie_captured_at)
      and selfie_outlet_name is not null and length(btrim(selfie_outlet_name))>0)
  );

comment on column public.attendance.selfie_captured_at is
  'Device-reported camera capture instant. Distinct from clock_in; not a server-attested time.';
comment on column public.attendance.selfie_outlet_name is
  'Outlet name frozen by the device when the selfie watermark was rendered.';

-- A distinct argument set keeps existing five-argument clients working and
-- lets PostgREST resolve the new call by its named metadata arguments.
create function public.attendance_clock_in(p_shift text,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision,p_selfie_path text,p_selfie_captured_at timestamptz,p_selfie_outlet_name text)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_row public.attendance;
begin
  if p_selfie_captured_at is null or p_selfie_outlet_name is null or length(btrim(p_selfie_outlet_name))=0 then
    raise exception 'Waktu dan outlet pengambilan selfie harus lengkap';
  end if;
  if not isfinite(p_selfie_captured_at) then raise exception 'Waktu pengambilan selfie tidak valid'; end if;
  -- Delegate employee locking, GPS/radius, shift, selfie ownership and duplicate
  -- protection to the established API in the same transaction.
  v_row:=public.attendance_clock_in(p_shift,p_latitude,p_longitude,p_accuracy_m,p_selfie_path);
  update public.attendance set selfie_captured_at=p_selfie_captured_at,selfie_outlet_name=btrim(p_selfie_outlet_name)
    where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text)
  to authenticated;
