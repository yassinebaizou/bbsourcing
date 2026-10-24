-- Client-facing stage names, as listed in docs/PROCESS.md section 2.1. Team labels are unchanged.
update public.request_statuses s set client_stage = v.stage
from (values
  ('new_application',        'In review'),
  ('under_review',           'In review'),
  ('contact_pending',        'In review'),
  ('contacted',              'In review'),
  ('feasibility_confirmed',  'Approved'),
  ('quotation_in_progress',  'Approved, preparing your quotation'),
  ('awaiting_confirmation',  'Quotation sent'),
  ('awaiting_deposit',       'Waiting for 40% deposit'),
  ('order_processing',       'In production'),
  ('quality_inspection',     'Quality inspection'),
  ('air_shipping',           'Shipped to Morocco'),
  ('customs_clearance',      'Arrived in Morocco, in customs clearance'),
  ('arrived_morocco',        'Customs cleared'),
  ('awaiting_final_payment', 'Waiting for 60% payment'),
  ('ready_for_delivery',     'Out for delivery'),
  ('out_for_delivery',       'Out for delivery'),
  ('completed',              'Delivered'),
  ('not_qualified',          'Closed')
) as v(code, stage)
where s.code = v.code;
