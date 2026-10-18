-- NULLS NOT DISTINCT makes full-day and single-endpoint izin equally unique.
-- The index is the final concurrent-write guard, including stricter isolation
-- levels. Fail rather than silently altering any unexpected legacy duplicates.
create unique index leave_active_exact_unique on public.leave_requests
  (employee_id,kind,extent,starts_on,ends_on,starts_at,ends_at) nulls not distinct
  where status in ('pending','needs_info','approved');

-- Exact duplicates are invalid; overlapping leave and attendance remain valid.
-- This trigger also protects older clients calling the original RPCs. Lock only
-- the employee (after the request lock, for updates), matching set_deductions.
-- The lookup never locks another request, so competing requests cannot reverse
-- the existing parent -> employee lock order. Volatile trigger queries obtain a
-- fresh snapshot after waiting for the employee in READ COMMITTED transactions.
create function private.check_leave_duplicate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('pending','needs_info','approved') then return new; end if;
  perform 1 from public.employees where id=new.employee_id for update;
  if exists (
    select 1 from public.leave_requests r
    where r.employee_id=new.employee_id and r.id<>new.id
      and r.status in ('pending','needs_info','approved')
      and r.kind=new.kind and r.extent=new.extent
      and r.starts_on=new.starts_on and r.ends_on=new.ends_on
      and r.starts_at is not distinct from new.starts_at
      and r.ends_at is not distinct from new.ends_at
  ) then
    raise exception 'Pengajuan yang sama sudah ada dan masih aktif' using errcode='23505';
  end if;
  return new;
end;
$$;
revoke all on function private.check_leave_duplicate() from public,anon,authenticated;
create trigger leave_no_exact_duplicate before insert or update on public.leave_requests
  for each row execute function private.check_leave_duplicate();

create function public.leave_edit(p_id uuid,p_starts_on date,p_ends_on date,p_reason text,
  p_starts_at time default null,p_ends_at time default null,p_attachment_path text default null,
  p_replace_attachment boolean default false)
returns public.leave_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_before public.leave_requests; v_row public.leave_requests;
begin
  select * into strict v_before from public.leave_requests where id=p_id for update;
  if v_before.employee_id<>v_actor then
    raise exception 'Hanya pemilik pengajuan yang dapat mengubahnya' using errcode='42501'; end if;
  if v_before.status not in ('pending','needs_info') then
    raise exception 'Pengajuan ini tidak dapat diedit langsung'; end if;
  if p_starts_on<(now() at time zone 'Asia/Jakarta')::date
    or v_before.starts_on<(now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Cuti yang sudah dijalani hanya dapat dikoreksi HR'; end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 2000 then
    raise exception 'Alasan pengajuan harus berisi 3 sampai 2000 karakter'; end if;
  perform private.assert_leave_period(v_before.extent,p_starts_on,p_ends_on,p_starts_at,p_ends_at);
  if p_replace_attachment then perform private.assert_upload('leave-attachments',p_attachment_path); end if;
  update public.leave_requests set starts_on=p_starts_on,ends_on=p_ends_on,
    starts_at=p_starts_at,ends_at=p_ends_at,reason=trim(p_reason),status='pending',
    attachment_path=case when p_replace_attachment then p_attachment_path else attachment_path end,
    decision_by=null,external_decider=null,decided_at=null,decision_note=null,deductions='{}',updated_at=now()
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('leave',p_id,v_actor,'edited',trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

-- Preserve the original signature/JSON shape, and route pending edits through
-- the same checks and decision reset as the new attachment-capable endpoint.
create or replace function public.leave_request_change(p_id uuid,p_starts_on date,p_ends_on date,
  p_reason text,p_starts_at time default null,p_ends_at time default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_employee(); v_row public.leave_requests; v_adjustment public.leave_adjustments;
begin
  select * into strict v_row from public.leave_requests where id=p_id and employee_id=v_actor for update;
  if p_starts_on<(now() at time zone 'Asia/Jakarta')::date or v_row.starts_on<(now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Cuti yang sudah dijalani hanya dapat dikoreksi HR'; end if;
  if v_row.status in ('pending','needs_info') then
    v_row:=public.leave_edit(p_id,p_starts_on,p_ends_on,p_reason,p_starts_at,p_ends_at);
    return jsonb_build_object('request',to_jsonb(v_row),'adjustment',null);
  elsif v_row.status='approved' then
    insert into public.leave_adjustments(leave_request_id,type,starts_on,ends_on,starts_at,ends_at,reason)
      values(p_id,'change',p_starts_on,p_ends_on,p_starts_at,p_ends_at,p_reason) returning * into v_adjustment;
    return jsonb_build_object('request',to_jsonb(v_row),'adjustment',to_jsonb(v_adjustment));
  end if;
  raise exception 'Pengajuan ini tidak dapat diubah';
end;
$$;

create function public.leave_correct(p_id uuid,p_starts_on date,p_ends_on date,p_deductions jsonb,
  p_reason text,p_cancel boolean default false,p_external_decider text default null)
returns public.leave_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.require_hr(); v_before public.leave_requests; v_new public.leave_requests;
  v_row public.leave_requests; v_external boolean; v_deductions jsonb;
begin
  select * into strict v_before from public.leave_requests where id=p_id for update;
  if v_before.employee_id=v_actor then raise exception 'Pengajuan sendiri tidak boleh dikoreksi'; end if;
  if v_before.status<>'approved' then raise exception 'Hanya pengajuan disetujui yang dapat dikoreksi HR'; end if;
  if exists(select 1 from public.leave_adjustments where leave_request_id=p_id and status='pending') then
    raise exception 'Selesaikan permintaan perubahan yang masih menunggu terlebih dahulu'; end if;
  if p_cancel is null then raise exception 'Jenis koreksi wajib diisi'; end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 2000 then
    raise exception 'Alasan koreksi harus berisi 3 sampai 2000 karakter'; end if;
  select approval_mode='external' into v_external from public.employees where id=v_before.employee_id;
  if v_external and length(trim(coalesce(p_external_decider,'')))<3 then
    raise exception 'Nama pemberi keputusan eksternal wajib diisi'; end if;
  v_new:=v_before;
  if p_cancel then
    -- Cancellation refunds the original allocation. Ignore submitted dates and
    -- deductions so a cross-year refund cannot become a new-year entitlement.
    v_deductions:='{}';
  else
    v_new.starts_on:=p_starts_on; v_new.ends_on:=p_ends_on;
    perform private.assert_leave_period(v_new.extent,v_new.starts_on,v_new.ends_on,v_new.starts_at,v_new.ends_at);
    v_deductions:=p_deductions;
  end if;
  -- set_deductions records only allocation deltas, prohibits extra expired-year
  -- charges, and preserves each refund in the year of its original charge.
  perform private.set_deductions(v_new,v_deductions,'correct:'||gen_random_uuid()::text,v_actor);
  update public.leave_requests set starts_on=v_new.starts_on,ends_on=v_new.ends_on,
    status=case when p_cancel then 'cancelled' else 'approved' end,deductions=v_deductions,
    decision_by=v_actor,external_decider=case when v_external then trim(p_external_decider) else null end,
    decided_at=now(),decision_note=trim(p_reason),updated_at=now()
    where id=p_id returning * into v_row;
  insert into public.audit_events(entity,entity_id,actor_employee_id,action,reason,before_data,after_data)
    values('leave',p_id,v_actor,case when p_cancel then 'corrected_cancelled' else 'corrected' end,
      trim(p_reason),to_jsonb(v_before),to_jsonb(v_row));
  return v_row;
end;
$$;

revoke all on function public.leave_edit(uuid,date,date,text,time,time,text,boolean),
  public.leave_correct(uuid,date,date,jsonb,text,boolean,text) from public,anon,authenticated;
grant execute on function public.leave_edit(uuid,date,date,text,time,time,text,boolean),
  public.leave_correct(uuid,date,date,jsonb,text,boolean,text) to authenticated;
