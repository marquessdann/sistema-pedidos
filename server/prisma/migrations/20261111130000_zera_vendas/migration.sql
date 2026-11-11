-- Pedido do Daniel (11/11/2026): limpa TODAS as vendas (pedidos, orçamentos, aprovações e PDFs gerados)
-- e recomeça a numeração. Mantém clientes, produtos, preços, usuários, vendedores, configurações
-- e as entradas/ajustes de estoque. Roda uma única vez (migração).

-- 1) Desfaz no estoque o efeito dos pedidos (baixas e reservas), sem mexer nas entradas/ajustes manuais
UPDATE "products" p
   SET "stockQty" = GREATEST(0, p."stockQty" - COALESCE((
         SELECT SUM(m."quantity") FROM "stock_movements" m
          WHERE m."productId" = p."id" AND m."orderId" IS NOT NULL AND m."type" IN ('OUT', 'RETURN', 'IN', 'ADJUST')), 0)),
       "reservedQty" = GREATEST(0, p."reservedQty" - COALESCE((
         SELECT SUM(m."quantity") FROM "stock_movements" m
          WHERE m."productId" = p."id" AND m."orderId" IS NOT NULL AND m."type" IN ('RESERVE', 'RELEASE')), 0)),
       "updatedAt" = now()
 WHERE EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."productId" = p."id" AND m."orderId" IS NOT NULL);

DELETE FROM "stock_movements" WHERE "orderId" IS NOT NULL;

-- 2) PDFs gerados de pedidos/orçamentos
DELETE FROM "stored_files" f USING "generated_documents" g WHERE f."fileName" = g."fileName";
DELETE FROM "generated_documents";

-- 3) Pedidos e orçamentos (itens e históricos saem em cascata)
DELETE FROM "discount_approvals";
UPDATE "orders" SET "quoteId" = NULL WHERE "quoteId" IS NOT NULL;
DELETE FROM "quotes";
DELETE FROM "orders";

-- 4) Numeração recomeça do 1 (PED-2026-000001 / ORC-2026-000001)
DELETE FROM "number_sequences";
