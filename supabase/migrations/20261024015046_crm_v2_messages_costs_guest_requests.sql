-- =====================================================================
-- DDP Sourcing — CRM v2
--   1. Two-way conversation per request (client <-> team) + automatic
--      stage updates shown to the client
--   2. Unread tracking per person per request
--   3. Order costs and profit (Administrator + Operations & Finance only)
--   4. "Fill first, sign up last": a request filled before having an account
--      is created server-side by the signup trigger
-- Builds on 20261024000412_ddp_accounts_crm_v1 and its follow-up fix.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Conversation
-- ---------------------------------------------------------------------
create table public.request_messages (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.requests(id) on delete cascade,
  author_id        uuid references public.profiles(id) on delete set null,  -- null = automatic update
  from_team        boolean not null default false,
  kind             text not null default 'message' check (kind in ('message','update')),
  body             text not null check (length(body) between 1 and 5000),
  attachment_path  text,
  attachment_name  text,
  created_at       timestamptz not null default now()
);
create index request_messages_req_idx on public.request_messages(request_id, created_at);

-- Every message is stamped by the database: real author, team or client side,
-- and an attachment can only point to the author's own folder for this request.
create or replace function public.request_messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role();
begin
  new.created_at := now();
  -- Automatic updates are written by other triggers only.
  if pg_trigger_depth() > 1 and new.kind = 'update' then
    new.author_id := null;
    new.from_team := true;
    new.attachment_path := null;
    new.attachment_name := null;
    return new;
  end if;

  new.kind := 'message';
  new.author_id := auth.uid();
  new.from_team := r is not null;

  if new.attachment_path is not null then
    if r is not null then
      if split_part(new.attachment_path, '/', 1) <> 'staff'
         or split_part(new.attachment_path, '/', 2) <> new.request_id::text then
        raise exception 'Attachments must be uploaded for this request';
      end if;
    else
      if split_part(new.attachment_path, '/', 1) <> auth.uid()::text
         or split_part(new.attachment_path, '/', 2) <> new.request_id::text then
        raise exception 'Attachments must be uploaded for this request';
      end if;
    end if;
  else
    new.attachment_name := null;
  end if;
  return new;
end $$;

create trigger request_messages_before_insert
  before insert on public.request_messages
  for each row execute function public.request_messages_before_insert();

create or replace function public.request_messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'message' then
    perform public.log_event(new.request_id,
      case when new.from_team then 'message_to_client' else 'message_from_client' end, '{}'::jsonb);
  end if;
  return new;
end $$;

create trigger request_messages_after_insert
  after insert on public.request_messages
  for each row execute function public.request_messages_after_insert();

-- ---------------------------------------------------------------------
-- 2. Unread tracking
-- ---------------------------------------------------------------------
create table public.message_reads (
  request_id    uuid not null references public.requests(id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (request_id, user_id)
);

create or replace function public.message_reads_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.last_read_at := now();
  return new;
end $$;

create trigger message_reads_stamp
  before insert or update on public.message_reads
  for each row execute function public.message_reads_stamp();

-- ---------------------------------------------------------------------
-- 3. Order costs and profit
-- ---------------------------------------------------------------------
create table public.order_costs (
  request_id          uuid primary key references public.requests(id) on delete cascade,
  product_cost_mad    numeric(12,2) not null default 0 check (product_cost_mad >= 0),
  china_handling_mad  numeric(12,2) not null default 0 check (china_handling_mad >= 0),
  air_freight_mad     numeric(12,2) not null default 0 check (air_freight_mad >= 0),
  customs_duties_mad  numeric(12,2) not null default 0 check (customs_duties_mad >= 0),
  local_delivery_mad  numeric(12,2) not null default 0 check (local_delivery_mad >= 0),
  other_costs_mad     numeric(12,2) not null default 0 check (other_costs_mad >= 0),
  total_cost_mad      numeric(12,2) generated always as (
    product_cost_mad + china_handling_mad + air_freight_mad +
    customs_duties_mad + local_delivery_mad + other_costs_mad) stored,
  notes               text check (length(notes) <= 2000),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id)
);

create or replace function public.order_costs_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() is null or public.staff_role() not in ('admin','ops_finance') then
    raise exception 'Only Operations & Finance or an administrator can record costs';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger order_costs_stamp
  before insert or update on public.order_costs
  for each row execute function public.order_costs_stamp();

create or replace function public.order_costs_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_event(new.request_id, 'costs_updated', jsonb_build_object('total', new.total_cost_mad));
  return new;
end $$;

create trigger order_costs_after_change
  after insert or update on public.order_costs
  for each row execute function public.order_costs_after_change();

-- ---------------------------------------------------------------------
-- 4. Automatic client update when the client-facing stage changes
--    (replaces requests_after_change; everything else is unchanged)
-- ---------------------------------------------------------------------
create or replace function public.requests_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_stage text;
  new_stage text;
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

    select client_stage into old_stage from public.request_statuses where code = old.status;
    select client_stage into new_stage from public.request_statuses where code = new.status;
    if new_stage is distinct from old_stage then
      insert into public.request_messages (request_id, kind, body)
      values (new.id, 'update', 'Status update: ' || new_stage);
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.log_event(new.id, 'assigned',
      jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Fill first, sign up last
-- ---------------------------------------------------------------------
-- A request created by the signup trigger keeps the new account as its owner
-- (auth.uid() is not set yet at signup). Everything else stays forced.
create or replace function public.requests_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    new.status           := 'new_application';
    new.assigned_to      := null;
    new.quote_amount_mad := null;
  elsif public.staff_role() is distinct from 'admin' then
    new.client_id        := auth.uid();
    new.status           := 'new_application';
    new.assigned_to      := null;
    new.quote_amount_mad := null;
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

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

  -- A request filled before signing up. A malformed one never blocks the signup.
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
      null;
    end;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Row-level security and grants
-- ---------------------------------------------------------------------
alter table public.request_messages enable row level security;
alter table public.message_reads    enable row level security;
alter table public.order_costs      enable row level security;

revoke all on public.request_messages, public.message_reads, public.order_costs from anon, authenticated;
revoke execute on function public.request_messages_before_insert(), public.request_messages_after_insert(),
  public.message_reads_stamp(), public.order_costs_stamp(), public.order_costs_after_change()
  from anon, authenticated, public;

grant select, insert on public.request_messages to authenticated;
grant select, insert, update on public.message_reads to authenticated;
grant select, insert, update on public.order_costs to authenticated;

-- Conversation: the client of the request and the team members who can see it.
create policy messages_read on public.request_messages for select to authenticated
  using (public.can_see_request(request_id));
create policy messages_insert on public.request_messages for insert to authenticated
  with check (public.can_see_request(request_id));

-- Read markers: your own only, on requests you can see.
create policy reads_select on public.message_reads for select to authenticated
  using (user_id = auth.uid());
create policy reads_insert on public.message_reads for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_request(request_id));
create policy reads_update on public.message_reads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Costs: Administrator and Operations & Finance, on requests they can see.
create policy costs_read on public.order_costs for select to authenticated
  using (public.staff_role() in ('admin','ops_finance') and public.staff_can_see_request(request_id));
create policy costs_insert on public.order_costs for insert to authenticated
  with check (public.staff_role() in ('admin','ops_finance') and public.staff_can_see_request(request_id));
create policy costs_update on public.order_costs for update to authenticated
  using (public.staff_role() in ('admin','ops_finance') and public.staff_can_see_request(request_id))
  with check (public.staff_role() in ('admin','ops_finance') and public.staff_can_see_request(request_id));

-- Storage: a client can open a file the team attached to their own conversation.
-- (Payment proofs are never attached to messages, so they stay team-only.)
create policy "clients read team message files" on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (storage.foldername(name))[1] = 'staff'
    and exists (
      select 1 from public.request_messages m
      join public.requests r on r.id = m.request_id
      where m.attachment_path = storage.objects.name and r.client_id = auth.uid()
    )
  );
