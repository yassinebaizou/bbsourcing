-- =====================================================================
-- Sprint 4 (docs/WORK_PLAN.md): cancellations, refunds and claims in the platform.
--   1. Statuses cancelled_by_client, cancelled_by_us, refund_pending, refunded (ranks 94–97; every rank
--      >= 90 is "closed"). Only the system sets them: client cancel_request, admin team_cancel_request,
--      and the refunds of the request.
--   2. refunds: requested (by the system, an admin or Ops) -> approved (admin only) -> paid (Ops or admin,
--      with the transfer reference) or cancelled (admin). Clients read them through my_refunds().
--   3. claims + claim_files: the client opens a claim on a delivered request within claim_hours (D16)
--      with photos or video; Ops/admin answer with an outcome (refund, credit, replacement, rejected).
--   4. D11: no client cancellation from order_processing on. D10: cancelling after the 40% creates the refund.
--   5. D15: payments.final_due_at, daily reminders (pg_cron) while the 60% is unpaid.
-- Every action writes request_events. Client-visible steps are posted as "update" messages (emailed).
-- =====================================================================

-- 1. Statuses ---------------------------------------------------------
insert into public.request_statuses (code, rank, label, client_stage) values
  ('refund_pending',      94, 'Refund pending',      'Refund in progress'),
  ('refunded',            95, 'Refunded',            'Refunded'),
  ('cancelled_by_client', 96, 'Cancelled by client', 'Cancelled'),
  ('cancelled_by_us',     97, 'Cancelled by us',     'Cancelled by DDPSourcing');

alter table public.requests add column cancelled_by text check (cancelled_by in ('client', 'team'));
grant select (cancelled_by) on public.requests to authenticated;

-- Operations & Finance also see closed orders that carry money (refunds to pay).
create or replace function public.staff_can_see(p_assigned uuid, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.staff_role()
    when 'admin'       then true
    when 'agent'       then p_assigned = auth.uid()
    when 'ops_finance' then public.status_rank(p_status) between 8 and 17
                         or p_status in ('refund_pending', 'refunded', 'cancelled_by_client', 'cancelled_by_us')
    else false
  end
$$;

-- System messages ("update" kind) may also be written by these functions and the daily reminder job.
create or replace function public.request_messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role();
begin
  new.created_at := now();
  if new.kind = 'update' and (pg_trigger_depth() > 1 or coalesce(current_setting('ddp.client_action', true), '') = 'system') then
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

create or replace function public.post_update(p_request uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('ddp.client_action', true), '');
begin
  perform set_config('ddp.client_action', 'system', true);
  insert into public.request_messages (request_id, kind, body) values (p_request, 'update', left(p_body, 5000));
  perform set_config('ddp.client_action', prev, true);
end $$;
revoke execute on function public.post_update(uuid, text) from anon, authenticated, public;

create or replace function public.requests_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r        text := public.staff_role();
  act      text := coalesce(current_setting('ddp.client_action', true), '');
  old_rank int  := public.status_rank(old.status);
  new_rank int  := public.status_rank(new.status);
  pay      public.payments%rowtype;
  keep_status text; keep_kind text; keep_reason text; keep_by text;
begin
  -- Actions run by the database functions (client accept/decline/cancel, team cancel, refunds):
  -- only the status and the closing fields change.
  if act in ('accept', 'decline', 'cancel', 'system') then
    keep_status := new.status; keep_kind := new.closed_kind; keep_reason := new.closed_reason; keep_by := new.cancelled_by;
    new := old;
    new.status := keep_status;
    if act in ('decline', 'cancel') or (act = 'system' and keep_kind is distinct from old.closed_kind) then
      new.closed_kind := keep_kind; new.closed_reason := keep_reason; new.cancelled_by := keep_by; new.closed_at := now();
    end if;
    new.updated_at := now();
    return new;
  end if;
  if r is null then
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
    if new.status in ('refund_pending', 'refunded', 'cancelled_by_client', 'cancelled_by_us') then
      raise exception 'This status is set automatically (client cancellation, "Cancel the order" or refunds)';
    end if;
    if old.status in ('refund_pending', 'refunded', 'cancelled_by_client', 'cancelled_by_us') and r <> 'admin' then
      raise exception 'Only an administrator can reopen a cancelled order';
    end if;
    if r = 'agent' and not (old_rank <= 8 and (new_rank <= 8 or new.status = 'not_qualified')) then
      raise exception 'Sourcing agents manage stages up to "Awaiting 40%% deposit"';
    end if;
    if r = 'ops_finance' and not (old_rank between 8 and 17 and (new_rank between 8 and 17 or new.status = 'not_qualified')) then
      raise exception 'Operations & Finance manage stages from "Awaiting 40%% deposit" onward';
    end if;
    if new_rank < 90 then
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

  -- Reopening a closed request clears the closing reason.
  if old_rank >= 90 and new_rank < 90 then
    new.closed_kind := null; new.closed_reason := null; new.closed_at := null; new.cancelled_by := null;
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
      if public.status_rank(new.status) < 90 and (
           public.status_rank(new.status) < 7
           or (new.status = old.status and new.status = 'awaiting_deposit'
               and new.quote_amount_mad is distinct from old.quote_amount_mad)) then
        new.status := 'awaiting_confirmation';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- 5 (D15). When the 60% becomes due.
alter table public.payments add column final_due_at timestamptz;
update public.payments set final_due_at = updated_at where final_status in ('pending', 'received') and final_due_at is null;

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
      update public.payments set final_status = 'pending', final_due_at = coalesce(final_due_at, now()), updated_at = now()
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

-- 2. Refunds ------------------------------------------------------------
create table public.refunds (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.requests(id) on delete cascade,
  claim_id     uuid,
  amount_mad   numeric not null check (amount_mad > 0),
  reason       text not null check (reason in ('client_cancelled_before_order', 'cannot_source', 'supplier_failed',
                 'inspection_failed', 'customs_problem', 'delivery_failed', 'late_delivery', 'claim', 'refused_product', 'other')),
  note         text check (note is null or length(note) <= 1000),
  method       text not null default 'bank_transfer' check (method = 'bank_transfer'),
  status       text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'cancelled')),
  reference    text check (reference is null or length(reference) <= 100),
  proof_path   text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_by  uuid references public.profiles(id) on delete set null,
  approved_at  timestamptz,
  paid_by      uuid references public.profiles(id) on delete set null,
  paid_at      timestamptz,
  cancelled_at timestamptz
);
create index refunds_request_idx on public.refunds (request_id);
alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;
grant insert (request_id, amount_mad, reason, note) on public.refunds to authenticated;
grant update (status, reference, proof_path, note) on public.refunds to authenticated;
create policy refunds_read on public.refunds for select to authenticated
  using ((select public.staff_role()) in ('admin', 'ops_finance') and public.staff_can_see_request(request_id));
create policy refunds_insert on public.refunds for insert to authenticated
  with check ((select public.staff_role()) in ('admin', 'ops_finance') and public.staff_can_see_request(request_id));
create policy refunds_update on public.refunds for update to authenticated
  using ((select public.staff_role()) in ('admin', 'ops_finance') and public.staff_can_see_request(request_id));

create or replace function public.refunds_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role(); sys boolean := coalesce(current_setting('ddp.client_action', true), '') = 'system';
        cap numeric; used numeric;
begin
  if tg_op = 'INSERT' then
    if not sys and (r is null or r not in ('admin', 'ops_finance')) then
      raise exception 'Only an administrator or Operations & Finance can record a refund';
    end if;
    select coalesce(final_price_mad, 0) into cap from public.payments where request_id = new.request_id;
    select coalesce(sum(amount_mad), 0) into used from public.refunds where request_id = new.request_id and status <> 'cancelled';
    if new.amount_mad + used > coalesce(cap, 0) then
      raise exception 'Refunds cannot exceed the order price (MAD %)', coalesce(cap, 0);
    end if;
    new.status := 'requested'; new.method := 'bank_transfer';
    new.requested_by := auth.uid(); new.requested_at := now();
    new.approved_by := null; new.approved_at := null; new.paid_by := null; new.paid_at := null; new.cancelled_at := null;
    new.reference := null; new.proof_path := null;
    if not sys then new.claim_id := null; end if;
    return new;
  end if;
  -- UPDATE
  if new.request_id <> old.request_id or new.amount_mad <> old.amount_mad or new.reason <> old.reason
     or new.claim_id is distinct from old.claim_id then
    raise exception 'The amount and reason of a refund cannot be changed: cancel it and record a new one';
  end if;
  if new.status <> old.status then
    if old.status in ('paid', 'cancelled') then
      raise exception 'This refund is already %', old.status;
    end if;
    if new.status = 'approved' then
      if old.status <> 'requested' or r is distinct from 'admin' then raise exception 'Only an administrator approves a refund'; end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    elsif new.status = 'paid' then
      if old.status <> 'approved' then raise exception 'An administrator must approve the refund before it is paid'; end if;
      if r is null or r not in ('admin', 'ops_finance') then raise exception 'Only Operations & Finance or an administrator records the transfer'; end if;
      if coalesce(btrim(new.reference), '') = '' then raise exception 'Enter the bank transfer reference'; end if;
      new.paid_by := auth.uid(); new.paid_at := now();
    elsif new.status = 'cancelled' then
      if r is distinct from 'admin' then raise exception 'Only an administrator cancels a refund'; end if;
      new.cancelled_at := now();
    else
      raise exception 'Invalid refund status';
    end if;
  end if;
  if new.proof_path is distinct from old.proof_path and new.proof_path is not null
     and (split_part(new.proof_path, '/', 1) <> 'staff' or split_part(new.proof_path, '/', 2) <> new.request_id::text) then
    raise exception 'Upload the transfer proof for this request';
  end if;
  new.requested_by := old.requested_by; new.requested_at := old.requested_at;
  if new.status = old.status then
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    new.paid_by := old.paid_by; new.paid_at := old.paid_at; new.cancelled_at := old.cancelled_at;
  end if;
  return new;
end $$;
revoke execute on function public.refunds_before() from anon, authenticated, public;
create trigger refunds_before before insert or update on public.refunds
  for each row execute function public.refunds_before();

-- Keeps the request status in line with its refunds (closed orders only) and logs every step.
create or replace function public.refunds_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; target text; prev text := coalesce(current_setting('ddp.client_action', true), '');
begin
  perform public.log_event(new.request_id,
    case when tg_op = 'INSERT' then 'refund_requested' when new.status <> old.status then 'refund_' || new.status else 'refund_updated' end,
    jsonb_build_object('amount', new.amount_mad, 'reason', new.reason, 'reference', new.reference));
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select * into q from public.requests where id = new.request_id;
  if q.status in ('refund_pending', 'refunded', 'cancelled_by_client', 'cancelled_by_us') then
    target := case
      when exists (select 1 from public.refunds where request_id = q.id and status in ('requested', 'approved')) then 'refund_pending'
      when exists (select 1 from public.refunds where request_id = q.id and status = 'paid') then 'refunded'
      when q.cancelled_by = 'team' then 'cancelled_by_us'
      else 'cancelled_by_client' end;
    if target <> q.status then
      perform set_config('ddp.client_action', 'system', true);
      update public.requests set status = target where id = q.id;
      perform set_config('ddp.client_action', prev, true);
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'paid' then
    perform public.post_update(new.request_id, 'Refund paid: MAD ' || to_char(new.amount_mad, 'FM999G999G990D00') ||
      ' by bank transfer (reference ' || new.reference || ').');
  end if;
  return new;
end $$;
revoke execute on function public.refunds_after() from anon, authenticated, public;
create trigger refunds_after after insert or update on public.refunds
  for each row execute function public.refunds_after();

-- Clients read the transfer proof of their refunds.
create policy "clients read their refund proofs" on storage.objects for select to authenticated
  using (bucket_id = 'request-files' and (storage.foldername(name))[1] = 'staff' and exists (
    select 1 from public.refunds f join public.requests r on r.id = f.request_id
     where f.proof_path = objects.name and r.client_id = (select auth.uid())));

create or replace function public.my_refunds(p_request uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'amount_mad', f.amount_mad, 'status', f.status, 'reason', f.reason, 'requested_at', f.requested_at,
           'approved_at', f.approved_at, 'paid_at', f.paid_at, 'reference', case when f.status = 'paid' then f.reference end,
           'proof_path', case when f.status = 'paid' then f.proof_path end) order by f.requested_at), '[]'::jsonb)
    from public.refunds f join public.requests r on r.id = f.request_id
   where f.request_id = p_request and r.client_id = auth.uid() and f.status <> 'cancelled'
$$;

-- 3. Claims -------------------------------------------------------------
create table public.claims (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.requests(id) on delete cascade,
  client_id         uuid not null references public.profiles(id) on delete cascade,
  units_affected    integer not null check (units_affected > 0),
  description       text not null check (length(description) between 10 and 3000),
  status            text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'rejected')),
  outcome           text check (outcome in ('refund', 'credit', 'replacement', 'rejected')),
  outcome_note      text check (outcome_note is null or length(outcome_note) <= 2000),
  refund_amount_mad numeric check (refund_amount_mad is null or refund_amount_mad > 0),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id) on delete set null
);
create index claims_request_idx on public.claims (request_id);
alter table public.refunds add constraint refunds_claim_fk foreign key (claim_id) references public.claims(id) on delete set null;

create table public.claim_files (
  id         uuid primary key default gen_random_uuid(),
  claim_id   uuid not null references public.claims(id) on delete cascade,
  path       text not null,
  file_name  text not null,
  media_type text not null,
  created_at timestamptz not null default now()
);
create index claim_files_claim_idx on public.claim_files (claim_id);

alter table public.claims enable row level security;
alter table public.claim_files enable row level security;
revoke all on public.claims, public.claim_files from anon, authenticated;
grant select on public.claims, public.claim_files to authenticated;
grant update (status, outcome, outcome_note, refund_amount_mad) on public.claims to authenticated;
create policy claims_read on public.claims for select to authenticated
  using (client_id = (select auth.uid()) or public.staff_can_see_request(request_id));
create policy claims_update on public.claims for update to authenticated
  using ((select public.staff_role()) in ('admin', 'ops_finance') and public.staff_can_see_request(request_id));
create policy claim_files_read on public.claim_files for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_files.claim_id
                  and (c.client_id = (select auth.uid()) or public.staff_can_see_request(c.request_id))));

-- Claims accept photos and videos (50 MB); the pages keep 10 MB for every other file.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'request-files';

create or replace function public.claims_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.staff_role();
begin
  if r is null or r not in ('admin', 'ops_finance') then
    raise exception 'Only Operations & Finance or an administrator answers a claim';
  end if;
  if old.status in ('resolved', 'rejected') then
    raise exception 'This claim is already answered';
  end if;
  if new.status in ('resolved', 'rejected') then
    if new.outcome is null then raise exception 'Choose the outcome of the claim'; end if;
    if new.status = 'rejected' or new.outcome = 'rejected' then
      new.status := 'rejected'; new.outcome := 'rejected';
      if coalesce(btrim(new.outcome_note), '') = '' then raise exception 'Explain to the client why the claim is rejected'; end if;
    end if;
    if new.outcome = 'refund' and new.refund_amount_mad is null then raise exception 'Enter the refund amount'; end if;
    if new.outcome <> 'refund' then new.refund_amount_mad := null; end if;
    new.resolved_at := now(); new.resolved_by := auth.uid();
  else
    new.outcome := null; new.refund_amount_mad := null;
  end if;
  return new;
end $$;
revoke execute on function public.claims_before_update() from anon, authenticated, public;
create trigger claims_before_update before update on public.claims
  for each row execute function public.claims_before_update();

create or replace function public.claims_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('ddp.client_action', true), ''); label text;
begin
  if new.status = old.status then return new; end if;
  perform public.log_event(new.request_id, 'claim_' || new.status,
    jsonb_build_object('outcome', new.outcome, 'amount', new.refund_amount_mad));
  if new.status in ('resolved', 'rejected') then
    if new.outcome = 'refund' then
      perform set_config('ddp.client_action', 'system', true);
      insert into public.refunds (request_id, claim_id, amount_mad, reason, note)
      values (new.request_id, new.id, new.refund_amount_mad, 'claim', left(new.outcome_note, 1000));
      perform set_config('ddp.client_action', prev, true);
    end if;
    label := case new.outcome when 'refund' then 'refund of MAD ' || to_char(new.refund_amount_mad, 'FM999G999G990D00')
      when 'credit' then 'credit on your next order' when 'replacement' then 'replacement of the affected units' else 'claim not accepted' end;
    perform public.post_update(new.request_id, 'Claim answered: ' || label || '.' ||
      case when coalesce(new.outcome_note, '') <> '' then ' ' || new.outcome_note else '' end);
  elsif new.status = 'in_review' then
    perform public.post_update(new.request_id, 'Claim update: our team is reviewing your claim.');
  end if;
  return new;
end $$;
revoke execute on function public.claims_after_update() from anon, authenticated, public;
create trigger claims_after_update after update on public.claims
  for each row execute function public.claims_after_update();

-- When the client received the goods (status set to completed).
create or replace function public.delivered_at(p_request uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(e.created_at) from public.request_events e
   where e.request_id = p_request and e.action = 'status_changed' and e.details->>'to' = 'completed'
     and exists (select 1 from public.requests r where r.id = p_request
                  and (r.client_id = auth.uid() or public.staff_can_see(r.assigned_to, r.status)))
$$;
revoke execute on function public.delivered_at(uuid) from anon, public;
grant execute on function public.delivered_at(uuid) to authenticated;

create or replace function public.open_claim(p_request uuid, p_units integer, p_description text, p_files jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; hrs int; d timestamptz; cid uuid; f jsonb; n int := 0;
        txt text := btrim(coalesce(p_description, '')); mid uuid;
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid();
  if not found then raise exception 'Request not found'; end if;
  if q.status <> 'completed' then raise exception 'You can report a problem once your order is delivered'; end if;
  select claim_hours into hrs from public.business_settings where id;
  d := coalesce(public.delivered_at(q.id), q.updated_at);
  if now() > d + make_interval(hours => coalesce(hrs, 72)) then
    raise exception 'The % hours to report a problem after delivery have passed. Write to our team in the conversation.', coalesce(hrs, 72);
  end if;
  if exists (select 1 from public.claims where request_id = q.id and status in ('open', 'in_review')) then
    raise exception 'A claim is already open on this order';
  end if;
  if p_units is null or p_units < 1 or p_units > q.quantity then raise exception 'Enter the number of units affected (1 to %)', q.quantity; end if;
  if length(txt) < 10 then raise exception 'Describe the problem in a few words'; end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'Add at least one photo or video of the problem';
  end if;
  if jsonb_array_length(p_files) > 10 then raise exception 'Add 10 files at most'; end if;
  insert into public.claims (request_id, client_id, units_affected, description)
  values (q.id, auth.uid(), p_units, left(txt, 3000)) returning id into cid;
  for f in select * from jsonb_array_elements(p_files) loop
    if split_part(coalesce(f->>'path', ''), '/', 1) <> auth.uid()::text or split_part(f->>'path', '/', 2) <> q.id::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'request-files' and o.name = f->>'path') then
      raise exception 'Upload the photos and videos for this order first';
    end if;
    insert into public.claim_files (claim_id, path, file_name, media_type)
    values (cid, f->>'path', left(coalesce(nullif(f->>'name', ''), 'file'), 200),
            case when f->>'type' like 'video/%' then 'video' else 'image' end);
    n := n + 1;
  end loop;
  perform public.log_event(q.id, 'claim_opened', jsonb_build_object('units', p_units, 'files', n));
  -- The client's own words go into the conversation, and the team is always emailed about it.
  insert into public.request_messages (request_id, body)
  values (q.id, 'Claim: ' || p_units || ' unit(s) affected. ' || left(txt, 3000)) returning id into mid;
  insert into public.message_notifications (request_id, message_id, kind)
  select q.id, mid, 'client_message' where not exists (select 1 from public.message_notifications where message_id = mid);
  return cid;
end $$;

-- 4. Cancellations ------------------------------------------------------
-- D9 free before the 40%; D10 after the 40% and before the supplier order: full refund; D11 refused after.
create or replace function public.cancel_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; pay public.payments%rowtype; why text := btrim(coalesce(p_reason, ''));
        paid boolean;
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid() for update;
  if not found then raise exception 'Request not found'; end if;
  if public.status_rank(q.status) > 8 then
    raise exception 'This order can no longer be cancelled: we already ordered your goods from the supplier. Write to our team in the conversation.';
  end if;
  if length(why) < 3 or length(why) > 1000 then raise exception 'Tell us in a few words why you cancel'; end if;
  select * into pay from public.payments where request_id = q.id;
  paid := found and pay.deposit_status in ('received', 'verified');
  perform set_config('ddp.client_action', 'cancel', true);
  update public.requests set status = case when paid then 'refund_pending' else 'cancelled_by_client' end,
         closed_kind = 'cancelled', closed_reason = why, cancelled_by = 'client' where id = q.id;
  perform set_config('ddp.client_action', 'system', true);
  if paid then
    insert into public.refunds (request_id, amount_mad, reason, note)
    values (q.id, pay.deposit_amount_mad, 'client_cancelled_before_order', 'Client cancelled before the supplier order: ' || left(why, 900));
  end if;
  perform set_config('ddp.client_action', '', true);
  perform public.log_event(q.id, 'client_cancelled', jsonb_build_object('reason', why, 'refund', case when paid then pay.deposit_amount_mad end));
  insert into public.team_notifications (request_id, kind) values (q.id, 'request_cancelled');
end $$;

-- D12 / D14: problem on our side. Administrator only; the money received is refunded in full (approval step kept).
create or replace function public.team_cancel_request(p_request uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; pay public.payments%rowtype; amount numeric := 0; note text := btrim(coalesce(p_note, ''));
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'Only an administrator can cancel an order'; end if;
  select * into q from public.requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if public.status_rank(q.status) >= 17 then
    raise exception 'This order is already delivered or closed. For a delivered order, use a claim.';
  end if;
  if p_reason not in ('cannot_source', 'supplier_failed', 'inspection_failed', 'customs_problem', 'delivery_failed',
                      'late_delivery', 'refused_product', 'other') then
    raise exception 'Choose the reason';
  end if;
  if length(note) < 3 then raise exception 'Write a short explanation for the client'; end if;
  select * into pay from public.payments where request_id = q.id;
  if found then
    amount := (case when pay.deposit_status in ('received', 'verified') then pay.deposit_amount_mad else 0 end)
            + (case when pay.final_status in ('received', 'verified') then pay.balance_amount_mad else 0 end);
  end if;
  perform set_config('ddp.client_action', 'system', true);
  update public.requests set status = case when amount > 0 then 'refund_pending' else 'cancelled_by_us' end,
         closed_kind = 'cancelled', closed_reason = left(note, 1000), cancelled_by = 'team' where id = q.id;
  if amount > 0 then
    insert into public.refunds (request_id, amount_mad, reason, note) values (q.id, amount, p_reason, left(note, 1000));
  end if;
  perform set_config('ddp.client_action', '', true);
  perform public.post_update(q.id, 'We cancelled this order: ' || note ||
    case when amount > 0 then ' You receive a full refund of MAD ' || to_char(amount, 'FM999G999G990D00') || ' by bank transfer.' else '' end);
  perform public.log_event(q.id, 'team_cancelled', jsonb_build_object('reason', p_reason, 'note', note, 'refund', amount));
end $$;

-- 5. D15 reminders: day 0 is the status message; then reminders on day 3, on the storage-fee day,
--    and 5 days before the cancellation date. Runs every day at 09:00 Morocco time (08:00 UTC).
create table public.balance_reminders (
  request_id uuid not null references public.requests(id) on delete cascade,
  day        integer not null,
  sent_at    timestamptz not null default now(),
  primary key (request_id, day)
);
alter table public.balance_reminders enable row level security;
revoke all on public.balance_reminders from anon, authenticated;
grant select on public.balance_reminders to authenticated;
create policy balance_reminders_read on public.balance_reminders for select to authenticated
  using ((select public.staff_role()) in ('admin', 'ops_finance'));

create or replace function public.send_balance_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare s public.business_settings%rowtype; p record; d int; step int; n int := 0; msg text;
begin
  select * into s from public.business_settings where id;
  for p in
    select pay.request_id, pay.balance_amount_mad, pay.final_due_at, r.code
      from public.payments pay join public.requests r on r.id = pay.request_id
     where pay.final_status = 'pending' and pay.final_due_at is not null and r.status = 'awaiting_final_payment'
  loop
    d := floor(extract(epoch from now() - p.final_due_at) / 86400);
    step := case
      when d >= greatest(s.unpaid_cancel_after_days - 5, 1) then greatest(s.unpaid_cancel_after_days - 5, 1)
      when d >= s.storage_fee_after_days then s.storage_fee_after_days
      when d >= 3 then 3 else null end;
    continue when step is null or exists (select 1 from public.balance_reminders where request_id = p.request_id and day = step);
    insert into public.balance_reminders (request_id, day) values (p.request_id, step);
    msg := 'Reminder: your 60% payment of MAD ' || to_char(p.balance_amount_mad, 'FM999G999G990D00') ||
      ' is due. Use the bank details in your account and write ' || p.code || ' as the reference.';
    if step >= s.storage_fee_after_days then
      msg := msg || ' A storage fee applies from ' || to_char(p.final_due_at + make_interval(days => s.storage_fee_after_days), 'DD Mon YYYY') || '.';
    end if;
    msg := msg || ' Without payment by ' || to_char(p.final_due_at + make_interval(days => s.unpaid_cancel_after_days), 'DD Mon YYYY') ||
      ', the order is cancelled and the deposit is kept (see our payment rules).';
    perform public.post_update(p.request_id, msg);
    perform public.log_event(p.request_id, 'balance_reminder', jsonb_build_object('day', step));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.send_balance_reminders() from anon, authenticated, public;

create extension if not exists pg_cron;
select cron.schedule('ddp-balance-reminders', '0 8 * * *', 'select public.send_balance_reminders()');

-- Payment info for the client: due date and D15 dates while the 60% is unpaid.
create or replace function public.my_payment_info(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q public.requests%rowtype; pay public.payments%rowtype; s public.business_settings%rowtype;
        res jsonb; awaiting boolean;
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid();
  if not found then raise exception 'Request not found'; end if;
  select * into pay from public.payments where request_id = q.id;
  if not found then return null; end if;
  select * into s from public.business_settings where id;
  awaiting := public.status_rank(q.status) < 90 and (
       (q.status = 'awaiting_deposit' and pay.deposit_status <> 'verified')
    or pay.final_status in ('pending', 'received'));
  res := jsonb_build_object(
    'final_price_mad', pay.final_price_mad, 'deposit_amount_mad', pay.deposit_amount_mad,
    'balance_amount_mad', pay.balance_amount_mad,
    'deposit_status', pay.deposit_status, 'final_status', pay.final_status,
    'deposit_date', pay.deposit_date, 'final_date', pay.final_date,
    'awaiting_payment', awaiting, 'final_due_at', pay.final_due_at,
    'storage_fee_from', case when pay.final_status = 'pending' and pay.final_due_at is not null
                             then pay.final_due_at + make_interval(days => s.storage_fee_after_days) end,
    'cancel_after', case when pay.final_status = 'pending' and pay.final_due_at is not null
                         then pay.final_due_at + make_interval(days => s.unpaid_cancel_after_days) end);
  if awaiting then
    res := res || jsonb_build_object('bank', jsonb_build_object(
      'bank_name', s.bank_name, 'account_holder', s.account_holder, 'rib', s.rib, 'iban', s.iban,
      'swift', s.swift, 'reference', q.code, 'reference_note', s.payment_reference_note));
  end if;
  return res;
end $$;

revoke execute on function public.my_refunds(uuid), public.open_claim(uuid, integer, text, jsonb),
  public.team_cancel_request(uuid, text, text) from public, anon;
grant execute on function public.my_refunds(uuid), public.open_claim(uuid, integer, text, jsonb),
  public.team_cancel_request(uuid, text, text) to authenticated;
