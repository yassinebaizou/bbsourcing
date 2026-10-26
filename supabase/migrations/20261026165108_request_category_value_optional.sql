-- The homepage request form asks only for link, name, order type, quantity, photos and specs
-- (owner's request). Category and estimated value become optional.
-- "Below min." stays automatic when a value is known.
alter table public.requests alter column category drop not null;
alter table public.requests alter column estimated_value_mad drop not null;
