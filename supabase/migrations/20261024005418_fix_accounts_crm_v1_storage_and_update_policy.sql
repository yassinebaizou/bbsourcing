-- Fixes three issues found in review of ddp_accounts_crm_v1:
--
-- 1. (Security) The "request-files" storage bucket's staff policies only
--    checked "is this person staff?", not "is this one of the requests they
--    are allowed to see?" -- unlike every other table in this schema. Any
--    staff account could read or write any request's files (including
--    payment proofs) via the Storage API directly, regardless of role or
--    assignment. Fixed by scoping both policies through
--    staff_can_see_request(), using the request id already encoded as the
--    second path segment (staff/<request_id>/...).
--
-- 2. (Bug) requests_staff_update had no explicit WITH CHECK, so Postgres
--    reused the USING clause (staff_can_see(assigned_to, status)) against
--    the NEW row. That silently blocked the one case the business trigger
--    (requests_before_update) explicitly allows: Operations & Finance
--    cancelling a confirmed order by setting status = 'not_qualified',
--    since status_rank('not_qualified') = 99 falls outside their normal
--    8-17 range. Fixed by adding an explicit WITH CHECK that carries the
--    same exception.
--
-- 3. (Latent bug) status_rank() hard-coded a second copy of the
--    code -> rank mapping already defined on request_statuses.rank.
--    Adding a new status later without updating this function too would
--    make it return NULL for that code, silently breaking every RLS check
--    built on top of it. Fixed by reading the rank from the table instead.

alter policy "team read files" on storage.objects
  using (
    bucket_id = 'request-files'
    and staff_role() is not null
    and staff_can_see_request(((storage.foldername(name))[2])::uuid)
  );

alter policy "team upload files" on storage.objects
  with check (
    bucket_id = 'request-files'
    and (storage.foldername(name))[1] = 'staff'
    and staff_can_see_request(((storage.foldername(name))[2])::uuid)
  );

alter policy "requests_staff_update" on public.requests
  with check (
    staff_can_see(assigned_to, status)
    or (staff_role() = 'ops_finance' and status = 'not_qualified')
  );

create or replace function public.status_rank(s text)
 returns integer
 language sql
 stable
 set search_path to 'public'
as $function$
  select rank from public.request_statuses where code = s
$function$;
