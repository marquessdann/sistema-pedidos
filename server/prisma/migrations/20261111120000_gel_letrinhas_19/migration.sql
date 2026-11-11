-- Gel Letrinhas: todos por R$ 19,00 (pedido do administrador em 11/11/2026)
INSERT INTO "product_price_history" ("id", "productId", "oldPriceCents", "newPriceCents", "oldCostCents", "newCostCents", "createdAt")
SELECT gen_random_uuid(), p."id", p."priceCents", 1900, p."costCents", p."costCents", now()
  FROM "products" p
 WHERE p."sku" IN ('GEL-002-LE001', 'GEL-003-LE002', 'GEL-004-LE003', 'GEL-005-LE004')
   AND p."priceCents" <> 1900;

UPDATE "products" SET "priceCents" = 1900, "updatedAt" = now()
 WHERE "sku" IN ('GEL-002-LE001', 'GEL-003-LE002', 'GEL-004-LE003', 'GEL-005-LE004')
   AND "priceCents" <> 1900;
