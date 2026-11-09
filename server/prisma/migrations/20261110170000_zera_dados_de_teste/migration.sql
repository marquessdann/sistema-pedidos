-- Início do uso real (pedido do Daniel): apaga TODOS os pedidos e orçamentos de teste
-- e todos os clientes, exceto o cliente de teste (a própria Della, CNPJ 57.534.374/0001-04).
-- Produtos, marcas, usuários, vendedores, configurações e entradas de estoque das notas são mantidos.
-- Roda uma única vez (migração).

-- 1) PDFs gerados de pedidos/orçamentos
DELETE FROM "stored_files" f USING "generated_documents" g WHERE f."fileName" = g."fileName";
DELETE FROM "generated_documents";

-- 2) Movimentações de estoque ligadas a pedidos (reservas e baixas de teste)
DELETE FROM "stock_movements" WHERE "orderId" IS NOT NULL;

-- 3) Pedidos e orçamentos (itens, históricos e aprovações saem em cascata)
--    (ordem: solta o vínculo pedido→orçamento, apaga orçamentos e depois pedidos)
DELETE FROM "discount_approvals";
UPDATE "orders" SET "quoteId" = NULL WHERE "quoteId" IS NOT NULL;
DELETE FROM "quotes";
DELETE FROM "orders";

-- 4) Numeração recomeça do 1 (PED-2026-000001 / ORC-2026-000001)
DELETE FROM "number_sequences";

-- 5) Clientes: fica só o cliente de teste
DELETE FROM "clients" WHERE "cnpj" <> '57534374000104';

-- 6) Estoque recalculado só com as entradas/ajustes que sobraram (sem reservas de teste)
UPDATE "products" p
   SET "reservedQty" = 0,
       "stockQty" = COALESCE((SELECT SUM(m."quantity") FROM "stock_movements" m
                              WHERE m."productId" = p."id" AND m."type" IN ('IN', 'ADJUST', 'OUT', 'RETURN')), 0),
       "updatedAt" = now();
