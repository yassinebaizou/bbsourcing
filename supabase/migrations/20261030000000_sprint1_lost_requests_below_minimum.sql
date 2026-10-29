-- =====================================================================
-- Sprint 1 (docs/WORK_PLAN.md) — ROADMAP A1 and A3
-- =====================================================================

-- A3. "Below min." must work when the form gives no product value (value is optional since v3).
--     A generated column cannot be changed in place: rebuild it (nothing else depends on it).
alter table public.requests drop column below_minimum;
alter table public.requests add column below_minimum boolean
  generated always as (quantity < 100 and coalesce(estimated_value_mad, 0) < 5000) stored;

-- Same limit as the request forms: 1 to 1,000,000 units.
alter table public.requests add constraint requests_quantity_max check (quantity <= 1000000);

-- A1. A request sent at signup that fails a database rule is no longer dropped silently.
--     The signup still succeeds; the request is kept here for the team, and the client's account
--     reopens the form prefilled on first login.
create table public.failed_pending_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  payload      jsonb not null,
  error        text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index failed_pending_open_idx on public.failed_pending_requests(user_id) where resolved_at is null;

alter table public.failed_pending_requests enable row level security;
revoke all on public.failed_pending_requests from anon, authenticated;
grant select on public.failed_pending_requests to authenticated;
grant update (resolved_at) on public.failed_pending_requests to authenticated;
create policy failed_pending_team_read on public.failed_pending_requests for select to authenticated
  using (public.staff_role() is not null);
create policy failed_pending_team_resolve on public.failed_pending_requests for update to authenticated
  using (public.staff_role() is not null) with check (public.staff_role() is not null);

-- The client's own unresolved failed request (only the form fields), so /account can reopen it.
create or replace function public.my_failed_request()
returns jsonb language sql stable security definer set search_path = '' as $$
  select f.payload from public.failed_pending_requests f
  where f.user_id = auth.uid() and f.resolved_at is null
  order by f.created_at desc limit 1;
$$;
revoke execute on function public.my_failed_request() from public, anon;
grant execute on function public.my_failed_request() to authenticated;

-- Once the client sends a request, any failed one is considered handled.
create or replace function public.requests_resolve_failed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.failed_pending_requests set resolved_at = now()
   where user_id = new.client_id and resolved_at is null;
  return new;
end $$;
revoke execute on function public.requests_resolve_failed() from anon, authenticated, public;
create trigger requests_resolve_failed after insert on public.requests
  for each row execute function public.requests_resolve_failed();

-- handle_new_user: same as before, but a failed request is recorded instead of dropped.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare p jsonb := new.raw_user_meta_data->'pending_request';
begin
  insert into public.profiles (id, email, full_name, whatsapp, city, business_name, store_link, selling_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'whatsapp', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    nullif(new.raw_user_meta_data->>'business_name', ''),
    nullif(new.raw_user_meta_data->>'store_link', ''),
    case when new.raw_user_meta_data->>'selling_status' in ('starting','selling','scaling')
         then new.raw_user_meta_data->>'selling_status' end
  );

  if p is not null and jsonb_typeof(p) = 'object' then
    begin
      insert into public.requests (
        client_id, product_name, category, product_link, quantity, estimated_value_mad,
        target_unit_cost_mad, alibaba_price_usd, unit_weight_g, estimator_price_mad,
        specifications, order_type, budget_range, urgency, client_notes, delivery_city,
        consent_whatsapp, privacy_accepted)
      values (
        new.id,
        left(p->>'product_name', 200),
        p->>'category',
        nullif(left(p->>'product_link', 2000), ''),
        (p->>'quantity')::int,
        (p->>'estimated_value_mad')::numeric,
        nullif(p->>'target_unit_cost_mad', '')::numeric,
        nullif(p->>'alibaba_price_usd', '')::numeric,
        nullif(p->>'unit_weight_g', '')::numeric,
        nullif(p->>'estimator_price_mad', '')::numeric,
        nullif(left(p->>'specifications', 3000), ''),
        p->>'order_type',
        left(p->>'budget_range', 60),
        left(p->>'urgency', 60),
        nullif(left(p->>'client_notes', 3000), ''),
        nullif(left(p->>'delivery_city', 120), ''),
        (p->>'consent_whatsapp')::boolean,
        (p->>'privacy_accepted')::boolean);
    exception when others then
      -- Never block the signup; keep the request for the team and for the client's next login.
      begin
        insert into public.failed_pending_requests (user_id, payload, error) values (new.id, p, left(sqlerrm, 500));
      exception when others then
        null;
      end;
    end;
  end if;
  return new;
end $$;
