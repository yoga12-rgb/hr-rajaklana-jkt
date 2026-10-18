-- Return only this active employee's registration state. The private table
-- stays inaccessible to browser roles; endpoint ownership and key material are
-- never returned by this narrowly scoped lookup.
create function public.push_subscription_status(p_endpoint text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.require_employee();
begin
  return exists(
    select 1 from private.push_subscriptions
    where endpoint = p_endpoint and employee_id = v_actor and disabled_at is null
  );
end;
$$;

revoke all on function public.push_subscription_status(text) from public, anon, authenticated, service_role;
grant execute on function public.push_subscription_status(text) to authenticated;
