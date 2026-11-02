-- Sprint 5 database checks: D13 inspection approval before shipping.
-- Run in the Supabase SQL editor or via execute_sql. Everything is rolled back: the block always ends
-- with RAISE EXCEPTION, which carries the results. Every line should start with "ok".
do $t$ declare L text[] := '{}'; n int; v text;
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); ops uuid := gen_random_uuid();
  admin_id uuid := (select user_id from public.staff where role = 'admin' and active order by created_at limit 1);
  r1 uuid; r2 uuid; tv text := (select terms_version from public.business_settings);
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (c1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s5-c1@example.com', '{"full_name":"Client Five"}'),
    (c2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s5-c2@example.com', '{"full_name":"Other"}'),
    (ops, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s5-ops@example.com', '{"full_name":"Ops"}');
  insert into public.staff (user_id, role) values (ops, 'ops_finance');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item One', 'https://x.com/1', 100, 'new', 'Rabat', true, true) returning id into r1;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item Two', 'https://x.com/2', 100, 'new', 'Rabat', true, true) returning id into r2;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_amount_mad = 24000 where id in (r1, r2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform accept_quote(r1, tv); perform accept_quote(r2, tv);
  execute 'reset role';
  insert into storage.objects (bucket_id, name, owner) values ('request-files', 'staff/' || r1 || '/inspection-1.jpg', ops);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update payments set deposit_status = 'verified' where request_id in (r1, r2);
  update requests set status = 'order_processing' where id in (r1, r2);
  update requests set status = 'quality_inspection' where id in (r1, r2);

  begin perform request_inspection_approval(r1); L := array_append(L, 'FAIL approval asked without photos');
  exception when others then L := array_append(L, 'ok approval needs inspection photos first'); end;
  insert into inspection_media (request_id, path, file_name, media_type) values (r1, 'staff/' || r1 || '/inspection-1.jpg', 'inspection-1.jpg', 'image');
  begin update requests set status = 'air_shipping' where id = r1; L := array_append(L, 'FAIL shipped without client approval');
  exception when others then L := array_append(L, 'ok D13 no shipping without the client approval'); end;
  begin update requests set status = 'air_shipping', inspection_override_note = 'Client approved on the phone' where id = r1; L := array_append(L, 'FAIL Ops override');
  exception when others then L := array_append(L, 'ok only an admin can override'); end;
  perform request_inspection_approval(r1);

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform approve_inspection(r1); L := array_append(L, 'FAIL other client approved');
  exception when others then L := array_append(L, 'ok other client cannot approve'); end;
  select count(*) into n from inspection_media where request_id = r1; L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' other client sees no inspection media');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from inspection_media where request_id = r1; L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' client sees the inspection media');
  select count(*) into n from request_messages where request_id = r1 and kind = 'update' and body like 'Inspection photos are ready%';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' client told the photos are ready');
  begin update requests set inspection_approved_at = now() where id = r1; get diagnostics n = row_count;
    L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client cannot set the approval directly (rows=' || n || ')');
  exception when others then L := array_append(L, 'ok client cannot set the approval directly'); end;
  perform approve_inspection(r1);
  begin perform approve_inspection(r1); L := array_append(L, 'FAIL approved twice');
  exception when others then L := array_append(L, 'ok approved once'); end;
  execute 'reset role';
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r1 and x.body like 'I approve the inspection%';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' team emailed about the approval');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set status = 'air_shipping' where id = r1;
  select status into v from requests where id = r1; L := array_append(L, case when v = 'air_shipping' then 'ok' else 'FAIL' end || ' approved order ships -> ' || v);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set status = 'air_shipping', inspection_override_note = 'Client approved by phone' where id = r2;
  select status || '/' || (inspection_override_by is not null)::text into v from requests where id = r2;
  L := array_append(L, case when v = 'air_shipping/true' then 'ok' else 'FAIL' end || ' admin override with a note -> ' || v);
  execute 'reset role';
  select string_agg(distinct action, ',' order by action) into v from request_events where request_id = r1 and action like 'inspection_%';
  L := array_append(L, case when v = 'inspection_approved,inspection_sent' then 'ok' else 'FAIL' end || ' activity log: ' || v);
  raise exception 'RESULTS %', array_to_string(L, E'\n');
end $t$;
