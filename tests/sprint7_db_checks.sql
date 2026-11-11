-- Sprint 7 database checks: the language chosen on the website is saved at signup.
-- Run in the Supabase SQL editor or via execute_sql. Everything is rolled back (RAISE EXCEPTION carries the results).
-- Every line should start with "ok".
do $t$ declare L text[] := '{}'; v text; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s7-a@example.com', '{"full_name":"A","language":"fr"}'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s7-b@example.com', '{"full_name":"B"}'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s7-c@example.com', '{"full_name":"C","language":"de","pending_request":{"product_name":"Item Seven","product_link":"https://x.com/7","quantity":100,"order_type":"new","delivery_city":"Rabat","consent_whatsapp":true,"privacy_accepted":true}}');
  select string_agg(language, ',' order by email) into v from profiles where id in (a, b, c);
  L := array_append(L, case when v = 'fr,en,en' then 'ok' else 'FAIL' end || ' signup language fr / missing / unknown -> ' || v);
  select count(*)::text into v from requests where client_id = c;
  L := array_append(L, case when v = '1' then 'ok' else 'FAIL' end || ' request sent at signup still created (' || v || ')');
  raise exception 'RESULTS %', array_to_string(L, E'\n');
end $t$;
