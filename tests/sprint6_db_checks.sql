-- Sprint 6 database checks: client emails queued at each key moment, no double email, profile preferences.
-- Run in the Supabase SQL editor or via execute_sql. Everything is rolled back (no data, no email): the block
-- always ends with RAISE EXCEPTION, which carries the results. Every line should start with "ok".
do $t$ declare L text[] := '{}'; n int; v text;
  c1 uuid := gen_random_uuid(); ops uuid := gen_random_uuid();
  admin_id uuid := (select user_id from public.staff where role = 'admin' and active order by created_at limit 1);
  r1 uuid; r2 uuid; fid uuid; tv text := (select terms_version from public.business_settings);
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (c1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s6-c1@example.com', '{"full_name":"Client Six"}'),
    (ops, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s6-ops@example.com', '{"full_name":"Ops"}');
  insert into public.staff (user_id, role) values (ops, 'ops_finance');

  -- Request received.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item One', 'https://x.com/1', 100, 'new', 'Rabat', true, true) returning id into r1;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item Two', 'https://x.com/2', 100, 'new', 'Rabat', true, true) returning id into r2;
  begin select count(*) into n from client_emails; L := array_append(L, 'FAIL client reads client_emails');
  exception when others then L := array_append(L, 'ok client cannot read client_emails'); end;
  begin perform queue_client_email(r1, 'shipped', 'fake'); L := array_append(L, 'FAIL client queued an email');
  exception when others then L := array_append(L, 'ok client cannot queue an email'); end;
  execute 'reset role';
  select count(*) into n from client_emails where request_id = r1 and kind = 'request_received';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' request received email queued');

  -- Quote ready, sent again, expiring.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_amount_mad = 24000 where id in (r1, r2);
  execute 'reset role';
  select count(*) into n from client_emails where request_id = r1 and kind = 'quote_ready';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' quote ready email queued');
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r1 and x.body = 'Status update: Quotation sent';
  L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' no generic "Quotation sent" email on top (' || n || ')');
  -- In one transaction now() never moves: age the first send so "Send again" gets a new date, as in real use.
  set local session_replication_role = replica;
  update requests set quote_sent_at = now() - interval '1 hour' where id = r1;
  update client_emails set ref = (now() - interval '1 hour')::text where request_id = r1 and kind = 'quote_ready';
  set local session_replication_role = origin;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_sent_at = now() where id = r1;
  execute 'reset role';
  select count(*) into n from client_emails where request_id = r1 and kind = 'quote_ready';
  L := array_append(L, case when n = 2 then 'ok' else 'FAIL' end || ' quote sent again = new email (' || n || ')');
  set local session_replication_role = replica;
  update requests set quote_sent_at = now() - interval '5 days', quote_expires_at = now() + interval '30 hours' where id = r1;
  update requests set quote_sent_at = now() - interval '2 hours', quote_expires_at = now() + interval '30 hours' where id = r2;
  set local session_replication_role = origin;
  perform send_quote_expiry_reminders(); perform send_quote_expiry_reminders();
  select count(*) into n from client_emails where request_id = r1 and kind = 'quote_expiring';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' quote expiring email queued once (' || n || ')');
  select count(*) into n from client_emails where request_id = r2 and kind = 'quote_expiring';
  L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' no expiry reminder for a quote sent today');
  select count(*) into n from cron.job where jobname = 'ddp-quote-expiry-reminders';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' daily expiry job scheduled');
  update requests set quote_expires_at = now() + interval '10 days' where id in (r1, r2);

  -- Deposit verified.
  insert into storage.objects (bucket_id, name, owner) values
    ('request-files', c1 || '/' || r1 || '/p.pdf', c1), ('request-files', c1 || '/' || r2 || '/p.pdf', c1),
    ('request-files', c1 || '/' || r1 || '/p60.pdf', c1), ('request-files', 'staff/' || r1 || '/inspection-1.jpg', ops),
    ('request-files', 'staff/' || r2 || '/refund.pdf', admin_id);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform accept_quote(r1, tv); perform accept_quote(r2, tv);
  perform submit_payment_proof(r1, 'deposit', c1 || '/' || r1 || '/p.pdf', 'p.pdf');
  perform submit_payment_proof(r2, 'deposit', c1 || '/' || r2 || '/p.pdf', 'p.pdf');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update payments set deposit_status = 'verified' where request_id in (r1, r2);
  update requests set status = 'order_processing' where id = r1;
  execute 'reset role';
  select count(*) into n from client_emails where request_id = r1 and kind = 'deposit_verified';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' deposit verified email queued');
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r1 and x.body = 'Status update: In production';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' other stage changes keep the generic email');

  -- Inspection ready.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set status = 'quality_inspection' where id = r1;
  insert into inspection_media (request_id, path, file_name, media_type) values (r1, 'staff/' || r1 || '/inspection-1.jpg', 'inspection-1.jpg', 'image');
  perform request_inspection_approval(r1);
  execute 'reset role';
  select count(*) into n from client_emails where request_id = r1 and kind = 'inspection_ready';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' inspection ready email queued');
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r1 and x.body like 'Inspection photos are ready%';
  L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' no generic inspection email on top');

  -- Shipped, customs, 60% due, delivered.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform approve_inspection(r1);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set status = 'air_shipping' where id = r1;
  update requests set status = 'customs_clearance' where id = r1;
  update requests set status = 'arrived_morocco' where id = r1;
  update requests set status = 'awaiting_final_payment' where id = r1;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform submit_payment_proof(r1, 'final', c1 || '/' || r1 || '/p60.pdf', 'p60.pdf');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update payments set final_status = 'verified' where request_id = r1;
  update requests set status = 'ready_for_delivery' where id = r1;
  update requests set status = 'out_for_delivery' where id = r1;
  update requests set status = 'completed' where id = r1;
  execute 'reset role';
  select string_agg(kind, ',' order by id) into v from client_emails where request_id = r1;
  L := array_append(L, case when v = 'request_received,quote_ready,quote_ready,quote_expiring,deposit_verified,inspection_ready,shipped,final_due,delivered' then 'ok' else 'FAIL' end || ' emails of the whole order in order: ' || v);
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r1
    and x.body in ('Status update: Shipped to Morocco', 'Status update: Waiting for 60% payment', 'Status update: Delivered');
  L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' no generic email for shipped, 60% due, delivered (' || n || ')');
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r1
    and x.body = 'Status update: Arrived in Morocco, in customs clearance';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' customs clearance keeps the generic email');

  -- Refund paid.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform cancel_request(r2, 'Changed my mind');
  execute 'reset role';
  select id into fid from refunds where request_id = r2;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update refunds set status = 'approved' where id = fid;
  update refunds set status = 'paid', reference = 'VIR-S6', proof_path = 'staff/' || r2 || '/refund.pdf' where id = fid;
  execute 'reset role';
  select count(*) into n from client_emails where request_id = r2 and kind = 'refund_paid' and ref = fid::text;
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' refund paid email queued');
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = r2 and x.body like 'Refund paid:%';
  L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' no generic refund email on top');

  -- Preferences in the profile.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select email_updates::text || '/' || language into v from profiles where id = c1;
  L := array_append(L, case when v = 'true/en' then 'ok' else 'FAIL' end || ' defaults: step emails on, English (' || v || ')');
  update profiles set email_updates = false, language = 'fr' where id = c1;
  select email_updates::text || '/' || language into v from profiles where id = c1;
  L := array_append(L, case when v = 'false/fr' then 'ok' else 'FAIL' end || ' client saves preferences (' || v || ')');
  begin update profiles set language = 'de' where id = c1; L := array_append(L, 'FAIL unknown language saved');
  exception when others then L := array_append(L, 'ok unknown language refused'); end;
  execute 'reset role';
  raise exception 'RESULTS %', array_to_string(L, E'\n');
end $t$;
