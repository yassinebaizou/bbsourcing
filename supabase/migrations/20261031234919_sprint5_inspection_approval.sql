-- =====================================================================
-- Sprint 5 (docs/WORK_PLAN.md), item 6 — D13 inspection before shipping.
--   The team uploads inspection photos/videos (inspection_media) and asks the client to approve
--   (request_inspection_approval). The client sees them in the account and clicks "Approve shipping"
--   (approve_inspection) or asks a question in the conversation. The request cannot move to
--   air_shipping (rank 11) or later without the approval, except an administrator override with a note.
-- =====================================================================
alter table public.requests
  add column inspection_requested_at  timestamptz,
  add column inspection_approved_at   timestamptz,
  add column inspection_override_note text check (inspection_override_note is null or length(inspection_override_note) between 3 and 1000),
  add column inspection_override_by   uuid references public.profiles(id) on delete set null,
  add column inspection_override_at   timestamptz;
grant select (inspection_requested_at, inspection_approved_at, inspection_override_note, inspection_override_by, inspection_override_at)
  on public.requests to authenticated;
grant update (inspection_override_note) on public.requests to authenticated;

create table public.inspection_media (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  path        text not null unique,
  file_name   text not null check (length(file_name) between 1 and 200),
  media_type  text not null check (media_type in ('image', 'video')),
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index inspection_media_request_idx on public.inspection_media (request_id);
alter table public.inspection_media enable row level security;
revoke all on public.inspection_media from anon, authenticated;
grant select on public.inspection_media to authenticated;
grant insert (request_id, path, file_name, media_type) on public.inspection_media to authenticated;
create policy inspection_media_read on public.inspection_media for select to authenticated
  using (public.can_see_request(request_id));
create policy inspection_media_insert on public.inspection_media for insert to authenticated
  with check ((select public.staff_role()) is not null and public.staff_can_see_request(request_id)
              and split_part(path, '/', 1) = 'staff' and split_part(path, '/', 2) = request_id::text);

create or replace function public.inspection_media_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := auth.uid(); new.created_at := now();
  return new;
end $$;
revoke execute on function public.inspection_media_stamp() from anon, authenticated, public;
create trigger inspection_media_stamp before insert on public.inspection_media
  for each row execute function public.inspection_media_stamp();

-- Clients see the inspection photos and videos of their own requests.
create policy "clients read their inspection media" on storage.objects for select to authenticated
  using (bucket_id = 'request-files' and (storage.foldername(name))[1] = 'staff' and exists (
    select 1 from public.inspection_media m join public.requests r on r.id = m.request_id
     where m.path = objects.name and r.client_id = (select auth.uid())));

create or replace function public.requests_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r        text := public.staff_role();
  act      text := coalesce(current_setting('ddp.client_action', true), '');
  old_rank int  := public.status_rank(old.status);
  new_rank int  := public.status_rank(new.status);
  pay      public.payments%rowtype;
  keep_status text; keep_kind text; keep_reason text; keep_by text; keep_ireq timestamptz; keep_iapp timestamptz;
begin
  -- Inspection approval steps (request_inspection_approval, approve_inspection): only those two dates change.
  if act = 'inspection' then
    keep_ireq := new.inspection_requested_at; keep_iapp := new.inspection_approved_at;
    new := old;
    new.inspection_requested_at := keep_ireq; new.inspection_approved_at := keep_iapp;
    new.updated_at := now();
    return new;
  end if;
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

  -- The inspection dates are set only by the approval functions; the override note only by an administrator.
  new.inspection_requested_at := old.inspection_requested_at; new.inspection_approved_at := old.inspection_approved_at;
  if new.inspection_override_note is distinct from old.inspection_override_note then
    if r <> 'admin' then raise exception 'Only an administrator can ship without the client''s approval'; end if;
    new.inspection_override_note := nullif(btrim(new.inspection_override_note), '');
    new.inspection_override_by := case when new.inspection_override_note is null then null else auth.uid() end;
    new.inspection_override_at := case when new.inspection_override_note is null then null else now() end;
  else
    new.inspection_override_by := old.inspection_override_by; new.inspection_override_at := old.inspection_override_at;
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
      -- D13: the goods fly only after the client approved the inspection photos (or an admin override with a note).
      if new_rank >= 11 and old_rank < 11 and new.inspection_approved_at is null and new.inspection_override_note is null then
        raise exception 'The client must approve the inspection photos before shipping. An administrator can ship anyway with a note.';
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

create or replace function public.request_inspection_approval(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; n int;
begin
  if public.staff_role() is null or not public.staff_can_see_request(p_request) then raise exception 'Request not found'; end if;
  select * into q from public.requests where id = p_request for update;
  if q.status not in ('order_processing', 'quality_inspection') then
    raise exception 'Ask for the approval during production or quality inspection';
  end if;
  select count(*) into n from public.inspection_media where request_id = q.id;
  if n = 0 then raise exception 'Upload the inspection photos or video first'; end if;
  perform set_config('ddp.client_action', 'inspection', true);
  update public.requests set inspection_requested_at = now(), inspection_approved_at = null where id = q.id;
  perform set_config('ddp.client_action', '', true);
  perform public.post_update(q.id, 'Inspection photos are ready (' || n || ' file' || case when n > 1 then 's' else '' end ||
    '). Please look at them in your account and approve shipping, or ask us a question.');
  perform public.log_event(q.id, 'inspection_sent', jsonb_build_object('files', n));
end $$;

create or replace function public.approve_inspection(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare q public.requests%rowtype; mid uuid;
begin
  select * into q from public.requests where id = p_request and client_id = auth.uid() for update;
  if not found then raise exception 'Request not found'; end if;
  if q.inspection_requested_at is null then raise exception 'There are no inspection photos to approve yet'; end if;
  if q.inspection_approved_at is not null then raise exception 'You already approved shipping'; end if;
  if public.status_rank(q.status) >= 11 then raise exception 'This order has already been shipped'; end if;
  perform set_config('ddp.client_action', 'inspection', true);
  update public.requests set inspection_approved_at = now() where id = q.id;
  perform set_config('ddp.client_action', '', true);
  perform public.log_event(q.id, 'inspection_approved', '{}'::jsonb);
  -- The approval appears in the conversation, and the team is always emailed about it.
  insert into public.request_messages (request_id, body)
  values (q.id, 'I approve the inspection photos: you can ship my order.') returning id into mid;
  insert into public.message_notifications (request_id, message_id, kind)
  select q.id, mid, 'client_message' where not exists (select 1 from public.message_notifications where message_id = mid);
end $$;

revoke execute on function public.request_inspection_approval(uuid), public.approve_inspection(uuid) from public, anon;
grant execute on function public.request_inspection_approval(uuid), public.approve_inspection(uuid) to authenticated;
