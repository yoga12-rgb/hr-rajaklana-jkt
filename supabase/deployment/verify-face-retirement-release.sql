-- Independent selfie-only release contract for verified26 + face retirement.
-- Use verify-face-retirement-release.mjs --print to include ALL baseline26
-- password-only/session/RLS/recovery contracts and exact reviewed history maps.
do $selfie_only_contract$
declare
  v_signature text; v_hash text; v_language text; v_volatility "char";
  v_anon boolean; v_authenticated boolean; v_service boolean; v_oid oid;
  v_relation text; v_role text;
begin
  if (select count(*) from supabase_migrations.schema_migrations)<>27
    or not exists(select 1 from supabase_migrations.schema_migrations
      where version='20261103021143' and name='remove_face_verification') then
    raise exception 'selfie-only exact27 history contract differs';
  end if;
  for v_signature,v_hash,v_language,v_volatility,v_anon,v_authenticated,v_service in select * from (values
    ('public.attendance_selfie_object(uuid,text)','b33cf7b19cafc14f88867d0f937af907','plpgsql','v'::"char",false,false,true),
    ('public.attendance_issue_selfie_receipt(uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text)','77b0d403af8e731c35679c1d32e2a8ae','plpgsql','v'::"char",false,false,true),
    ('public.attendance_clock_in_selfie(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid)','72e2ed0dfb09b0f128458aaba3c191db','plpgsql','v'::"char",false,true,false),
    ('private.upload_is_unreferenced(text,text)','9226237a9a0ae469a6f44a0154b82989','sql','s'::"char",false,true,false),
    ('private.protect_verified_selfie_delete()','5bf95ac48e5761be2ea52e65df82f849','plpgsql','v'::"char",false,false,false)
  ) expected(signature,body_hash,language_name,volatility,anon_execute,authenticated_execute,service_execute) loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=v_oid and md5(p.prosrc)=v_hash and p.prosecdef and l.lanname=v_language
        and p.provolatile=v_volatility and not p.proisstrict and not p.proleakproof
        and p.proparallel='u' and p.proconfig=array['search_path=""']::text[] and p.pronargdefaults=0) then
      raise exception 'exact selfie-only helper body/metadata contract differs: %',v_signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE') is distinct from v_anon
      or has_function_privilege('authenticated',v_oid,'EXECUTE') is distinct from v_authenticated
      or has_function_privilege('service_role',v_oid,'EXECUTE') is distinct from v_service then
      raise exception 'selfie-only helper EXECUTE contract differs: %',v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.biometric_server_material(uuid,boolean,boolean)',
    'public.biometric_enroll_server(uuid,text,text,jsonb)','public.biometric_stage_reference(uuid,text)',
    'public.biometric_selfie_object(uuid,text)',
    'public.biometric_issue_receipt(uuid,uuid,uuid,text,text,text,double precision,double precision,double precision,timestamptz,timestamptz,text)',
    'public.biometric_review(uuid,text,text)','public.biometric_withdraw()',
    'public.attendance_clock_in_verified(text,double precision,double precision,double precision,text,timestamptz,text,timestamptz,uuid)',
    'public.attendance_clock_in(text,double precision,double precision,double precision,text)',
    'public.attendance_clock_in(text,double precision,double precision,double precision,text,timestamptz,text)'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null then raise exception 'historical attendance function missing: %',v_signature; end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(v_role,v_oid,'EXECUTE') then
        raise exception 'retired face/legacy attendance EXECUTE contract differs: % %',v_signature,v_role;
      end if;
    end loop;
  end loop;
  foreach v_relation in array array['public.biometric_references','private.biometric_material','private.biometric_receipts','private.attendance_selfie_receipts'] loop
    v_oid:=to_regclass(v_relation);
    if v_oid is null or not exists(select 1 from pg_class where oid=v_oid and relrowsecurity) then
      raise exception 'selfie-only private/retired table RLS contract differs: %',v_relation;
    end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(v_role,v_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'selfie-only private/retired table privilege contract differs: % %',v_relation,v_role;
      end if;
    end loop;
  end loop;
  if (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
      where a.attrelid='private.attendance_selfie_receipts'::regclass and a.attnum>0 and not a.attisdropped)
      is distinct from array['id','employee_id','selfie_path','selfie_sha256','storage_object_id','shift','latitude','longitude','accuracy_m',
        'geo_captured_at','selfie_captured_at','selfie_outlet_name','assignment_id','outlet_id','created_at','expires_at','consumed_at']::text[]
    or exists(select 1 from pg_attribute where attrelid='private.attendance_selfie_receipts'::regclass and attnum>0
      and not attisdropped and attnotnull is distinct from (attname<>'consumed_at')) then
    raise exception 'selfie receipt column/nullability contract differs';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='private.attendance_selfie_receipts'::regclass
      and c.contype='p' and c.conkey=array[1]::smallint[] and c.convalidated and not c.condeferrable)
    or (select count(*) from pg_constraint where conrelid='private.attendance_selfie_receipts'::regclass and contype='f')<>3
    or exists(select 1 from pg_constraint c where c.conrelid='private.attendance_selfie_receipts'::regclass and c.contype='f'
      and (not c.convalidated or c.condeferrable or c.confdeltype<>'a' or c.confupdtype<>'a'
        or not ((c.conkey=array[2]::smallint[] and c.confrelid='public.employees'::regclass)
          or (c.conkey=array[13]::smallint[] and c.confrelid='public.cashier_assignments'::regclass)
          or (c.conkey=array[14]::smallint[] and c.confrelid='public.outlets'::regclass)))) then
    raise exception 'selfie receipt PK/FK linkage contract differs';
  end if;
  if exists(select 1 from pg_publication_tables where schemaname='public' and tablename='biometric_references') then
    raise exception 'retired face references remain in Realtime publication';
  end if;
  if not exists(select 1 from storage.buckets where id='biometric-references' and public=false)
    or not exists(select 1 from storage.buckets where id='attendance-selfies' and public=false) then
    raise exception 'private selfie/reference bucket contract differs';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass
      and tgname='protect_verified_selfie_delete' and tgenabled='O' and not tgisinternal
      and tgfoid='private.protect_verified_selfie_delete()'::regprocedure and tgtype=11
      and tgqual is null and tgnargs=0 and tgargs=''::bytea and tgattr=''::int2vector and not tgdeferrable
      and tgoldtable is null and tgnewtable is null
      and not tginitdeferred and tgconstraint=0) then
    raise exception 'selfie Storage delete trigger contract differs';
  end if;
  raise notice 'Selfie-only release27 contracts OK: no face enrollment/matching access, private historical evidence, live-session receipt authorization and protected selfie Storage';
end $selfie_only_contract$;
