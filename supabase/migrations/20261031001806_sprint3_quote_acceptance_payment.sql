-- =====================================================================
-- Sprint 3 (docs/WORK_PLAN.md): quote, acceptance and payment inside the account.
--   1. business_settings: one row with the rule numbers and the bank details (admin edits it in
--      CRM -> Settings). Clients never read the table; they get the bank details through
--      my_payment_info() only while one of their requests is waiting for a payment.
--   2. Quote dates: saving a quotation stamps quote_sent_at / quote_expires_at (+ validity days)
--      and shows it to the client ("Quotation sent").
--   3. quote_acceptances: one row per accepted quote, nobody can change or delete it.
--      Client RPCs: accept_quote, decline_quote, cancel_request, submit_payment_proof.
--   4. team_notifications: every client action above emails the team (Edge Function notify-team).
-- Client RPCs change requests/payments through the existing triggers. They mark the change with
-- the transaction setting ddp.client_action, which only these functions can set (PostgREST
-- clients cannot run SET), and the triggers then allow only the fields of that action.
-- =====================================================================

-- 1. Business settings -------------------------------------------------
create table public.business_settings (
  id                       boolean primary key default true check (id),
  terms_version            text    not null default '2026-11-v1',
  quote_validity_days      integer not null default 7  check (quote_validity_days between 1 and 90),
  refund_business_days     integer not null default 7  check (refund_business_days between 1 and 90),
  claim_hours              integer not null default 72 check (claim_hours between 1 and 720),
  delay_grace_days         integer not null default 10 check (delay_grace_days between 0 and 90),
  storage_fee_after_days   integer not null default 7  check (storage_fee_after_days between 0 and 365),
  unpaid_cancel_after_days integer not null default 30 check (unpaid_cancel_after_days between 1 and 365),
  storage_fee_mad          numeric check (storage_fee_mad is null or storage_fee_mad >= 0),
  bank_name                text    not null default 'CFG Bank' check (length(bank_name) between 1 and 100),
  account_holder           text    not null default 'Beast Capital Group' check (length(account_holder) between 1 and 150),
  rib                      text    check (rib is null or length(rib) between 10 and 40),
  iban                     text    check (iban is null or length(iban) between 10 and 40),
  swift                    text    check (swift is null or length(swift) between 8 and 11),
  payment_reference_note   text    not null default 'Write your request code (for example DDP-1012) as the transfer reference.'
                                   check (length(payment_reference_note) between 1 and 300),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id)
);
insert into public.business_settings (id) values (true);

alter table public.business_settings enable row level security;
revoke all on public.business_settings from anon, authenticated;
grant select on public.business_settings to authenticated;
grant update (quote_validity_days, refund_business_days, claim_hours, delay_grace_days,
              storage_fee_after_days, unpaid_cancel_after_days, storage_fee_mad,
              bank_name, account_holder, rib, iban, swift, payment_reference_note)
  on public.business_settings to authenticated;

create policy settings_read on public.business_settings for select to authenticated
  using ((select public.staff_role()) in ('admin', 'ops_finance'));
create policy settings_admin_update on public.business_settings for update to authenticated
  using ((select public.staff_role()) = 'admin') with check ((select public.staff_role()) = 'admin');

create or replace function public.business_settings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := true;
  new.rib   := nullif(btrim(new.rib), '');
  new.iban  := nullif(upper(replace(btrim(new.iban), ' ', '')), '');
  new.swift := nullif(upper(btrim(new.swift)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function public.business_settings_stamp() from anon, authenticated, public;
create trigger business_settings_stamp before update on public.business_settings
  for each row execute function public.business_settings_stamp();

-- Rule numbers for the public pages (/policies, /terms, FAQ). No bank account number.
create or replace function public.public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'termsVersion', terms_version, 'quoteValidityDays', quote_validity_days,
    'refundBusinessDays', refund_business_days, 'claimHours', claim_hours,
    'delayGraceDays', delay_grace_days, 'storageFeeAfterDays', storage_fee_after_days,
    'unpaidCancelAfterDays', unpaid_cancel_after_days, 'storageFeeMad', storage_fee_mad,
    'bankName', bank_name)
  from public.business_settings where id
$$;
revoke execute on function public.public_settings() from public;
grant execute on function public.public_settings() to anon, authenticated;

-- 2. Quote dates and client closing on requests -----------------------
alter table public.requests
  add column quote_sent_at    timestamptz,
  add column quote_expires_at timestamptz,
  add column closed_kind      text check (closed_kind in ('declined', 'cancelled')),
  add column closed_reason    text check (closed_reason is null or length(closed_reason) between 3 and 1000),
  add column closed_at        timestamptz;

grant select (quote_sent_at, quote_expires_at, closed_kind, closed_reason, closed_at)
  on public.requests to authenticated;
grant update (quote_sent_at) on public.requests to authenticated;  -- team "Resend quote"; the trigger sets the value

-- Quotes already waiting for the client get a fresh validity period.
update public.requests
   set quote_sent_at = now(), quote_expires_at = now() + interval '7 days'
 where status = 'awaiting_confirmation' and quote_amount_mad is not null;

create or replace function public.requests_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r        text := public.staff_role();
  act      text := coalesce(current_setting('ddp.client_action', true), '');
  old_rank int  := public.status_rank(old.status);
  new_rank int  := public.status_rank(new.status);
  pay      public.payments%rowtype;
  keep_status text; keep_kind text; keep_reason text;
begin
  if r is null then
    -- Client actions (accept_quote, decline_quote, cancel_request): only status and closing fields change.
    if act in ('accept', 'decline', 'cancel') then
      keep_status := new.status; keep_kind := new.closed_kind; keep_reason := new.closed_reason;
      new := old;
      new.status := keep_status;
      if act <> 'accept' then
        new.closed_kind := keep_kind; new.closed_reason := keep_reason; new.closed_at := now();
      end if;
      new.updated_at := now();
      return new;
    end if;
    raise exception 'Only team members can update requests';
  end if;
  if r <> 'admin' and (new.client_id <> old.client_id or new.code <> old.code or new.created_at <> old.created_at) then
    raise exception 'Only an administrator can change the request owner or reference';
  end if;
  if new.assigned_to is distinct from old.assigned_to and r <> 'admin' then
    raise exception 'Only an administrator can assign requests';
  end if;
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to
     and not exists (select 1 from public.staff where user_id = new.assigned_to and active) then
    raise exception 'Requests can only be assigned to an active team member';
  end if;
  if r = 'ops_finance' and (
       new.product_name is distinct from old.product_name or new.category is distinct from old.category or
       new.product_link is distinct from old.product_link or new.quantity is distinct from old.quantity or
       new.estimated_value_mad is distinct from old.estimated_value_mad or
       new.specifications is distinct from old.specifications) then
    raise exception 'Operations & Finance cannot edit product details';
  end if;

  select * into pay from public.payments where request_id = old.id;

  if new.quote_amount_mad is distinct from old.quote_amount_mad
     or new.quote_sent_at is distinct from old.quote_sent_at then
    if r = 'ops_finance' then
      raise exception 'Operations & Finance cannot change or resend the quotation';
    end if;
    if found and pay.deposit_status = 'verified' and r <> 'admin' then
      raise exception 'The quotation is locked after the deposit is verified';
    end if;
  end if;

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

  -- Reopening a request the client closed clears the closing reason.
  if old.status = 'not_qualified' and new.status <> 'not_qualified' then
    new.closed_kind := null; new.closed_reason := null; new.closed_at := null;
  end if;

  -- Saving (or resending) a quotation sends it to the client with a validity period.
  new.quote_expires_at := old.quote_expires_at;
  if new.quote_amount_mad is distinct from old.quote_amount_mad
     or new.quote_sent_at is distinct from old.quote_sent_at then
    if new.quote_amount_mad is null then
      new.quote_sent_at := null; new.quote_expires_at := null;
    else
      new.quote_sent_at := now();
      new.quote_expires_at := now() + make_interval(days =>
        coalesce((select quote_validity_days from public.business_settings where id), 7));
      if new.status <> 'not_qualified' and (
           public.status_rank(new.status) < 7
           -- the price changed after the client accepted: the client accepts the new price
           or (new.status = old.status and new.status = 'awaiting_deposit'
               and new.quote_amount_mad is distinct from old.quote_amount_mad)) then
        new.status := 'awaiting_confirmation';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- 3. Quote acceptances (immutable) ------------------------------------
create table public.quote_acceptances (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.requests(id) on delete restrict,
  user_id       uuid not null references auth.users(id) on delete restrict,
  amount_mad    numeric not null check (amount_mad > 0),
  quantity      integer not null,
  quote_sent_at timestamptz not null,
  terms_version text not null,
  accepted_at   timestamptz not null default now()
);
create index quote_acceptances_request_idx on public.quote_acceptances (request_id);
alter table public.quote_acceptances enable row level security;
revoke all on public.quote_acceptances from anon, authenticated;
grant select on public.quote_acceptances to authenticated;   -- inserted only by accept_quote()
create policy acceptances_read on public.quote_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or public.staff_can_see_request(request_id));

create or replace function public.quote_acceptances_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'A quote acceptance is a permanent record: it cannot be changed or deleted';
end $$;
revoke execute on function public.quote_acceptances_immutable() from anon, authenticated, public;
create trigger quote_acceptances_immutable before update or delete on public.quote_acceptances
  for each row execute function public.quote_acceptances_immutable();

-- Clients can see the payment proofs they sent.
alter policy files_read on public.request_files using (
  ((kind in ('product_image', 'payment_proof')) and exists (
     select 1 from public.requests r where r.id = request_files.request_id and r.client_id = (select auth.uid())))
  or public.staff_can_see_request(request_id));

-- 4. Team notifications -----------------------------------------------
create table public.team_notifications (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  kind       text not null check (kind in ('quote_accepted', 'quote_declined', 'request_cancelled', 'deposit_proof', 'final_proof')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index team_notifications_request_idx on public.team_notifications (request_id);
alter table public.team_notifications enable row level security;  -- no policy: only notify-team (service role) reads it
revoke all on public.team_notifications from anon, authenticated;
grant select, update on public.team_notifications to service_role;

create or replace function public.team_notifications_send()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url     := 'https://sdspalqmmbvyucfwgezx.supabase.co/functions/v1/notify-team',
      body    := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    null;  -- an email problem must never block the client's action
  end;
  return new;
end $$;
revoke execute on function public.team_notifications_send() from anon, authenticated, public;
create trigger team_notifications_send after insert on public.team_notifications
  for each row execute function public.team_notifications_send();

-- Payments: client proof upload (submit_payment_proof) ------------------
create or replace function public.payments_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role();
        act text := coalesce(current_setting('ddp.client_action', true), '');
        nd text; np text; nr text; ndt date; fs text; fp text; fr text; fdt date;
begin
  if pg_trigger_depth() > 1 then
    new.updated_at := now();
    return new;
  end if;
  if r is null and act = 'proof' then
    -- Only the "received" status, proof, reference and date of an unverified part change.
    nd := new.deposit_status; np := new.deposit_proof_path; nr := new.deposit_reference; ndt := new.deposit_date;
    fs := new.final_status;   fp := new.final_proof_path;   fr := new.final_reference;   fdt := new.final_date;
    new := old;
    if old.deposit_status <> 'verified' and nd = 'received' then
      new.deposit_status := nd; new.deposit_proof_path := np; new.deposit_reference := nr; new.deposit_date := ndt;
    end if;
    if old.final_status in ('pending', 'received') and fs = 'received' then
      new.final_status := fs; new.final_proof_path := fp; new.final_reference := fr; new.final_date := fdt;
    end if;
    new.updated_at := now();
    return new;
  end if;
  if r is null or r not in ('admin','ops_finance') then
    raise exception 'Only Operations & Finance or an administrator can record payments';
  end if;
  if new.final_price_mad is distinct from old.final_price_mad and old.deposit_status = 'verified' and r <> 'admin' then
    raise exception 'The final price is locked after the deposit is verified';
  end if;
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

-- 5. Client RPCs --------------------------------------------------------
create or replace function public.accept_quote(p_request uuid, p_terms_version text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; v text;
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid() for update;
  if not found then raise exception 'Request not found'; end if;
  if q.status <> 'awaiting_confirmation' or q.quote_amount_mad is null or q.quote_sent_at is null then
    raise exception 'There is no quote waiting for your answer on this request';
  end if;
  if coalesce(q.quote_expires_at, '-infinity') <= now() then
    raise exception 'This quote has expired. Ask our team to send it again.';
  end if;
  select terms_version into v from public.business_settings where id;
  if p_terms_version is distinct from v then
    raise exception 'Our Terms have changed (version %). Reload the page and read them again.', v;
  end if;
  insert into public.quote_acceptances (request_id, user_id, amount_mad, quantity, quote_sent_at, terms_version)
  values (q.id, auth.uid(), q.quote_amount_mad, q.quantity, q.quote_sent_at, v);
  perform set_config('ddp.client_action', 'accept', true);
  update public.requests set status = 'awaiting_deposit' where id = q.id;
  perform set_config('ddp.client_action', '', true);
  perform public.log_event(q.id, 'quote_accepted', jsonb_build_object('amount', q.quote_amount_mad, 'terms_version', v));
  insert into public.team_notifications (request_id, kind) values (q.id, 'quote_accepted');
end $$;

create or replace function public.decline_quote(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; why text := btrim(coalesce(p_reason, ''));
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid() for update;
  if not found then raise exception 'Request not found'; end if;
  if q.status <> 'awaiting_confirmation' then
    raise exception 'There is no quote waiting for your answer on this request';
  end if;
  if length(why) < 3 or length(why) > 1000 then raise exception 'Tell us in a few words why you decline'; end if;
  perform set_config('ddp.client_action', 'decline', true);
  update public.requests set status = 'not_qualified', closed_kind = 'declined', closed_reason = why where id = q.id;
  perform set_config('ddp.client_action', '', true);
  perform public.log_event(q.id, 'quote_declined', jsonb_build_object('reason', why));
  insert into public.team_notifications (request_id, kind) values (q.id, 'quote_declined');
end $$;

-- D9/D10: the client can cancel until the 40% deposit is verified (the order then exists, D23).
create or replace function public.cancel_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; why text := btrim(coalesce(p_reason, ''));
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid() for update;
  if not found then raise exception 'Request not found'; end if;
  if q.status = 'not_qualified' or public.status_rank(q.status) > 8
     or exists (select 1 from public.payments p where p.request_id = q.id and p.deposit_status = 'verified') then
    raise exception 'This order can no longer be cancelled online. Write to our team in the conversation.';
  end if;
  if length(why) < 3 or length(why) > 1000 then raise exception 'Tell us in a few words why you cancel'; end if;
  perform set_config('ddp.client_action', 'cancel', true);
  update public.requests set status = 'not_qualified', closed_kind = 'cancelled', closed_reason = why where id = q.id;
  perform set_config('ddp.client_action', '', true);
  perform public.log_event(q.id, 'client_cancelled', jsonb_build_object('reason', why));
  insert into public.team_notifications (request_id, kind) values (q.id, 'request_cancelled');
end $$;

create or replace function public.submit_payment_proof(p_request uuid, p_part text, p_path text, p_file_name text, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; pay public.payments%rowtype;
        ref text := nullif(left(btrim(coalesce(p_reference, '')), 100), '');
        fname text := left(coalesce(nullif(btrim(p_file_name), ''), 'transfer-proof'), 200);
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid();
  if not found then raise exception 'Request not found'; end if;
  select * into pay from public.payments where request_id = q.id for update;
  if split_part(coalesce(p_path, ''), '/', 1) <> auth.uid()::text or split_part(p_path, '/', 2) <> q.id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'request-files' and o.name = p_path) then
    raise exception 'Upload the transfer proof for this request first';
  end if;
  if p_part = 'deposit' then
    if q.status <> 'awaiting_deposit' or pay.request_id is null or pay.deposit_status = 'verified' then
      raise exception 'No 40%% deposit is waiting on this request';
    end if;
  elsif p_part = 'final' then
    if pay.request_id is null or pay.final_status not in ('pending', 'received') then
      raise exception 'No 60%% payment is waiting on this request';
    end if;
  else
    raise exception 'Unknown payment';
  end if;
  insert into public.request_files (request_id, path, file_name, kind) values (q.id, p_path, fname, 'payment_proof');
  perform set_config('ddp.client_action', 'proof', true);
  if p_part = 'deposit' then
    update public.payments set deposit_status = 'received', deposit_proof_path = p_path,
           deposit_reference = coalesce(ref, deposit_reference), deposit_date = current_date
     where request_id = q.id;
  else
    update public.payments set final_status = 'received', final_proof_path = p_path,
           final_reference = coalesce(ref, final_reference), final_date = current_date
     where request_id = q.id;
  end if;
  perform set_config('ddp.client_action', '', true);
  insert into public.team_notifications (request_id, kind)
  values (q.id, case p_part when 'deposit' then 'deposit_proof' else 'final_proof' end);
end $$;

-- Amounts and payment state of the caller's request; bank details only while a payment is awaited.
create or replace function public.my_payment_info(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q public.requests%rowtype; pay public.payments%rowtype; s public.business_settings%rowtype;
        res jsonb; awaiting boolean;
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid();
  if not found then raise exception 'Request not found'; end if;
  select * into pay from public.payments where request_id = q.id;
  if not found then return null; end if;
  awaiting := q.status <> 'not_qualified' and (
       (q.status = 'awaiting_deposit' and pay.deposit_status <> 'verified')
    or pay.final_status in ('pending', 'received'));
  res := jsonb_build_object(
    'final_price_mad', pay.final_price_mad, 'deposit_amount_mad', pay.deposit_amount_mad,
    'balance_amount_mad', pay.balance_amount_mad,
    'deposit_status', pay.deposit_status, 'final_status', pay.final_status,
    'deposit_date', pay.deposit_date, 'final_date', pay.final_date,
    'awaiting_payment', awaiting);
  if awaiting then
    select * into s from public.business_settings where id;
    res := res || jsonb_build_object('bank', jsonb_build_object(
      'bank_name', s.bank_name, 'account_holder', s.account_holder, 'rib', s.rib, 'iban', s.iban,
      'swift', s.swift, 'reference', q.code, 'reference_note', s.payment_reference_note));
  end if;
  return res;
end $$;

revoke execute on function public.accept_quote(uuid, text), public.decline_quote(uuid, text),
  public.cancel_request(uuid, text), public.submit_payment_proof(uuid, text, text, text, text),
  public.my_payment_info(uuid) from public, anon;
grant execute on function public.accept_quote(uuid, text), public.decline_quote(uuid, text),
  public.cancel_request(uuid, text), public.submit_payment_proof(uuid, text, text, text, text),
  public.my_payment_info(uuid) to authenticated;
