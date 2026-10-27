-- Forward-only least-privilege hardening for supervisor operational tables.
--
-- The preceding migrations granted SELECT without first revoking the hosted
-- project's broad default table privileges. RLS currently blocks direct write
-- paths, but the ACL still exposed INSERT/UPDATE/DELETE to anon and/or
-- authenticated. Keep business writes inside the SECURITY DEFINER RPCs below;
-- retain only the scoped SELECT paths already protected by RLS.

revoke all on table
  public.shift_handovers,
  public.shift_handover_versions,
  public.shift_handover_events,
  public.shift_exchange_requests,
  public.shift_exchange_events,
  public.supervisor_issue_categories,
  public.supervisor_capabilities,
  public.supervisor_issue_routes,
  public.outlet_issues,
  public.outlet_issue_events,
  public.staffing_interval_requirements
from public, anon, authenticated;

grant select on table
  public.shift_handovers,
  public.shift_handover_versions,
  public.shift_handover_events,
  public.shift_exchange_requests,
  public.shift_exchange_events,
  public.supervisor_issue_categories,
  public.supervisor_capabilities,
  public.supervisor_issue_routes,
  public.outlet_issues,
  public.outlet_issue_events,
  public.staffing_interval_requirements
to authenticated;

comment on table public.shift_handovers is
  'Direct writes are restricted to the versioned handover RPCs; authenticated SELECT remains RLS-scoped.';
comment on table public.shift_exchange_requests is
  'Direct writes are restricted to the versioned exchange RPCs; authenticated SELECT remains RLS-scoped.';
comment on table public.outlet_issues is
  'Direct writes are restricted to issue RPCs; authenticated SELECT remains RLS-scoped.';
