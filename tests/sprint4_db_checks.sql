-- Sprint 4 database checks: each situation D9–D17 of docs/WORK_PLAN.md, and the activity log.
-- Run in the Supabase SQL editor or via execute_sql. Everything is rolled back: the block always ends
-- with RAISE EXCEPTION, which carries the results. Every line should start with "ok".
-- No schema change and no row removal, so the Supabase tool runs it without a confirmation prompt.
do $t$ declare L text[] := '{}'; n int; v text; j jsonb; amt numeric;
  c1 uuid := gen_random_uuid(); ops uuid := gen_random_uuid(); ag uuid := gen_random_uuid();
  admin_id uuid := (select user_id from public.staff where role = 'admin' and active order by created_at limit 1);
  ra uuid; rb uuid; rc uuid; rd uuid; rf uuid; fid uuid; cid uuid; tv text := (select terms_version from public.business_settings);
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (c1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s4-c1@example.com', '{"full_name":"Client Four"}'),
    (ops, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s4-ops@example.com', '{"full_name":"Ops"}'),
    (ag, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s4-ag@example.com', '{"full_name":"Agent"}');
  insert into public.staff (user_id, role) values (ops, 'ops_finance'), (ag, 'agent');

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item A', 'https://x.com/a', 100, 'new', 'Rabat', true, true) returning id into ra;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item B', 'https://x.com/b', 100, 'new', 'Rabat', true, true) returning id into rb;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item C', 'https://x.com/c', 100, 'new', 'Rabat', true, true) returning id into rc;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item D', 'https://x.com/d', 100, 'new', 'Rabat', true, true) returning id into rd;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Item F', 'https://x.com/f', 100, 'new', 'Rabat', true, true) returning id into rf;

  -- D9: cancel before the 40% = free, no refund.
  perform cancel_request(ra, 'Not needed any more');
  select status || '/' || (select count(*) from refunds where request_id = ra) into v from requests where id = ra;
  L := array_append(L, case when v = 'cancelled_by_client/0' then 'ok' else 'FAIL' end || ' D9 cancel before 40% -> ' || v);

  -- Quotes 24,000 on B, C, D, F; client accepts; deposit proof; Ops verifies the 40%.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_amount_mad = 24000 where id in (rb, rc, rd, rf);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform accept_quote(rb, tv); perform accept_quote(rc, tv); perform accept_quote(rf, tv);
  execute 'reset role';
  insert into storage.objects (bucket_id, name, owner) values ('request-files', c1 || '/' || rb || '/p.pdf', c1), ('request-files', c1 || '/' || rc || '/p.pdf', c1),
    ('request-files', c1 || '/' || rf || '/p.pdf', c1), ('request-files', c1 || '/' || rf || '/claim.jpg', c1), ('request-files', c1 || '/' || rf || '/p60.pdf', c1), ('request-files', 'staff/' || rb || '/refund.pdf', admin_id);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform submit_payment_proof(rb, 'deposit', c1 || '/' || rb || '/p.pdf', 'p.pdf');
  perform submit_payment_proof(rc, 'deposit', c1 || '/' || rc || '/p.pdf', 'p.pdf');
  perform submit_payment_proof(rf, 'deposit', c1 || '/' || rf || '/p.pdf', 'p.pdf');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update payments set deposit_status = 'verified' where request_id in (rb, rc, rf);

  -- D10: cancel after the 40%, before the supplier order = full refund of the 40%.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform cancel_request(rb, 'Found it cheaper');
  select count(*) into n from refunds; L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client reads refunds table rows=' || n);
  select my_refunds(rb)->0->>'status' into v; L := array_append(L, case when v = 'requested' then 'ok' else 'FAIL' end || ' client sees refund status=' || v);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select f.id, r.status || '/' || f.status || '/' || f.amount_mad::int into fid, v from requests r join refunds f on f.request_id = r.id where r.id = rb;
  L := array_append(L, case when v = 'refund_pending/requested/9600' then 'ok' else 'FAIL' end || ' D10 cancel after 40% -> ' || coalesce(v, 'none'));
  select count(*) into n from refunds where request_id = rb; L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' Ops sees the refund of a cancelled order');
  begin update refunds set status = 'approved' where id = fid; L := array_append(L, 'FAIL Ops approved a refund');
  exception when others then L := array_append(L, 'ok Ops cannot approve: ' || sqlerrm); end;
  begin update refunds set status = 'paid', reference = 'X' where id = fid; L := array_append(L, 'FAIL paid before approval');
  exception when others then L := array_append(L, 'ok not paid before approval'); end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update refunds set status = 'approved' where id = fid;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin update refunds set status = 'paid' where id = fid; L := array_append(L, 'FAIL paid without reference');
  exception when others then L := array_append(L, 'ok paid needs the transfer reference'); end;
  update refunds set status = 'paid', reference = 'VIR-R1', proof_path = 'staff/' || rb || '/refund.pdf' where id = fid;
  select r.status || '/' || f.status into v from requests r join refunds f on f.request_id = r.id where r.id = rb;
  L := array_append(L, case when v = 'refunded/paid' then 'ok' else 'FAIL' end || ' D17 refund paid -> ' || v);
  begin update refunds set status = 'cancelled' where id = fid; L := array_append(L, 'FAIL changed a paid refund');
  exception when others then L := array_append(L, 'ok paid refund is final'); end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select my_refunds(rb)->0->>'reference' into v; L := array_append(L, case when v = 'VIR-R1' then 'ok' else 'FAIL' end || ' client sees paid refund reference');

  -- D11: no client cancellation once the supplier order is placed.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set status = 'order_processing' where id in (rc, rf);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform cancel_request(rc, 'Too late?'); L := array_append(L, 'FAIL D11 cancelled after supplier order');
  exception when others then L := array_append(L, 'ok D11 cancel after supplier order refused'); end;

  -- Statuses set only by the system; refunds only by admin/Ops, capped at the order price.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin update requests set status = 'refunded' where id = rc; L := array_append(L, 'FAIL team set refunded by hand');
  exception when others then L := array_append(L, 'ok refund statuses are automatic'); end;
  begin insert into refunds (request_id, amount_mad, reason) values (rc, 30000, 'other'); L := array_append(L, 'FAIL refund above price');
  exception when others then L := array_append(L, 'ok refund above the order price refused'); end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin insert into refunds (request_id, amount_mad, reason) values (rc, 10, 'other'); L := array_append(L, 'FAIL agent recorded a refund');
  exception when others then L := array_append(L, 'ok agent cannot record a refund'); end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform team_cancel_request(rc, 'supplier_failed', 'Supplier closed'); L := array_append(L, 'FAIL Ops cancelled an order');
  exception when others then L := array_append(L, 'ok only admin cancels an order'); end;

  -- D12: problem on our side after the order = full refund of what was paid.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform team_cancel_request(rc, 'supplier_failed', 'The supplier stopped this product.');
  select r.status || '/' || r.cancelled_by || '/' || f.amount_mad::int || '/' || f.reason into v from requests r join refunds f on f.request_id = r.id where r.id = rc;
  L := array_append(L, case when v = 'refund_pending/team/9600/supplier_failed' then 'ok' else 'FAIL' end || ' D12 problem on our side -> ' || v);

  -- D14: late delivery counts as our problem (no money paid here: cancelled without refund).
  perform team_cancel_request(rd, 'late_delivery', 'Delivery more than 10 days late.');
  select status into v from requests where id = rd;
  L := array_append(L, case when v = 'cancelled_by_us' then 'ok' else 'FAIL' end || ' D14 late delivery -> ' || v);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from request_messages where request_id = rd and kind = 'update' and body like 'We cancelled this order:%';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' client told why we cancelled');

  -- D15: 60% due -> dates and reminders.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set status = 'quality_inspection' where id = rf;
  update requests set status = 'air_shipping' where id = rf;
  update requests set status = 'customs_clearance' where id = rf;
  update requests set status = 'arrived_morocco' where id = rf;
  update requests set status = 'awaiting_final_payment' where id = rf;
  execute 'reset role';
  set local session_replication_role = replica;
  update payments set final_due_at = now() - interval '8 days' where request_id = rf;
  set local session_replication_role = origin;
  select send_balance_reminders() into n;
  select count(*) into amt from request_messages where request_id = rf and kind = 'update' and body like 'Reminder:%storage fee applies%';
  L := array_append(L, case when amt = 1 then 'ok' else 'FAIL' end || ' D15 reminder with storage-fee date sent');
  select send_balance_reminders() into n;
  select count(*) into amt from request_messages where request_id = rf and kind = 'update' and body like 'Reminder:%';
  L := array_append(L, case when amt = 1 then 'ok' else 'FAIL' end || ' D15 same reminder not sent twice');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select my_payment_info(rf) into j;
  L := array_append(L, case when j ? 'storage_fee_from' and j->>'storage_fee_from' is not null and j->>'cancel_after' is not null then 'ok' else 'FAIL' end || ' D15 client sees storage-fee and cancel dates');

  -- D16: claim within 72 hours with a photo; outcome refund.
  perform submit_payment_proof(rf, 'final', c1 || '/' || rf || '/p60.pdf', 'p60.pdf');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update payments set final_status = 'verified' where request_id = rf;
  update requests set status = 'ready_for_delivery' where id = rf;
  update requests set status = 'out_for_delivery' where id = rf;
  update requests set status = 'completed' where id = rf;
  execute 'reset role';
  set local session_replication_role = replica;
  update request_events set created_at = now() - interval '80 hours' where request_id = rf and action = 'status_changed' and details->>'to' = 'completed';
  set local session_replication_role = origin;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform open_claim(rf, 3, 'Three units arrived broken.', jsonb_build_array(jsonb_build_object('path', c1 || '/' || rf || '/claim.jpg', 'name', 'claim.jpg', 'type', 'image/jpeg')));
    L := array_append(L, 'FAIL claim after 72 hours accepted');
  exception when others then L := array_append(L, 'ok D16 claim after 72 hours refused'); end;
  execute 'reset role';
  set local session_replication_role = replica;
  update request_events set created_at = now() - interval '2 hours' where request_id = rf and action = 'status_changed' and details->>'to' = 'completed';
  set local session_replication_role = origin;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform open_claim(rf, 3, 'Three units arrived broken.', '[]'::jsonb); L := array_append(L, 'FAIL claim without photo');
  exception when others then L := array_append(L, 'ok claim needs a photo or video'); end;
  select open_claim(rf, 3, 'Three units arrived broken.', jsonb_build_array(jsonb_build_object('path', c1 || '/' || rf || '/claim.jpg', 'name', 'claim.jpg', 'type', 'image/jpeg'))) into cid;
  begin perform open_claim(rf, 1, 'Another problem here.', jsonb_build_array(jsonb_build_object('path', c1 || '/' || rf || '/claim.jpg', 'name', 'c.jpg', 'type', 'image/jpeg')));
    L := array_append(L, 'FAIL second open claim');
  exception when others then L := array_append(L, 'ok one open claim at a time'); end;
  select count(*) into n from claims where id = cid; L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' D16 client sees the claim');
  begin update claims set status = 'resolved', outcome = 'refund', refund_amount_mad = 99999 where id = cid; get diagnostics n = row_count;
    L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client cannot answer the claim (rows=' || n || ')');
  exception when others then L := array_append(L, 'ok client cannot answer the claim'); end;
  execute 'reset role';
  select count(*) into n from message_notifications m join request_messages x on x.id = m.message_id where x.request_id = rf and x.body like 'Claim:%';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' team emailed about the claim');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update claims set status = 'resolved', outcome = 'refund', refund_amount_mad = 720, outcome_note = '3 units refunded.' where id = cid;
  select f.reason || '/' || f.amount_mad::int || '/' || f.status || '/' || r.status into v from refunds f join requests r on r.id = f.request_id where f.claim_id = cid;
  L := array_append(L, case when v = 'claim/720/requested/completed' then 'ok' else 'FAIL' end || ' D16 claim refund created -> ' || v);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from request_messages where request_id = rf and kind = 'update' and body like 'Claim answered: refund of MAD 720%';
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' client told the claim outcome');

  -- Activity log.
  execute 'reset role';
  select string_agg(distinct action, ',' order by action) into v from request_events
   where request_id in (ra, rb, rc, rd, rf) and action in ('client_cancelled', 'refund_requested', 'refund_approved', 'refund_paid',
     'team_cancelled', 'balance_reminder', 'claim_opened', 'claim_resolved');
  L := array_append(L, case when v = 'balance_reminder,claim_opened,claim_resolved,client_cancelled,refund_approved,refund_paid,refund_requested,team_cancelled' then 'ok' else 'FAIL' end || ' activity log: ' || v);

  raise exception 'RESULTS %', array_to_string(L, E'\n');
end $t$;
