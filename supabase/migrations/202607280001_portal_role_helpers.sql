-- Portal user-account role management helpers.
--
-- Idempotent functions to grant or revoke a portal role for an existing
-- Supabase Auth user, keyed by email. They return a human-readable status
-- string so there is never a silent "0 rows affected" — you always know whether
-- the login was found and the role applied.
--
-- SECURITY: these are SECURITY DEFINER (they touch auth.users and bypass RLS),
-- so execution is revoked from anon/authenticated to prevent privilege
-- escalation. Run them from the Supabase SQL editor (postgres role) or via the
-- service role only, e.g.:
--
--   select public.grant_portal_role('person@example.com', 'admin');
--   select public.revoke_portal_role('person@example.com');
--
-- The login itself (email + password) is still created in Supabase
-- Authentication; these helpers only manage the portal profile + role.

create or replace function public.grant_portal_role(target_email text, target_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_user record;
  role_row  public.roles;
begin
  select id, email into auth_user
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;

  if auth_user.id is null then
    return format('No Supabase login found for %s — create it in Authentication -> Users first.', target_email);
  end if;

  select * into role_row from public.roles where code = lower(trim(target_role));
  if role_row.id is null then
    return format('Unknown role code %s. Valid: admin, registration, cashier, accounting, training_operations, hr, instructor.', target_role);
  end if;

  insert into public.profiles (id, email, complete_name, account_state)
  values (
    auth_user.id,
    auth_user.email,
    coalesce((select complete_name from public.profiles where id = auth_user.id), auth_user.email),
    'Active'
  )
  on conflict (id) do update set account_state = 'Active';

  insert into public.user_roles (user_id, role_id)
  values (auth_user.id, role_row.id)
  on conflict (user_id, role_id) do nothing;

  return format('OK — granted "%s" to %s (%s).', role_row.code, auth_user.email, auth_user.id);
end;
$$;

create or replace function public.revoke_portal_role(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_user record;
begin
  select id, email into auth_user
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;

  if auth_user.id is null then
    return format('No Supabase login found for %s.', target_email);
  end if;

  delete from public.user_roles where user_id = auth_user.id;
  update public.profiles set account_state = 'Deactivated' where id = auth_user.id;

  return format('OK — revoked all portal roles from %s and deactivated the profile.', auth_user.email);
end;
$$;

-- Only the service role / postgres may execute these. Never anon/authenticated.
revoke all on function public.grant_portal_role(text, text) from public;
revoke all on function public.grant_portal_role(text, text) from anon;
revoke all on function public.grant_portal_role(text, text) from authenticated;
revoke all on function public.revoke_portal_role(text) from public;
revoke all on function public.revoke_portal_role(text) from anon;
revoke all on function public.revoke_portal_role(text) from authenticated;
