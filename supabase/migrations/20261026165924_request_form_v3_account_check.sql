-- Request form v3 (owner's request): no budget or desired arrival in the request form.
alter table public.requests alter column budget_range drop not null;
alter table public.requests alter column urgency drop not null;

-- At the last step of the request form the visitor types an email; the page asks
-- "log in" or "choose a password" depending on whether an account already exists.
-- Returns only true/false. Signup itself already reveals this, so nothing new is exposed.
create or replace function public.account_exists(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where lower(u.email) = lower(trim(p_email)));
$$;
revoke execute on function public.account_exists(text) from public;
grant execute on function public.account_exists(text) to anon, authenticated;
