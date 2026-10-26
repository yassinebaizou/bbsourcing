-- Security audit:
-- 1. Links typed by clients are opened by the team in the CRM. Only http(s) links are accepted,
--    so a "javascript:" link can never run code in a team member's session.
alter table public.requests add constraint requests_product_link_http
  check (product_link is null or product_link ~* '^https?://[^[:space:]]+$');
alter table public.profiles add constraint profiles_store_link_http
  check (store_link is null or store_link ~* '^https?://[^[:space:]]+$');

-- 2. Request files (product pictures, chat attachments, payment proofs): pictures and PDF only, 10 MB max.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'request-files';
