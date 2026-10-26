-- 1. Request codes use the DDPSourcing prefix (was "BS-" from the old BeastSourcing name).
alter table public.requests alter column code set default ('DDP-' || nextval('public.request_code_seq'));
-- Existing codes: the update guard trigger only accepts team members, so pause it for this rename only.
alter table public.requests disable trigger requests_before_update;
update public.requests set code = 'DDP-' || substr(code, 4) where code like 'BS-%';
alter table public.requests enable trigger requests_before_update;

-- 2. Row-level security: evaluate auth.uid() once per query instead of once per row
--    (Supabase performance advisor "auth_rls_initplan"). Same rules, faster.
alter policy reads_insert on public.message_reads
  with check (user_id = (select auth.uid()) and public.can_see_request(request_id));
alter policy reads_select on public.message_reads
  using (user_id = (select auth.uid()));
alter policy reads_update on public.message_reads
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy profiles_read on public.profiles
  using (id = (select auth.uid()) or public.staff_role() is not null);
alter policy profiles_update_self on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy files_client_insert on public.request_files
  with check (
    kind = 'product_image'
    and exists (select 1 from public.requests r where r.id = request_files.request_id and r.client_id = (select auth.uid()))
    and split_part(path, '/', 1) = (select auth.uid())::text);
alter policy files_read on public.request_files
  using (
    (kind = 'product_image'
     and exists (select 1 from public.requests r where r.id = request_files.request_id and r.client_id = (select auth.uid())))
    or public.staff_can_see_request(request_id));
alter policy requests_client_insert on public.requests
  with check (client_id = (select auth.uid()));
alter policy requests_read on public.requests
  using (client_id = (select auth.uid()) or public.staff_can_see(assigned_to, status));
alter policy staff_read on public.staff
  using (public.staff_role() is not null or user_id = (select auth.uid()));

-- 3. Indexes on foreign keys (Supabase performance advisor "unindexed_foreign_keys").
create index if not exists message_reads_user_idx        on public.message_reads(user_id);
create index if not exists order_costs_updated_by_idx    on public.order_costs(updated_by);
create index if not exists payments_dep_verified_by_idx  on public.payments(deposit_verified_by);
create index if not exists payments_fin_verified_by_idx  on public.payments(final_verified_by);
create index if not exists request_events_actor_idx      on public.request_events(actor_id);
create index if not exists request_files_uploaded_by_idx on public.request_files(uploaded_by);
create index if not exists request_internal_upd_by_idx   on public.request_internal(updated_by);
create index if not exists request_messages_author_idx   on public.request_messages(author_id);
create index if not exists request_notes_author_idx      on public.request_notes(author_id);
create index if not exists staff_created_by_idx          on public.staff(created_by);
