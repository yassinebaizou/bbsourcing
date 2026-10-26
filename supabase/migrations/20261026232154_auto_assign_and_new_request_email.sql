-- =====================================================================
-- Owner's request: every new request is assigned to the administrator automatically,
-- and the administrator receives an email for it.
-- =====================================================================

-- 1. Auto-assignment: new requests go to the first active administrator (Yassine today).
--    Clients still cannot choose the assignee, status or quotation.
create or replace function public.requests_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare default_owner uuid := (
  select s.user_id from public.staff s where s.role = 'admin' and s.active order by s.created_at limit 1);
begin
  if pg_trigger_depth() > 1 then
    new.status           := 'new_application';
    new.assigned_to      := default_owner;
    new.quote_amount_mad := null;
  elsif public.staff_role() is distinct from 'admin' then
    new.client_id        := auth.uid();
    new.status           := 'new_application';
    new.assigned_to      := default_owner;
    new.quote_amount_mad := null;
  else
    new.assigned_to      := coalesce(new.assigned_to, default_owner);
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- 2. Email: after a request is saved, the database calls the "notify-new-request" Edge Function
--    (asynchronous: it never slows down or blocks the request). The function sends each email once.
create extension if not exists pg_net with schema extensions;

-- One row per request already emailed, so a request is never announced twice.
create table public.request_notifications (
  request_id uuid primary key references public.requests(id) on delete cascade,
  sent_at    timestamptz not null default now()
);
alter table public.request_notifications enable row level security;
revoke all on public.request_notifications from anon, authenticated;
grant select, insert, delete on public.request_notifications to service_role;

create or replace function public.requests_notify_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url     := 'https://sdspalqmmbvyucfwgezx.supabase.co/functions/v1/notify-new-request',
      body    := jsonb_build_object('request_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then
    null;  -- an email problem must never block a client's request
  end;
  return new;
end $$;
revoke execute on function public.requests_notify_team() from anon, authenticated, public;

create trigger requests_notify_team after insert on public.requests
  for each row execute function public.requests_notify_team();
