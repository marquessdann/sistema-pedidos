-- Novo ciclo do pedido (pedido do Daniel):
-- vendedor → aprovado → faturado → enviado para a logística → recebido na logística → em separação
-- → separado → em rota de entrega → entregue.
-- Substitui as transições configuradas pelas do novo ciclo (instalação nova: o seed cria).
DELETE FROM "order_status_transitions";
INSERT INTO "order_status_transitions" ("id", "fromStatus", "toStatus")
SELECT gen_random_uuid(), t.f::"OrderStatus", t.t::"OrderStatus"
  FROM (VALUES
  ('CREATED', 'PENDING_APPROVAL'),
  ('CREATED', 'APPROVED'),
  ('CREATED', 'REJECTED'),
  ('CREATED', 'CANCELLED'),
  ('PENDING_APPROVAL', 'APPROVED'),
  ('PENDING_APPROVAL', 'REJECTED'),
  ('PENDING_APPROVAL', 'CANCELLED'),
  ('APPROVED', 'INVOICED'),
  ('APPROVED', 'CANCELLED'),
  ('INVOICED', 'AWAITING_PICKING'),
  ('INVOICED', 'CANCELLED'),
  ('AWAITING_PICKING', 'LOGISTICS_RECEIVED'),
  ('AWAITING_PICKING', 'CANCELLED'),
  ('LOGISTICS_RECEIVED', 'PICKING'),
  ('LOGISTICS_RECEIVED', 'CANCELLED'),
  ('PICKING', 'AWAITING_SHIPMENT'),
  ('PICKING', 'CANCELLED'),
  ('AWAITING_SHIPMENT', 'OUT_FOR_DELIVERY'),
  ('AWAITING_SHIPMENT', 'SHIPPED'),
  ('AWAITING_SHIPMENT', 'CANCELLED'),
  ('SHIPPED', 'OUT_FOR_DELIVERY'),
  ('SHIPPED', 'DELIVERED'),
  ('OUT_FOR_DELIVERY', 'DELIVERED'),
  ('DELIVERED', 'COMPLETED')
  ) AS t(f, t)
 WHERE EXISTS (SELECT 1 FROM "company_settings")
ON CONFLICT ("fromStatus", "toStatus") DO NOTHING;
