-- Private photos and leave evidence. Attachments can only be linked by their owner.
create function private.assert_upload(p_bucket text,p_path text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if p_path is null then return; end if;
  if split_part(p_path,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then
    raise exception 'Lampiran tidak ditemukan atau bukan milik Anda'; end if;
end;
$$;
create function private.check_leave_upload() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.attachment_path is distinct from old.attachment_path then
    perform private.assert_upload('leave-attachments',new.attachment_path);
  end if;
  return new;
end;
$$;
create trigger leave_attachment_owner before insert or update on public.leave_requests for each row execute function private.check_leave_upload();
create function private.check_profile_upload() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.photo_path is distinct from old.photo_path and new.photo_path is not null then
    if not private.has_role('admin_hr') then perform private.assert_upload('profile-photos',new.photo_path);
    elsif not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=new.photo_path) then
      raise exception 'Foto profil belum diunggah';
    end if;
  end if;
  return new;
end;
$$;
create trigger profile_photo_owner before update on public.employees for each row execute function private.check_profile_upload();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('leave-attachments','leave-attachments',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']),
  ('profile-photos','profile-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy leave_attachment_upload on storage.objects for insert to authenticated with check(bucket_id='leave-attachments'
  and (storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null);
create policy leave_attachment_read on storage.objects for select to authenticated using(bucket_id='leave-attachments'
  and ((storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null or private.has_role('admin_hr')
    or exists(select 1 from public.leave_requests r where r.attachment_path=name and private.is_approver(r.employee_id))));
create policy profile_photo_upload on storage.objects for insert to authenticated with check(bucket_id='profile-photos'
  and (storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null);
create policy profile_photo_read on storage.objects for select to authenticated using(bucket_id='profile-photos'
  and ((storage.foldername(name))[1]=auth.uid()::text and private.employee_id() is not null or private.has_role('admin_hr')));
grant usage,select on sequence public.outlet_code_seq to authenticated;
