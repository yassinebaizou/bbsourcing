-- =====================================================================
-- Client reviews (owner's request): a client writes a review in their account
-- (headline + text + one photo or video). The team approves it in the CRM;
-- approved reviews appear in the homepage "Reviews" section.
-- =====================================================================

create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  headline         text not null check (length(btrim(headline)) between 3 and 120),
  body             text not null check (length(btrim(body)) between 10 and 2000),
  media_path       text,
  media_type       text check (media_type in ('image','video')),
  display_name     text not null check (length(btrim(display_name)) between 2 and 80),
  store_name       text check (length(store_name) <= 120),
  city             text check (length(city) <= 80),
  publish_consent  boolean not null check (publish_consent),
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by      uuid references public.profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  check ((media_path is null) = (media_type is null))
);
create index reviews_client_idx      on public.reviews(client_id);
create index reviews_status_idx      on public.reviews(status, reviewed_at desc);
create index reviews_reviewed_by_idx on public.reviews(reviewed_by);

-- New review: always pending, always the logged-in client, media only from their own folder,
-- at most 3 reviews waiting for approval per client.
create or replace function public.reviews_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.client_id   := auth.uid();
  new.status      := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.created_at  := now();
  if new.media_path is not null and split_part(new.media_path, '/', 1) <> auth.uid()::text then
    raise exception 'The photo or video must be uploaded from your account';
  end if;
  if (select count(*) from public.reviews r where r.client_id = auth.uid() and r.status = 'pending') >= 3 then
    raise exception 'You already have 3 reviews waiting for approval';
  end if;
  return new;
end $$;
create trigger reviews_before_insert before insert on public.reviews
  for each row execute function public.reviews_before_insert();

-- Only the team changes a review, and only its status. The client's words and media stay as sent.
create or replace function public.reviews_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() is null then
    raise exception 'Only the team can approve reviews';
  end if;
  new.client_id := old.client_id;  new.headline := old.headline;     new.body := old.body;
  new.media_path := old.media_path; new.media_type := old.media_type; new.display_name := old.display_name;
  new.store_name := old.store_name; new.city := old.city;             new.publish_consent := old.publish_consent;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;
create trigger reviews_before_update before update on public.reviews
  for each row execute function public.reviews_before_update();

alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
revoke execute on function public.reviews_before_insert(), public.reviews_before_update() from anon, authenticated, public;
grant select, insert, delete on public.reviews to authenticated;
grant update (status) on public.reviews to authenticated;

create policy reviews_read on public.reviews for select to authenticated
  using (client_id = (select auth.uid()) or public.staff_role() is not null);
create policy reviews_insert on public.reviews for insert to authenticated
  with check (client_id = (select auth.uid()));
create policy reviews_update on public.reviews for update to authenticated
  using (public.staff_role() is not null) with check (public.staff_role() is not null);
create policy reviews_delete on public.reviews for delete to authenticated
  using ((client_id = (select auth.uid()) and status = 'pending') or public.staff_role() = 'admin');

-- What the homepage shows: approved reviews only, without any account information.
create or replace function public.published_reviews()
returns table (id uuid, headline text, body text, media_path text, media_type text,
               display_name text, store_name text, city text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.headline, r.body, r.media_path, r.media_type, r.display_name, r.store_name, r.city, r.reviewed_at
  from public.reviews r where r.status = 'approved'
  order by r.reviewed_at desc limit 24;
$$;
revoke execute on function public.published_reviews() from public;
grant execute on function public.published_reviews() to anon, authenticated;

-- Used by the storage policy below: is this file the media of an approved review?
create or replace function public.review_media_published(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reviews r where r.media_path = p_name and r.status = 'approved');
$$;
revoke execute on function public.review_media_published(text) from public;
grant execute on function public.review_media_published(text) to anon, authenticated;

-- Private bucket for review photos and videos (50 MB max, images and common video formats).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-media', 'review-media', false, 52428800,
        array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

create policy "clients upload review media" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "clients read own review media" on storage.objects for select to authenticated
  using (bucket_id = 'review-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "team read review media" on storage.objects for select to authenticated
  using (bucket_id = 'review-media' and public.staff_role() is not null);
create policy "everyone reads published review media" on storage.objects for select to anon, authenticated
  using (bucket_id = 'review-media' and public.review_media_published(name));
