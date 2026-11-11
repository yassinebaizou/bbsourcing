-- =====================================================================
-- Sprint 7: the language chosen on the website is saved at signup.
-- /fr pages and /fr/account send user_metadata.language = 'fr'; profiles.language (Sprint 6) then
-- decides the language of the emails. Anything else than en / fr / ar is stored as 'en'.
-- Same function as before, with the language column added.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare p jsonb := new.raw_user_meta_data->'pending_request';
begin
  insert into public.profiles (id, email, full_name, whatsapp, city, business_name, store_link, selling_status, language)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'whatsapp', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    nullif(new.raw_user_meta_data->>'business_name', ''),
    nullif(new.raw_user_meta_data->>'store_link', ''),
    case when new.raw_user_meta_data->>'selling_status' in ('starting','selling','scaling')
         then new.raw_user_meta_data->>'selling_status' end,
    case when new.raw_user_meta_data->>'language' in ('en','fr','ar')
         then new.raw_user_meta_data->>'language' else 'en' end
  );

  if p is not null and jsonb_typeof(p) = 'object' then
    begin
      insert into public.requests (
        client_id, product_name, category, product_link, quantity, estimated_value_mad,
        target_unit_cost_mad, alibaba_price_usd, unit_weight_g, estimator_price_mad,
        specifications, order_type, budget_range, urgency, client_notes, delivery_city,
        consent_whatsapp, privacy_accepted)
      values (
        new.id,
        left(p->>'product_name', 200),
        p->>'category',
        nullif(left(p->>'product_link', 2000), ''),
        (p->>'quantity')::int,
        (p->>'estimated_value_mad')::numeric,
        nullif(p->>'target_unit_cost_mad', '')::numeric,
        nullif(p->>'alibaba_price_usd', '')::numeric,
        nullif(p->>'unit_weight_g', '')::numeric,
        nullif(p->>'estimator_price_mad', '')::numeric,
        nullif(left(p->>'specifications', 3000), ''),
        p->>'order_type',
        left(p->>'budget_range', 60),
        left(p->>'urgency', 60),
        nullif(left(p->>'client_notes', 3000), ''),
        nullif(left(p->>'delivery_city', 120), ''),
        (p->>'consent_whatsapp')::boolean,
        (p->>'privacy_accepted')::boolean);
    exception when others then
      begin
        insert into public.failed_pending_requests (user_id, payload, error) values (new.id, p, left(sqlerrm, 500));
      exception when others then
        null;
      end;
    end;
  end if;
  return new;
end $$;
