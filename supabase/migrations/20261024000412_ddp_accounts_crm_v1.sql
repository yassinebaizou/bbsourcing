-- =====================================================================
-- DDP Sourcing — migration 20261024000412_ddp_accounts_crm_v1
-- Applied to Supabase project DDPSOURCING (sdspalqmmbvyucfwgezx) on 2026-10-24.
-- Client accounts, sourcing requests, internal CRM, payments 40/60.
-- Do NOT re-run on that project. New changes go in a new migration file.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Status list (shared by the client portal and the CRM)
-- ---------------------------------------------------------------------
create table public.request_statuses (
  code          text primary key,
  rank          int  not null unique,
  label         text not null,          -- label shown to the team
  client_stage  text not null           -- simplified label shown to the client
);

insert into public.request_statuses (code, rank, label, client_stage) values
  ('new_application',        1,  'New application',            'Request received'),
  ('under_review',           2,  'Under review',               'Request received'),
  ('contact_pending',        3,  'Customer contact pending',   'Request received'),
  ('contacted',              4,  'Customer contacted',         'Request received'),
  ('feasibility_confirmed',  5,  'Sourcing feasibility confirmed', 'Sourcing and quotation'),
  ('quotation_in_progress',  6,  'Quotation in progress',      'Sourcing and quotation'),
  ('awaiting_confirmation',  7,  'Awaiting customer confirmation', 'Quotation sent'),
  ('awaiting_deposit',       8,  'Awaiting 40% deposit',       'Awaiting 40% deposit'),
  ('order_processing',       9,  'Order processing',           'Order in production'),
  ('quality_inspection',    10,  'Quality inspection',         'Quality inspection'),
  ('air_shipping',          11,  'Express air shipping',       'Shipping and customs'),
  ('customs_clearance',     12,  'Customs clearance',          'Shipping and customs'),
  ('arrived_morocco',       13,  'Arrived in Morocco',         'Arrived in Morocco'),
  ('awaiting_final_payment',14,  'Awaiting final 60% payment', 'Awaiting final 60% payment'),
  ('ready_for_delivery',    15,  'Ready for delivery',         'Out for delivery'),
  ('out_for_delivery',      16,  'Out for delivery',           'Out for delivery'),
  ('completed',             17,  'Completed',                  'Delivered'),
  ('not_qualified',         99,  'Not qualified or cancelled', 'Closed');

create or replace function public.status_rank(s text)
returns int language sql immutable set search_path = public as $$
  select case s
    when 'new_application' then 1 when 'under_review' then 2
    when 'contact_pending' then 3 when 'contacted' then 4
    when 'feasibility_confirmed' then 5 when 'quotation_in_progress' then 6
    when 'awaiting_confirmation' then 7 when 'awaiting_deposit' then 8
    when 'order_processing' then 9 when 'quality_inspection' then 10
    when 'air_shipping' then 11 when 'customs_clearance' then 12
    when 'arrived_morocco' then 13 when 'awaiting_final_payment' then 14
    when 'ready_for_delivery' then 15 when 'out_for_delivery' then 16
    when 'completed' then 17 when 'not_qualified' then 99
  end
$$;

-- ---------------------------------------------------------------------
-- 2. People: client profiles and team members
-- ---------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text not null default '',
  whatsapp        text not null default '',
  city            text not null default '',
  business_name   text,
  store_link      text,
  selling_status  text check (selling_status in ('starting','selling','scaling')),
  created_at      timestamptz not null default now()
);

create table public.staff (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  role        text not null check (role in ('admin','agent','ops_finance')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

-- Role of the logged-in person (null = client or visitor).
create or replace function public.staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid() and active
$$;

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A profile's id and email always mirror the login account.
create or replace function public.profiles_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------
-- 3. Sourcing requests
-- ---------------------------------------------------------------------
create sequence public.request_code_seq start 1001;

create table public.requests (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique default ('BS-' || nextval('public.request_code_seq')),
  client_id            uuid not null default auth.uid() references public.profiles(id) on delete cascade,

  -- Product (filled by the client)
  product_name         text not null check (length(product_name) between 2 and 200),
  category             text not null,
  product_link         text,
  quantity             int  not null check (quantity > 0),
  estimated_value_mad  numeric(12,2) not null check (estimated_value_mad >= 0),
  target_unit_cost_mad numeric(12,2),
  alibaba_price_usd    numeric(12,2),
  unit_weight_g        numeric(10,1),
  estimator_price_mad  numeric(12,2),
  specifications       text,
  order_type           text not null check (order_type in ('new','restock')),
  budget_range         text not null,
  urgency              text not null,
  client_notes         text,
  delivery_city        text,
  consent_whatsapp     boolean not null check (consent_whatsapp),
  privacy_accepted     boolean not null check (privacy_accepted),

  -- Minimum order: MAD 5,000 OR 100 units. Below both = flagged for manual review.
  below_minimum        boolean generated always as (quantity < 100 and estimated_value_mad < 5000) stored,

  -- Managed by the team
  status               text not null default 'new_application' references public.request_statuses(code),
  assigned_to          uuid references public.staff(user_id) on delete set null,
  quote_amount_mad     numeric(12,2) check (quote_amount_mad > 0),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index requests_client_idx on public.requests(client_id);
create index requests_status_idx on public.requests(status);
create index requests_assigned_idx on public.requests(assigned_to);

-- Internal-only fields, kept out of the client's reach.
create table public.request_internal (
  request_id        uuid primary key references public.requests(id) on delete cascade,
  next_action       text,
  next_action_date  date,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id)
);

-- Can the logged-in team member see this request?
--   Administrator: everything
--   Sourcing Agent: requests assigned to them
--   Operations & Finance: confirmed orders (from "Awaiting 40% deposit" onward)
create or replace function public.staff_can_see(p_assigned uuid, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.staff_role()
    when 'admin'       then true
    when 'agent'       then p_assigned = auth.uid()
    when 'ops_finance' then public.status_rank(p_status) between 8 and 17
    else false
  end
$$;

create or replace function public.can_see_request(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.requests r
    where r.id = p_request
      and (r.client_id = auth.uid() or public.staff_can_see(r.assigned_to, r.status))
  )
$$;

create or replace function public.staff_can_see_request(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.requests r
    where r.id = p_request and public.staff_can_see(r.assigned_to, r.status)
  )
$$;

-- ---------------------------------------------------------------------
-- 4. Payments (40% deposit / 60% balance) — tracking only, no online payment
-- ---------------------------------------------------------------------
create table public.payments (
  request_id            uuid primary key references public.requests(id) on delete cascade,
  final_price_mad       numeric(12,2) not null check (final_price_mad > 0),
  deposit_amount_mad    numeric(12,2) generated always as (round(final_price_mad * 0.40, 2)) stored,
  balance_amount_mad    numeric(12,2) generated always as (final_price_mad - round(final_price_mad * 0.40, 2)) stored,

  deposit_status        text not null default 'pending' check (deposit_status in ('pending','received','verified')),
  deposit_date          date,
  deposit_reference     text,
  deposit_proof_path    text,
  deposit_verified_by   uuid references public.profiles(id),
  deposit_verified_at   timestamptz,

  final_status          text not null default 'not_due' check (final_status in ('not_due','pending','received','verified')),
  final_date            date,
  final_reference       text,
  final_proof_path      text,
  final_verified_by     uuid references public.profiles(id),
  final_verified_at     timestamptz,

  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Notes, files and activity log
-- ---------------------------------------------------------------------
create table public.request_notes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles(id),
  kind        text not null default 'note' check (kind in ('note','contact')),
  body        text not null check (length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index request_notes_req_idx on public.request_notes(request_id);

create table public.request_files (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.requests(id) on delete cascade,
  path         text not null unique,
  file_name    text not null,
  kind         text not null default 'product_image' check (kind in ('product_image','payment_proof','other')),
  uploaded_by  uuid not null default auth.uid() references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index request_files_req_idx on public.request_files(request_id);

create table public.request_events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests(id) on delete cascade,
  actor_id    uuid references public.profiles(id),
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index request_events_req_idx on public.request_events(request_id, created_at desc);

create or replace function public.log_event(p_request uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.request_events (request_id, actor_id, action, details)
  values (p_request, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb))
$$;
revoke execute on function public.log_event(uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------
-- 6. Business rules (enforced in the database, not only in the screens)
-- ---------------------------------------------------------------------

-- New request: a client can only create a fresh, unassigned request for themselves.
create or replace function public.requests_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() is distinct from 'admin' then
    new.client_id        := auth.uid();
    new.status           := 'new_application';
    new.assigned_to      := null;
    new.quote_amount_mad := null;
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

create trigger requests_before_insert
  before insert on public.requests
  for each row execute function public.requests_before_insert();

-- Updates: what each role is allowed to change.
create or replace function public.requests_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r        text := public.staff_role();
  old_rank int  := public.status_rank(old.status);
  new_rank int  := public.status_rank(new.status);
  pay      public.payments%rowtype;
begin
  if r is null then
    raise exception 'Only team members can update requests';
  end if;

  -- Identity of the request never changes (except by an administrator).
  if r <> 'admin' and (new.client_id <> old.client_id or new.code <> old.code or new.created_at <> old.created_at) then
    raise exception 'Only an administrator can change the request owner or reference';
  end if;

  -- Assignment: administrators only.
  if new.assigned_to is distinct from old.assigned_to and r <> 'admin' then
    raise exception 'Only an administrator can assign requests';
  end if;
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to
     and not exists (select 1 from public.staff where user_id = new.assigned_to and active) then
    raise exception 'Requests can only be assigned to an active team member';
  end if;

  -- Product details: administrators and the assigned sourcing agent.
  if r = 'ops_finance' and (
       new.product_name is distinct from old.product_name or new.category is distinct from old.category or
       new.product_link is distinct from old.product_link or new.quantity is distinct from old.quantity or
       new.estimated_value_mad is distinct from old.estimated_value_mad or
       new.specifications is distinct from old.specifications) then
    raise exception 'Operations & Finance cannot edit product details';
  end if;

  select * into pay from public.payments where request_id = old.id;

  -- Quotation: administrators and sourcing agents, locked once the deposit is verified.
  if new.quote_amount_mad is distinct from old.quote_amount_mad then
    if r = 'ops_finance' then
      raise exception 'Operations & Finance cannot change the quotation';
    end if;
    if found and pay.deposit_status = 'verified' and r <> 'admin' then
      raise exception 'The quotation is locked after the deposit is verified';
    end if;
  end if;

  -- Status changes.
  if new.status <> old.status then
    if r = 'agent' and not (old_rank <= 8 and (new_rank <= 8 or new.status = 'not_qualified')) then
      raise exception 'Sourcing agents manage stages up to "Awaiting 40%% deposit"';
    end if;
    if r = 'ops_finance' and not (old_rank between 8 and 17 and (new_rank between 8 and 17 or new.status = 'not_qualified')) then
      raise exception 'Operations & Finance manage stages from "Awaiting 40%% deposit" onward';
    end if;

    if new.status <> 'not_qualified' then
      if new_rank >= 8 and new.quote_amount_mad is null then
        raise exception 'Enter the final quotation before asking for the deposit';
      end if;
      if new_rank >= 9 and (pay.request_id is null or pay.deposit_status <> 'verified') then
        raise exception 'The 40%% deposit must be verified before the order moves into purchasing';
      end if;
      if new_rank >= 15 and pay.final_status <> 'verified' then
        raise exception 'The final 60%% payment must be verified before delivery';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger requests_before_update
  before update on public.requests
  for each row execute function public.requests_before_update();

-- Keep payments in line with the request and record activity.
create or replace function public.requests_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.request_internal (request_id) values (new.id);
    perform public.log_event(new.id, 'request_created', jsonb_build_object('code', new.code));
    return new;
  end if;

  if new.quote_amount_mad is distinct from old.quote_amount_mad then
    if new.quote_amount_mad is not null then
      insert into public.payments (request_id, final_price_mad)
      values (new.id, new.quote_amount_mad)
      on conflict (request_id) do update set final_price_mad = excluded.final_price_mad, updated_at = now();
    end if;
    perform public.log_event(new.id, 'quote_updated',
      jsonb_build_object('from', old.quote_amount_mad, 'to', new.quote_amount_mad));
  end if;

  if new.status <> old.status then
    if new.status = 'awaiting_final_payment' then
      update public.payments set final_status = 'pending', updated_at = now()
      where request_id = new.id and final_status = 'not_due';
    end if;
    perform public.log_event(new.id, 'status_changed',
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.log_event(new.id, 'assigned',
      jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  return new;
end $$;

create trigger requests_after_insert
  after insert on public.requests
  for each row execute function public.requests_after_change();
create trigger requests_after_update
  after update on public.requests
  for each row execute function public.requests_after_change();

-- Payments: stamp who verified, and log every change.
create or replace function public.payments_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role();
begin
  -- Updates made by the database itself (quote sync, stage changes) skip the role check.
  if pg_trigger_depth() > 1 then
    new.updated_at := now();
    return new;
  end if;
  if r is null or r not in ('admin','ops_finance') then
    raise exception 'Only Operations & Finance or an administrator can record payments';
  end if;
  if new.final_price_mad is distinct from old.final_price_mad and old.deposit_status = 'verified' and r <> 'admin' then
    raise exception 'The final price is locked after the deposit is verified';
  end if;
  -- Un-verifying a payment is a correction: administrators only.
  if (old.deposit_status = 'verified' and new.deposit_status <> 'verified')
     or (old.final_status = 'verified' and new.final_status <> 'verified') then
    if r <> 'admin' then raise exception 'Only an administrator can undo a verified payment'; end if;
  end if;

  if new.deposit_status = 'verified' and old.deposit_status <> 'verified' then
    new.deposit_verified_by := auth.uid(); new.deposit_verified_at := now();
  elsif new.deposit_status <> 'verified' then
    new.deposit_verified_by := null; new.deposit_verified_at := null;
  else
    new.deposit_verified_by := old.deposit_verified_by; new.deposit_verified_at := old.deposit_verified_at;
  end if;

  if new.final_status = 'verified' and old.final_status <> 'verified' then
    if new.deposit_status <> 'verified' then
      raise exception 'Verify the 40%% deposit before the final payment';
    end if;
    new.final_verified_by := auth.uid(); new.final_verified_at := now();
  elsif new.final_status <> 'verified' then
    new.final_verified_by := null; new.final_verified_at := null;
  else
    new.final_verified_by := old.final_verified_by; new.final_verified_at := old.final_verified_at;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger payments_before_update
  before update on public.payments
  for each row execute function public.payments_before_update();

create or replace function public.payments_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deposit_status <> old.deposit_status then
    perform public.log_event(new.request_id, 'deposit_' || new.deposit_status,
      jsonb_build_object('amount', new.deposit_amount_mad, 'reference', new.deposit_reference));
  end if;
  if new.final_status <> old.final_status then
    perform public.log_event(new.request_id, 'final_payment_' || new.final_status,
      jsonb_build_object('amount', new.balance_amount_mad, 'reference', new.final_reference));
  end if;
  return new;
end $$;

create trigger payments_after_update
  after update on public.payments
  for each row execute function public.payments_after_update();

-- Notes and files: always stamped with the real author.
create or replace function public.stamp_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'request_notes' then
    new.author_id := auth.uid();
    new.created_at := now();
    perform public.log_event(new.request_id, case new.kind when 'contact' then 'customer_contacted' else 'note_added' end, '{}'::jsonb);
  else
    new.uploaded_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end $$;

create trigger request_notes_stamp before insert on public.request_notes
  for each row execute function public.stamp_author();
create trigger request_files_stamp before insert on public.request_files
  for each row execute function public.stamp_author();

create or replace function public.request_internal_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger request_internal_stamp before update on public.request_internal
  for each row execute function public.request_internal_stamp();

-- ---------------------------------------------------------------------
-- 7. Team management (administrators)
-- ---------------------------------------------------------------------
-- The new team member first creates a normal account on /account,
-- then an administrator adds them by email from the CRM.
create or replace function public.add_staff(p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if public.staff_role() is distinct from 'admin' then
    raise exception 'Only an administrator can manage the team';
  end if;
  if p_role not in ('admin','agent','ops_finance') then
    raise exception 'Unknown role';
  end if;
  -- Look the person up by their real login email (not the editable profile).
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No account found for this email. Ask the person to create an account first.';
  end if;
  insert into public.staff (user_id, role, active, created_by)
  values (uid, p_role, true, auth.uid())
  on conflict (user_id) do update set role = excluded.role, active = true;
  return uid;
end $$;

create or replace function public.staff_before_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() is distinct from 'admin' then
    raise exception 'Only an administrator can manage the team';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and (new.role <> 'admin' or not new.active) then
    raise exception 'You cannot remove your own administrator access';
  end if;
  return new;
end $$;
create trigger staff_before_update before update on public.staff
  for each row execute function public.staff_before_change();

-- ---------------------------------------------------------------------
-- 8. Row-level security: who can read and write what
-- ---------------------------------------------------------------------
alter table public.request_statuses enable row level security;
alter table public.profiles         enable row level security;
alter table public.staff            enable row level security;
alter table public.requests         enable row level security;
alter table public.request_internal enable row level security;
alter table public.payments         enable row level security;
alter table public.request_notes    enable row level security;
alter table public.request_files    enable row level security;
alter table public.request_events   enable row level security;

-- Supabase grants every new table and function to anon/authenticated by default.
-- Remove all of that, then grant back only what the pages need.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- Helpers used inside the security rules below.
grant execute on function public.status_rank(text) to authenticated;
grant execute on function public.staff_can_see(uuid, text) to authenticated;
grant execute on function public.can_see_request(uuid) to authenticated;
grant execute on function public.staff_can_see_request(uuid) to authenticated;

grant select on public.request_statuses to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.staff to authenticated;
grant select, insert, update, delete on public.requests to authenticated;
grant usage on sequence public.request_code_seq to authenticated;
grant select, update on public.request_internal to authenticated;
grant select, update on public.payments to authenticated;
grant select, insert on public.request_notes to authenticated;
grant select, insert on public.request_files to authenticated;
grant select on public.request_events to authenticated;
grant execute on function public.add_staff(text, text) to authenticated;
grant execute on function public.staff_role() to authenticated;

create policy statuses_read on public.request_statuses for select to authenticated using (true);

-- Profiles: you see and edit your own; the team sees everyone's.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.staff_role() is not null);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.staff_role() = 'admin');

-- Staff list: visible to the team, managed by administrators.
create policy staff_read on public.staff for select to authenticated
  using (public.staff_role() is not null or user_id = auth.uid());
create policy staff_admin_update on public.staff for update to authenticated
  using (public.staff_role() = 'admin');

-- Requests
create policy requests_client_insert on public.requests for insert to authenticated
  with check (client_id = auth.uid());
create policy requests_read on public.requests for select to authenticated
  using (client_id = auth.uid() or public.staff_can_see(assigned_to, status));
create policy requests_staff_update on public.requests for update to authenticated
  using (public.staff_can_see(assigned_to, status));
create policy requests_admin_delete on public.requests for delete to authenticated
  using (public.staff_role() = 'admin');

-- Internal fields: team only.
create policy internal_read on public.request_internal for select to authenticated
  using (public.staff_can_see_request(request_id));
create policy internal_update on public.request_internal for update to authenticated
  using (public.staff_can_see_request(request_id) and public.staff_role() in ('admin','agent','ops_finance'));

-- Payments: team only. Recording and verifying: Operations & Finance and administrators.
create policy payments_read on public.payments for select to authenticated
  using (public.staff_can_see_request(request_id));
create policy payments_update on public.payments for update to authenticated
  using (public.staff_role() in ('admin','ops_finance') and public.staff_can_see_request(request_id));

-- Notes: team only.
create policy notes_read on public.request_notes for select to authenticated
  using (public.staff_can_see_request(request_id));
create policy notes_insert on public.request_notes for insert to authenticated
  with check (public.staff_can_see_request(request_id));

-- Files: the client sees and adds product images on their own requests; the team sees all it can access.
create policy files_read on public.request_files for select to authenticated
  using (
    (kind = 'product_image' and exists (select 1 from public.requests r where r.id = request_id and r.client_id = auth.uid()))
    or public.staff_can_see_request(request_id)
  );
create policy files_client_insert on public.request_files for insert to authenticated
  with check (
    kind = 'product_image'
    and exists (select 1 from public.requests r where r.id = request_id and r.client_id = auth.uid())
    and split_part(path, '/', 1) = auth.uid()::text
  );
create policy files_staff_insert on public.request_files for insert to authenticated
  with check (public.staff_can_see_request(request_id) and split_part(path, '/', 1) = 'staff');

-- Activity log: team only (written by the database itself).
create policy events_read on public.request_events for select to authenticated
  using (public.staff_can_see_request(request_id));

-- ---------------------------------------------------------------------
-- 9. File storage (product images and payment proofs) — private bucket
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('request-files', 'request-files', false)
on conflict (id) do nothing;

-- Clients upload into their own folder: <their user id>/<request id>/<file>
create policy "clients upload own files" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "clients read own files" on storage.objects for select to authenticated
  using (bucket_id = 'request-files' and (storage.foldername(name))[1] = auth.uid()::text);
-- Team uploads into staff/<request id>/<file> and reads everything in the bucket.
create policy "team upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-files' and (storage.foldername(name))[1] = 'staff' and public.staff_role() is not null);
create policy "team read files" on storage.objects for select to authenticated
  using (bucket_id = 'request-files' and public.staff_role() is not null);

-- =====================================================================
-- After creating your own account on /account, make yourself the first
-- administrator (replace the email, then run this line alone):
--
--   insert into public.staff (user_id, role)
--   select id, 'admin' from public.profiles where email = 'you@example.com';
--
-- (This works from the SQL Editor because it runs with full rights.)
-- =====================================================================
