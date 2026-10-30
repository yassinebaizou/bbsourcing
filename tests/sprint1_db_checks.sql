-- Sprint 1 database checks (ROADMAP A1, A3). Run in the Supabase SQL editor or via execute_sql.
-- Everything is rolled back: the block always ends with RAISE EXCEPTION, which carries the results.
-- Before the fix (30 Oct 2026): "requests=0 recorded=…" did not exist, below_minimum=NULL for 50 units.
-- After the fix expected: requests=0 recorded=1 | recorded=1 | RPC returns=Earbuds | client reads table rows=0 |
--   after resend RPC=null | qty 2,000,000 refused | team sees open failed>=1 | 50 units below_minimum=true | 300 units=false
do $t$ declare L text[] := '{}'; n int; v text;
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
  admin_id uuid := (select user_id from public.staff where role = 'admin' and active order by created_at limit 1);
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values (u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-a1a@example.com',
   '{"full_name":"T","pending_request":{"product_name":"Earbuds","product_link":"https://www.alibaba.com/product detail/x.html","quantity":100,"order_type":"new","delivery_city":"Rabat","consent_whatsapp":true,"privacy_accepted":true}}');
  select count(*) into n from requests where client_id=u1;
  select count(*)::text into v from failed_pending_requests where user_id=u1;
  L := array_append(L, 'A1 link with space: requests='||n||' recorded='||v);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values (u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-a1b@example.com',
   '{"full_name":"T","pending_request":{"product_name":"Earbuds","quantity":3000000000,"order_type":"new","delivery_city":"Rabat","consent_whatsapp":true,"privacy_accepted":true}}');
  select count(*) into n from failed_pending_requests where user_id=u2; L := array_append(L, 'A1 quantity 3e9: recorded='||n);
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true); execute 'set local role authenticated';
  select public.my_failed_request()->>'product_name' into v; L := array_append(L, 'A1 client RPC returns='||coalesce(v,'null'));
  select count(*) into n from failed_pending_requests; L := array_append(L, 'A1 client reads table rows='||n);
  insert into requests (product_name, product_link, quantity, order_type, delivery_city, consent_whatsapp, privacy_accepted)
    values ('Earbuds','https://www.alibaba.com/product%20detail/x.html',100,'new','Rabat',true,true);
  select coalesce(public.my_failed_request()->>'product_name','null') into v; L := array_append(L, 'A1 after resend RPC='||v);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin insert into requests (product_name, quantity, order_type, consent_whatsapp, privacy_accepted) values ('Big',2000000,'new',true,true); L := array_append(L,'FAIL qty 2M accepted');
  exception when others then L := array_append(L,'qty 2,000,000 refused'); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from failed_pending_requests where resolved_at is null; L := array_append(L, 'A1 team sees open failed='||n);
  execute 'reset role';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values (u3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-a3@example.com',
   '{"full_name":"T","pending_request":{"product_name":"Lamp","product_link":"https://www.alibaba.com/x","quantity":50,"order_type":"new","delivery_city":"Rabat","consent_whatsapp":true,"privacy_accepted":true}}');
  select coalesce(below_minimum::text,'NULL') into v from requests where client_id=u3; L := array_append(L, 'A3 50 units no value: below_minimum='||v);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values (u4,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-a3b@example.com',
   '{"full_name":"T","pending_request":{"product_name":"Lamp","product_link":"https://www.alibaba.com/x","quantity":300,"order_type":"new","delivery_city":"Rabat","consent_whatsapp":true,"privacy_accepted":true}}');
  select coalesce(below_minimum::text,'NULL') into v from requests where client_id=u4; L := array_append(L, 'A3 300 units: below_minimum='||v);
  raise exception 'RESULTS %', array_to_string(L, ' | ');
end $t$;
