-- Durable, per-employee inbox. Business events create notifications server-side;
-- clients may read their own rows and mark them read through the narrow RPC.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  entity_id uuid not null references public.leave_requests(id),
  title text not null check (length(title) between 1 and 150),
  body text not null,
  href text not null check (href like '/leave?request=%'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_employee_created on public.notifications(employee_id,created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
  using (employee_id=(select private.employee_id()));

create function private.notify_employee(p_employee_id uuid,p_leave_id uuid,p_title text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_employee_id is null or p_employee_id=private.employee_id() then return; end if;
  if not exists(select 1 from public.employees where id=p_employee_id and status='active' and account_status='active') then return; end if;
  insert into public.notifications(employee_id,entity_id,title,body,href)
    values(p_employee_id,p_leave_id,p_title,'Buka rincian pengajuan untuk melihat informasi terbaru.','/leave?request='||p_leave_id::text);
end;
$$;
create function private.notify_leave_reviewers(p_leave_id uuid,p_title text)
returns void language plpgsql security definer set search_path='' as $$
declare v_employee public.employees; v_reviewer record;
begin
  select e.* into strict v_employee from public.employees e join public.leave_requests l on l.employee_id=e.id where l.id=p_leave_id;
  if v_employee.approval_mode='external' then
    for v_reviewer in select employee_id from public.employee_roles where role='admin_hr' and employee_id<>v_employee.id loop
      perform private.notify_employee(v_reviewer.employee_id,p_leave_id,p_title);
    end loop;
  elsif v_employee.approver_employee_id is distinct from v_employee.id then
    perform private.notify_employee(v_employee.approver_employee_id,p_leave_id,p_title);
  end if;
end;
$$;
create function private.notify_leave_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_title text;
begin
  if tg_op='INSERT' then
    perform private.notify_leave_reviewers(new.id,'Pengajuan cuti/izin baru'); return new;
  end if;
  -- Adjustment approval emits one notification from its own trigger after the
  -- parent and ledger have changed, avoiding duplicate inbox entries.
  if old.status='approved' and exists(select 1 from public.leave_adjustments where leave_request_id=new.id and status='pending') then return new; end if;
  if new.status is distinct from old.status then
    if new.status='pending' then
      perform private.notify_leave_reviewers(new.id,'Pengajuan dilengkapi kembali');
    else
      v_title:=case new.status when 'approved' then 'Pengajuan disetujui' when 'rejected' then 'Pengajuan ditolak'
        when 'needs_info' then 'Pengajuan perlu dilengkapi' else 'Pengajuan dibatalkan' end;
      perform private.notify_employee(new.employee_id,new.id,v_title);
      if new.status='cancelled' then perform private.notify_leave_reviewers(new.id,'Pengajuan dibatalkan'); end if;
    end if;
  elsif row(new.starts_on,new.ends_on,new.starts_at,new.ends_at,new.reason,new.attachment_path,new.deductions,new.decision_note,new.decision_by,new.decided_at)
      is distinct from row(old.starts_on,old.ends_on,old.starts_at,old.ends_at,old.reason,old.attachment_path,old.deductions,old.decision_note,old.decision_by,old.decided_at) then
    if new.status='pending' then perform private.notify_leave_reviewers(new.id,'Pengajuan diperbarui');
    elsif new.status='approved' then
      perform private.notify_employee(new.employee_id,new.id,'Catatan cuti dikoreksi HR');
      perform private.notify_leave_reviewers(new.id,'Catatan cuti dikoreksi HR');
    end if;
  end if;
  return new;
end;
$$;
create function private.notify_leave_adjustment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_employee_id uuid;
begin
  if tg_op='INSERT' then
    perform private.notify_leave_reviewers(new.leave_request_id,case new.type when 'cancel' then 'Permintaan pembatalan cuti' else 'Permintaan perubahan cuti' end);
  elsif old.status='pending' and new.status<>'pending' then
    select employee_id into strict v_employee_id from public.leave_requests where id=new.leave_request_id;
    perform private.notify_employee(v_employee_id,new.leave_request_id,case new.status when 'approved' then 'Perubahan cuti disetujui' else 'Perubahan cuti ditolak' end);
  end if;
  return new;
end;
$$;
create trigger notifications_leave after insert or update on public.leave_requests for each row execute function private.notify_leave_event();
create trigger notifications_leave_adjustment after insert or update on public.leave_adjustments for each row execute function private.notify_leave_adjustment();

create function public.notifications_mark_read(p_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_employee uuid:=private.require_employee(); v_count integer;
begin
  update public.notifications set read_at=now() where employee_id=v_employee and read_at is null and (p_id is null or id=p_id);
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function private.notify_employee(uuid,uuid,text),private.notify_leave_reviewers(uuid,text),
  private.notify_leave_event(),private.notify_leave_adjustment() from public,anon,authenticated;
revoke all on function public.notifications_mark_read(uuid) from public,anon;
grant execute on function public.notifications_mark_read(uuid) to authenticated;
alter publication supabase_realtime add table public.notifications;
