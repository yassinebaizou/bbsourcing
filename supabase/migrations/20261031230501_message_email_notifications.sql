-- =====================================================================
-- Owner's request: email notifications for the conversation, in both directions.
--   - client writes a message        -> email to the assigned team member (admins if unassigned)
--   - team writes a message          -> email to the client
--   - the client stage changes        -> email to the client ("Status update: …" rows)
-- Client actions (accept, decline, cancel, transfer proof) already email the team (team_notifications).
-- Messages are grouped: at most one email per request and direction every 10 minutes, so a burst
-- of short messages sends one email. Status updates are never grouped.
-- The Edge Function notify-message sends the email (same pattern as notify-team).
-- =====================================================================
create table public.message_notifications (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  message_id uuid not null references public.request_messages(id) on delete cascade,
  kind       text not null check (kind in ('client_message', 'team_message', 'status_update')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index message_notifications_request_idx on public.message_notifications (request_id, kind, created_at);
create index message_notifications_message_idx on public.message_notifications (message_id);
alter table public.message_notifications enable row level security;  -- no policy: only notify-message (service role) reads it
revoke all on public.message_notifications from anon, authenticated;
grant select, update on public.message_notifications to service_role;

create or replace function public.request_messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if new.kind = 'message' then
    perform public.log_event(new.request_id,
      case when new.from_team then 'message_to_client' else 'message_from_client' end, '{}'::jsonb);
  end if;
  k := case when new.kind = 'update' then 'status_update' when new.from_team then 'team_message' else 'client_message' end;
  if k = 'status_update' or not exists (
       select 1 from public.message_notifications n
        where n.request_id = new.request_id and n.kind = k and n.created_at > now() - interval '10 minutes') then
    insert into public.message_notifications (request_id, message_id, kind) values (new.request_id, new.id, k);
  end if;
  return new;
end $$;

create or replace function public.message_notifications_send()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url     := 'https://sdspalqmmbvyucfwgezx.supabase.co/functions/v1/notify-message',
      body    := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    null;  -- an email problem must never block a message
  end;
  return new;
end $$;
revoke execute on function public.message_notifications_send() from anon, authenticated, public;
create trigger message_notifications_send after insert on public.message_notifications
  for each row execute function public.message_notifications_send();
