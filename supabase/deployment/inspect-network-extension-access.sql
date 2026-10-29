-- Read-only managed-extension inventory. Independently verify the intended
-- project/ref before use. This reports OPEN grants and does not close them.
-- No HTTP request, HR data, Auth token, or configuration secret is read.
begin read only;
select current_user as actor, session_user as session_actor,
  (select rolsuper from pg_roles where rolname=current_user) as actor_superuser,
  e.extname,e.extversion,e.extrelocatable,n.nspname as extension_namespace,
  pg_get_userbyid(e.extowner) as extension_owner
from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_net';
select n.nspname,pg_get_userbyid(n.nspowner) as schema_owner,
  has_schema_privilege('anon',n.oid,'USAGE') as anon_usage,
  has_schema_privilege('authenticated',n.oid,'USAGE') as authenticated_usage,
  has_schema_privilege('service_role',n.oid,'USAGE') as service_usage,
  pg_has_role(current_user,n.nspowner,'USAGE') as actor_owner_membership
from pg_namespace n where n.nspname='net';
select p.oid::regprocedure as routine,pg_get_userbyid(p.proowner) as routine_owner,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  has_function_privilege(current_user,p.oid,'EXECUTE WITH GRANT OPTION') as actor_grant_option
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='net' and p.prokind='f' order by p.oid::regprocedure::text;
commit;
