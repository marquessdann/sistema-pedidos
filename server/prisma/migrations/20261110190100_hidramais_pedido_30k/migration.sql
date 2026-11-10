-- Hidramais – pedido de compra "Pedido 30k" (aba PEDIDO da planilha):
-- SKU por tipo (LOC/CRE/ILM/OLE/SAB/MASC) + sequência + código do fabricante; descrição = grupo da planilha;
-- venda somente por caixa; entrada de estoque com as quantidades do pedido.
-- Produtos que já existiam mantêm nome, foto e preço. Novos: sem foto, R$ 1,00 (teste), ativos.
-- Também liga o controle de estoque: reserva na confirmação e bloqueio de venda sem saldo.

CREATE TEMP TABLE hid_30k (sku text, old_sku text, name text, descr text, box int, qty int);
INSERT INTO hid_30k VALUES
  ('LOC-001-10829', NULL, 'Loção Desodorante - Algodão e Ômega 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-002-11073', NULL, 'Loção Desodorante - Ameixa Dourada 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-003-10723', 'HID-AMEIXA-500', 'Loção Desodorante - Ameixa Negra 500ml', 'Loções 500 ml', 12, 192),
  ('LOC-004-10000', NULL, 'Loção Desodorante - Amêndoas 500ml', 'Loções 500 ml', 12, 12),
  ('LOC-005-10001', NULL, 'Loção Desodorante - Aveia 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-006-11011', NULL, 'Loção Desodorante - Cereja e Avelã 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-007-10003', 'HID-COLAGENO-500', 'Loção Desodorante - Colágeno e Vitamina E 500ml', 'Loções 500 ml', 12, 180),
  ('LOC-008-10230', NULL, 'Loção Desodorante - Erva Doce e Camomila 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-009-10911', NULL, 'Loção Desodorante - Flor de Laranjeira 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-010-10004', NULL, 'Loção Desodorante - Frutas Vermelhas 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-011-10603', NULL, 'Loção Desodorante - Goji Berry 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-012-11078', 'HID-MILK-500', 'Loção Desodorante - Milk+ 500ml', 'Loções 500 ml', 12, 168),
  ('LOC-013-11077', NULL, 'Loção Desodorante - Noite Serena 500ml', 'Loções 500 ml', 12, 24),
  ('LOC-014-10007', 'HID-BEBE-500', 'Loção Desodorante - Perfume de Bebê 500ml', 'Loções 500 ml', 12, 192),
  ('LOC-015-10936', 'HID-ROSA-500', 'Loção Desodorante - Rosa Mosqueta 500ml', 'Loções 500 ml', 12, 144),
  ('CRE-016-10975', NULL, 'Creme Desodorante - Prevenção de Estrias 200ml', 'Loções especiais 200 ml', 6, 18),
  ('ILM-017-11070', NULL, 'Iluminador Multifuncional - 260ml', 'Autocuidado multifuncional', 6, 18),
  ('ILM-018-11105', NULL, 'Iluminador Multifuncional - Bronze 260ml', 'Autocuidado multifuncional', 6, 12),
  ('OLE-019-10724', NULL, 'Óleo Desodorante - Ameixa Negra 120ml', 'Óleos corporais 120 ml', 12, 24),
  ('OLE-020-10624', NULL, 'Óleo Desodorante - Semente de Uva e Colágeno 120ml', 'Óleos corporais 120 ml', 12, 24),
  ('SAB-021-10725', NULL, 'Sabonete Líquido - Ameixa Negra 500ml', 'Sabonetes 500 ml', 12, 24),
  ('SAB-022-10026', NULL, 'Sabonete Líquido - Perfume de Bebê 500ml', 'Sabonetes 500 ml', 12, 24),
  ('SAB-023-10910', 'HID-BEBE-REFIL-400', 'Sabonete Líquido Refil - Perfume de Bebê 400ml', 'Sabonetes 400 ml', 12, 180),
  ('MASC-024-10925', NULL, 'Máscara Peel-off - Ácido Hialurônico 8g', 'Facial 8 g', 100, 100),
  ('MASC-025-10924', NULL, 'Máscara Peel-off - Argila Dourada 8g', 'Facial 8 g', 100, 100),
  ('CRE-026-10277', 'HID-DRENAGEM-1KG', 'Creme para Massagem - Drenagem Linfática 1kg', 'Massagem profissional 1 kg', 6, 48),
  ('CRE-027-10275', 'HID-MASSAGEM-NEUTRO-1KG', 'Creme para Massagem - Neutro 1kg', 'Massagem profissional 1 kg', 6, 42);

INSERT INTO "brands" ("id", "name", "active", "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Hidramais', true, 10, now(), now())
ON CONFLICT ("name") DO NOTHING;

-- 1) produtos que já existiam: novo SKU, descrição (grupo), caixa e só por caixa
UPDATE "products" p
   SET "sku" = h.sku, "description" = h.descr, "unitsPerBox" = h.box, "boxOnly" = true, "updatedAt" = now()
  FROM hid_30k h
 WHERE h.old_sku IS NOT NULL AND p."sku" = h.old_sku
   AND NOT EXISTS (SELECT 1 FROM "products" x WHERE x."sku" = h.sku);

-- 2) produtos novos
INSERT INTO "products" ("id", "sku", "name", "brandId", "description", "unit", "unitsPerBox", "boxOnly", "costCents", "taxRefBps",
                        "priceCents", "stockQty", "reservedQty", "active", "internalNotes", "createdAt", "updatedAt")
SELECT gen_random_uuid(), h.sku, h.name, b."id", h.descr, 'UN', h.box, true, 0, 0, 100, 0, 0, true,
       'PREÇO DE TESTE (R$ 1,00). Definir o preço real e colocar a foto.', now(), now()
  FROM hid_30k h CROSS JOIN "brands" b
 WHERE b."name" = 'Hidramais'
ON CONFLICT ("sku") DO NOTHING;

-- 3) entrada de estoque (uma única vez por produto)
WITH alvo AS (
  SELECT p."id", h.qty, p."stockQty", p."reservedQty"
    FROM hid_30k h JOIN "products" p ON p."sku" = h.sku
   WHERE NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."dedupeKey" = 'entrada-hidramais-30k:' || p."id")
), mov AS (
  INSERT INTO "stock_movements" ("id", "productId", "type", "quantity", "stockAfter", "reservedAfter", "reason", "dedupeKey", "userId", "createdAt")
  SELECT gen_random_uuid(), a."id", 'IN', a.qty, a."stockQty" + a.qty, a."reservedQty",
         'Entrada do Pedido Hidramais 30k', 'entrada-hidramais-30k:' || a."id",
         (SELECT u."id" FROM "users" u WHERE u."role" = 'ADMIN' ORDER BY u."createdAt" LIMIT 1), now()
    FROM alvo a
   WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."role" = 'ADMIN')
  RETURNING "productId", "quantity"
)
UPDATE "products" p SET "stockQty" = p."stockQty" + mov."quantity", "updatedAt" = now()
  FROM mov WHERE p."id" = mov."productId";

-- 4) controle de estoque ligado: reserva na confirmação do pedido e bloqueio sem saldo
UPDATE "company_settings" SET "stockEnabled" = true, "stockPolicy" = 'ON_CONFIRM', "blockOnInsufficientStock" = true, "updatedAt" = now();

DROP TABLE hid_30k;
