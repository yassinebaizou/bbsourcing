-- =====================================================================
-- Sprint 6: client email notifications.
-- One branded email per key moment of the order, sent by the Edge Function notify-client:
--   request_received  request saved                          (optional)
--   quote_ready       quote sent or sent again               (always)
--   quote_expiring    quote expires within 2 days, daily job (always)
--   deposit_verified  40% verified                           (always)
--   inspection_ready  inspection photos ready to approve     (always)
--   shipped           status air_shipping                    (optional)
--   final_due         status awaiting_final_payment (customs cleared, 60% due)  (always)
--   delivered         status completed + leave a review      (always: the claim window starts)
--   refund_paid       refund paid                            (always)
-- Team messages are already emailed (grouped, max one per 10 minutes) by notify-message.
-- The generic "Status update" email is not sent when one of the emails above covers the same moment.
-- The client can turn off the optional emails (profiles.email_updates) in their profile.
-- profiles.language is stored now for the French and Arabic emails of Sprints 7 and 8.
-- =====================================================================

alter table public.profiles
  add column email_updates boolean not null default true,
  add column language text not null default 'en' check (language in ('en', 'fr', 'ar'));
grant select (email_updates, language), update (email_updates, language) on public.profiles to authenticated;

create table public.client_emails (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  kind       text not null check (kind in ('request_received', 'quote_ready', 'quote_expiring', 'deposit_verified',
               'inspection_ready', 'shipped', 'final_due', 'delivered', 'refund_paid')),
  ref        text not null default '',   -- makes each email unique (one per quote sent, per refund…)
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  skipped    text,                       -- why it was not sent (client turned off optional emails)
  unique (request_id, kind, ref)
);
alter table public.client_emails enable row level security;  -- no policy: only notify-client (service role) reads it
revoke all on public.client_emails from anon, authenticated;
grant select, update on public.client_emails to service_role;

-- Queues an email; never blocks the business action that called it.
create or replace function public.queue_client_email(p_request uuid, p_kind text, p_ref text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.client_emails (request_id, kind, ref) values (p_request, p_kind, coalesce(p_ref, ''))
  on conflict (request_id, kind, ref) do nothing;
exception when others then
  null;
end $$;
revoke execute on function public.queue_client_email(uuid, text, text) from public, anon, authenticated;

create or replace function public.client_emails_send()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url     := 'https://sdspalqmmbvyucfwgezx.supabase.co/functions/v1/notify-client',
      body    := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    null;  -- an email problem must never block the action
  end;
  return new;
end $$;
revoke execute on function public.client_emails_send() from public, anon, authenticated;
create trigger client_emails_send after insert on public.client_emails
  for each row execute function public.client_emails_send();

-- ---------- Moments on the request ----------
create or replace function public.requests_client_emails()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.queue_client_email(new.id, 'request_received');
    return new;
  end if;
  if new.quote_sent_at is not null and new.quote_sent_at is distinct from old.quote_sent_at
     and new.status = 'awaiting_confirmation' then
    perform public.queue_client_email(new.id, 'quote_ready', new.quote_sent_at::text);
  end if;
  if new.inspection_requested_at is not null and new.inspection_requested_at is distinct from old.inspection_requested_at then
    perform public.queue_client_email(new.id, 'inspection_ready', new.inspection_requested_at::text);
  end if;
  if new.status <> old.status then
    if new.status = 'air_shipping' then perform public.queue_client_email(new.id, 'shipped');
    elsif new.status = 'awaiting_final_payment' then perform public.queue_client_email(new.id, 'final_due');
    elsif new.status = 'completed' then perform public.queue_client_email(new.id, 'delivered');
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.requests_client_emails() from public, anon, authenticated;
create trigger requests_client_emails after insert or update on public.requests
  for each row execute function public.requests_client_emails();

create or replace function public.payments_client_emails()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deposit_status = 'verified' and old.deposit_status is distinct from 'verified' then
    perform public.queue_client_email(new.request_id, 'deposit_verified');
  end if;
  return new;
end $$;
revoke execute on function public.payments_client_emails() from public, anon, authenticated;
create trigger payments_client_emails after update on public.payments
  for each row execute function public.payments_client_emails();

create or replace function public.refunds_client_emails()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.queue_client_email(new.request_id, 'refund_paid', new.id::text);
  end if;
  return new;
end $$;
revoke execute on function public.refunds_client_emails() from public, anon, authenticated;
create trigger refunds_client_emails after update on public.refunds
  for each row execute function public.refunds_client_emails();

-- ---------- Quote expiring in 2 days (daily job) ----------
-- One reminder per quote sent, when it expires within 48 hours and was sent more than a day ago.
create or replace function public.send_quote_expiry_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare q record; n int := 0;
begin
  for q in
    select id, quote_sent_at from public.requests
     where status = 'awaiting_confirmation' and quote_expires_at > now() and quote_expires_at <= now() + interval '2 days'
       and quote_sent_at < now() - interval '1 day'
       and not exists (select 1 from public.client_emails e where e.request_id = requests.id
                        and e.kind = 'quote_expiring' and e.ref = requests.quote_sent_at::text)
  loop
    perform public.queue_client_email(q.id, 'quote_expiring', q.quote_sent_at::text);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.send_quote_expiry_reminders() from public, anon, authenticated;
select cron.schedule('ddp-quote-expiry-reminders', '5 8 * * *', 'select public.send_quote_expiry_reminders()');

-- ---------- No double email ----------
-- The generic "Status update" email is skipped when a dedicated email covers the same moment.
create or replace function public.request_messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; st text;
begin
  if new.kind = 'message' then
    perform public.log_event(new.request_id,
      case when new.from_team then 'message_to_client' else 'message_from_client' end, '{}'::jsonb);
  end if;
  if new.kind = 'update' then
    select status into st from public.requests where id = new.request_id;
    if (new.body like 'Status update:%' and st in ('awaiting_confirmation', 'air_shipping', 'awaiting_final_payment', 'completed'))
       or new.body like 'Inspection photos are ready%' or new.body like 'Refund paid:%' then
      return new;
    end if;
  end if;
  k := case when new.kind = 'update' then 'status_update' when new.from_team then 'team_message' else 'client_message' end;
  if k = 'status_update' or not exists (
       select 1 from public.message_notifications n
        where n.request_id = new.request_id and n.kind = k and n.created_at > now() - interval '10 minutes') then
    insert into public.message_notifications (request_id, message_id, kind) values (new.request_id, new.id, k);
  end if;
  return new;
end $$;
