-- Restrições de integridade adicionais (valores monetários e percentuais válidos)
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonneg" CHECK ("priceCents" >= 0 AND "costCents" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_taxref_range" CHECK ("taxRefBps" BETWEEN 0 AND 10000);
ALTER TABLE "products" ADD CONSTRAINT "products_reserved_nonneg" CHECK ("reservedQty" >= 0);

ALTER TABLE "sales_representatives" ADD CONSTRAINT "reps_discount_range" CHECK ("maxDiscountBps" BETWEEN 0 AND 10000);
ALTER TABLE "sales_representatives" ADD CONSTRAINT "reps_commission_range" CHECK ("commissionBps" IS NULL OR "commissionBps" BETWEEN 0 AND 10000);

ALTER TABLE "orders" ADD CONSTRAINT "orders_money_nonneg" CHECK (
  "grossCents" >= 0 AND "itemDiscountCents" >= 0 AND "generalDiscountCents" >= 0 AND "surchargeCents" >= 0
  AND "freightCents" >= 0 AND "totalCents" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_range" CHECK ("generalDiscountBps" BETWEEN 0 AND 10000 AND "effectiveDiscountBps" BETWEEN 0 AND 10000);
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_when_confirmed" CHECK ("status" = 'DRAFT' OR "number" IS NOT NULL);

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_money_nonneg" CHECK (
  "grossCents" >= 0 AND "itemDiscountCents" >= 0 AND "generalDiscountCents" >= 0 AND "surchargeCents" >= 0
  AND "freightCents" >= 0 AND "totalCents" >= 0);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_range" CHECK ("generalDiscountBps" BETWEEN 0 AND 10000 AND "effectiveDiscountBps" BETWEEN 0 AND 10000);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_consistency" CHECK (("status" = 'CONVERTED') = ("convertedOrderId" IS NOT NULL) OR ("status" <> 'CONVERTED' AND "convertedOrderId" IS NULL));

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_valid" CHECK ("quantity" > 0 AND "unitPriceCents" >= 0 AND "discountBps" BETWEEN 0 AND 10000 AND "netCents" >= 0);
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_valid" CHECK ("quantity" > 0 AND "unitPriceCents" >= 0 AND "discountBps" BETWEEN 0 AND 10000 AND "netCents" >= 0);

ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_rate_range" CHECK ("rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_target" CHECK (("orderId" IS NOT NULL) <> ("quoteId" IS NOT NULL));
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_singleton" CHECK ("id" = 1);

-- Logs de auditoria e históricos de status são somente-inserção (imutáveis)
CREATE OR REPLACE FUNCTION della_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % são imutáveis (somente inserção).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION della_prevent_mutation();
CREATE TRIGGER order_status_history_immutable BEFORE UPDATE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION della_prevent_mutation();
CREATE TRIGGER quote_status_history_immutable BEFORE UPDATE ON "quote_status_history"
  FOR EACH ROW EXECUTE FUNCTION della_prevent_mutation();
