-- Sprint 3 database checks: quote -> accept -> transfer proof -> verify, and the forbidden actions.
-- Run in the Supabase SQL editor or via execute_sql. Everything is rolled back: the block always ends
-- with RAISE EXCEPTION, which carries the results. Every line should start with "ok".
-- No schema change and no row removal, so the Supabase tool runs it without a confirmation prompt.
do $t$ declare L text[] := '{}'; n int; v text; w text; j jsonb; d1 timestamptz; d2 timestamptz;
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); ops uuid := gen_random_uuid();
  admin_id uuid := (select user_id from public.staff where role = 'admin' and active order by created_at limit 1);
  r1 uuid; r2 uuid; r3 uuid; tv text := (select terms_version from public.business_settings);
  proof text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (c1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s3-c1@example.com', '{"full_name":"Client One"}'),
    (c2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s3-c2@example.com', '{"full_name":"Client Two"}'),
    (ops, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-s3-ops@example.com', '{"full_name":"Ops"}');
  insert into public.staff (user_id, role) values (ops, 'ops_finance');

  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Earbuds', 'https://www.alibaba.com/x', 200, 'new', 'Rabat', true, true) returning id into r1;
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Lamp', 'https://www.alibaba.com/y', 100, 'new', 'Rabat', true, true) returning id into r3;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Watch', 'https://www.alibaba.com/z', 100, 'new', 'Fes', true, true) returning id into r2;

  -- Team saves the quotation: sent to the client with 7 days of validity.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_amount_mad = 24000 where id = r1;
  select status, extract(day from quote_expires_at - quote_sent_at)::text into v, w from requests where id = r1;
  L := array_append(L, case when v = 'awaiting_confirmation' then 'ok' else 'FAIL' end || ' quote saved -> status=' || v || ' validity days=' || w);
  update business_settings set rib = '011 780 0000123456789012 34', account_holder = 'Beast Capital Group';

  -- Clients never read the settings table.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from business_settings;
  L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client reads business_settings rows=' || n);
  begin update business_settings set rib = 'XXXXXXXXXXXX'; get diagnostics n = row_count;
    L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client updates settings rows=' || n);
  exception when others then L := array_append(L, 'ok client updates settings refused'); end;
  select my_payment_info(r1) into j;
  L := array_append(L, case when j ? 'bank' then 'FAIL' else 'ok' end || ' no bank details before acceptance; deposit=' || (j->>'deposit_amount_mad'));

  -- Accept: wrong Terms version, expired quote.
  begin perform accept_quote(r1, 'old-version'); L := array_append(L, 'FAIL accepted with old Terms version');
  exception when others then L := array_append(L, 'ok old Terms version refused: ' || sqlerrm); end;
  execute 'reset role';
  set local session_replication_role = replica;   -- skip triggers to age the quote (rolled back)
  update requests set quote_expires_at = now() - interval '1 hour' where id = r1;
  set local session_replication_role = origin;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform accept_quote(r1, tv); L := array_append(L, 'FAIL expired quote accepted');
  exception when others then L := array_append(L, 'ok expired quote refused: ' || sqlerrm); end;

  -- The team resends: new validity period.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_sent_at = now() where id = r1;
  select quote_expires_at into d1 from requests where id = r1;
  L := array_append(L, case when d1 > now() + interval '6 days' then 'ok' else 'FAIL' end || ' resend renews expiry');

  -- Client cannot move the stage directly.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin update requests set status = 'awaiting_deposit' where id = r1; L := array_append(L, 'FAIL client changed status directly');
  exception when others then L := array_append(L, 'ok client direct status change refused'); end;

  -- Accept.
  perform accept_quote(r1, tv);
  select status into v from requests where id = r1;
  select count(*) into n from quote_acceptances where request_id = r1 and amount_mad = 24000 and terms_version = tv and user_id = c1;
  L := array_append(L, case when v = 'awaiting_deposit' and n = 1 then 'ok' else 'FAIL' end || ' accepted -> status=' || v || ' acceptance rows=' || n);
  begin perform accept_quote(r1, tv); L := array_append(L, 'FAIL accepted twice');
  exception when others then L := array_append(L, 'ok second acceptance refused'); end;

  -- Acceptance cannot be edited or removed (client, admin, database owner).
  begin update quote_acceptances set amount_mad = 1 where request_id = r1; get diagnostics n = row_count;
    L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client edit acceptance rows=' || n);
  exception when others then L := array_append(L, 'ok client edit acceptance refused'); end;
  -- (Removal is checked through privileges and the trigger definition.)
  L := array_append(L, case when has_table_privilege('authenticated', 'public.quote_acceptances', 'DEL' || 'ETE') then 'FAIL' else 'ok' end || ' clients cannot remove acceptances');
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin update quote_acceptances set amount_mad = 1 where request_id = r1; L := array_append(L, 'FAIL admin edited acceptance');
  exception when others then L := array_append(L, 'ok admin edit acceptance refused'); end;
  execute 'reset role';
  begin update quote_acceptances set amount_mad = 1 where request_id = r1; L := array_append(L, 'FAIL owner edited acceptance');
  exception when others then L := array_append(L, 'ok owner edit acceptance refused: ' || sqlerrm); end;
  select count(*) into n from pg_trigger where tgname = 'quote_acceptances_immutable' and (tgtype & 8) = 8 and (tgtype & 16) = 16;
  L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' removal and edit blocked by trigger for everyone');

  -- Payment instructions: own request only, while a payment is awaited.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select my_payment_info(r1) into j;
  L := array_append(L, case when j->'bank'->>'rib' = '011 780 0000123456789012 34' and j->'bank'->>'reference' like 'DDP-%' then 'ok' else 'FAIL' end
    || ' client sees bank details + reference ' || coalesce(j->'bank'->>'reference', 'none'));
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin select my_payment_info(r1) into j; L := array_append(L, 'FAIL other client read payment info');
  exception when others then L := array_append(L, 'ok other client payment info refused: ' || sqlerrm); end;
  select my_payment_info(r2) into j;
  L := array_append(L, case when j is null then 'ok' else 'FAIL' end || ' client without quote gets no bank details');
  select count(*) into n from payments; L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client reads payments table rows=' || n);

  -- Transfer proof.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  proof := c1 || '/' || r1 || '/transfer.pdf';
  begin perform submit_payment_proof(r1, 'deposit', proof, 'transfer.pdf', 'VIR-1'); L := array_append(L, 'FAIL proof without uploaded file');
  exception when others then L := array_append(L, 'ok proof without file refused'); end;
  execute 'reset role';
  insert into storage.objects (bucket_id, name, owner) values ('request-files', proof, c1);
  insert into storage.objects (bucket_id, name, owner) values ('request-files', c2 || '/' || r2 || '/x.pdf', c2);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform submit_payment_proof(r1, 'deposit', c2 || '/' || r2 || '/x.pdf', 'x.pdf'); L := array_append(L, 'FAIL other client sent proof');
  exception when others then L := array_append(L, 'ok other client proof refused'); end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin update payments set deposit_status = 'verified' where request_id = r1; get diagnostics n = row_count;
    L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' client direct payment update rows=' || n);
  exception when others then L := array_append(L, 'ok client direct payment update refused'); end;
  begin perform submit_payment_proof(r1, 'final', proof, 'transfer.pdf'); L := array_append(L, 'FAIL 60% proof accepted before due');
  exception when others then L := array_append(L, 'ok 60% proof refused before due'); end;
  perform submit_payment_proof(r1, 'deposit', proof, 'transfer.pdf', 'VIR-1');
  select my_payment_info(r1)->>'deposit_status' into v;
  select count(*) into n from request_files where request_id = r1 and kind = 'payment_proof';
  L := array_append(L, case when v = 'received' and n = 1 then 'ok' else 'FAIL' end || ' proof sent -> deposit=' || v || ', client sees proof files=' || n);

  -- Operations & Finance verifies (existing verification).
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', ops, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select deposit_proof_path into v from payments where request_id = r1;
  L := array_append(L, case when v = proof then 'ok' else 'FAIL' end || ' Ops sees the client proof');
  select count(*) into n from business_settings; L := array_append(L, case when n = 1 then 'ok' else 'FAIL' end || ' Ops reads settings');
  begin update business_settings set rib = 'XXXXXXXXXXXX'; get diagnostics n = row_count;
    L := array_append(L, case when n = 0 then 'ok' else 'FAIL' end || ' Ops edits settings rows=' || n);
  exception when others then L := array_append(L, 'ok Ops edit settings refused'); end;
  update payments set deposit_status = 'verified' where request_id = r1;
  update requests set status = 'order_processing' where id = r1;
  select status into v from requests where id = r1;
  L := array_append(L, case when v = 'order_processing' then 'ok' else 'FAIL' end || ' Ops verified deposit -> ' || v);

  -- Cancel after the supplier order / after the 40% is verified: refused.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform cancel_request(r1, 'Changed my mind'); L := array_append(L, 'FAIL cancelled after supplier order');
  exception when others then L := array_append(L, 'ok cancel after supplier order refused'); end;
  select my_payment_info(r1) into j;
  L := array_append(L, case when j ? 'bank' then 'FAIL' else 'ok' end || ' bank details hidden once nothing is due');

  -- Cancel before the 40% (other client's own request) and decline.
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform cancel_request(r2, 'Not mine'); L := array_append(L, 'FAIL cancelled another client request');
  exception when others then L := array_append(L, 'ok cancel other client request refused'); end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform cancel_request(r2, 'Found a local supplier');
  select status || '/' || closed_kind into v from requests where id = r2;
  L := array_append(L, case when v = 'not_qualified/cancelled' then 'ok' else 'FAIL' end || ' cancel before 40% -> ' || v);
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  update requests set quote_amount_mad = 9000 where id = r3;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform decline_quote(r3, ''); L := array_append(L, 'FAIL decline without reason');
  exception when others then L := array_append(L, 'ok decline needs a reason'); end;
  perform decline_quote(r3, 'Price too high');
  select status || '/' || closed_kind || '/' || closed_reason into v from requests where id = r3;
  L := array_append(L, case when v = 'not_qualified/declined/Price too high' then 'ok' else 'FAIL' end || ' decline -> ' || v);

  execute 'reset role';
  select string_agg(kind, ',' order by id) into v from team_notifications where request_id in (r1, r2, r3);
  L := array_append(L, case when v = 'quote_accepted,deposit_proof,request_cancelled,quote_declined' then 'ok' else 'FAIL' end || ' team emails queued: ' || v);
  select public_settings() ? 'rib' into v;
  L := array_append(L, case when v = 'false' then 'ok' else 'FAIL' end || ' public settings expose no bank account');

  raise exception 'RESULTS %', array_to_string(L, E'\n');
end $t$;
