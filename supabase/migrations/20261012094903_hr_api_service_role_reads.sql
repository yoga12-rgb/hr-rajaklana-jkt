-- hr-api performs these two direct reads for bootstrap, login and link recovery.
-- BYPASSRLS does not imply table SELECT privilege. Explicit grants also support
-- existing Supabase projects whose default table privileges differ from new ones.
-- All writes remain behind the existing service-only/security-definer RPCs.
grant select on table public.employees, public.employee_roles to service_role;
