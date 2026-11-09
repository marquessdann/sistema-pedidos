-- Códigos (SKU) iguais aos do controle de estoque da Della + entrada das notas
-- (Kiss NF 41.212: 12 unidades de cada; Rosa Selvagem: Óleo 60, Ácido 48, Desodorante 96).

-- 1) Novos SKUs
UPDATE "products" p SET "sku" = v.novo, "updatedAt" = now()
  FROM (VALUES
    ('KISS-TONALIZANTE-CAST-ESC',           'SHM-001-CCS02BB'),
    ('KISS-TONALIZANTE-CAST-MED',           'SHM-002-CCS04BB'),
    ('KISS-TONALIZANTE-LOIRO-ESC',          'SHM-003-CCS07BB'),
    ('KISS-BODY-SPLASH-LADY-RED-200',       'BDS-004-BS01B'),
    ('KISS-BODY-SPLASH-DARK-KISS-200',      'BDS-005-BS07B'),
    ('KISS-BODY-SPLASH-VANILLA-200',        'BDS-006-BS09B'),
    ('KISS-BODY-SPLASH-SILVER-QUEEN-250',   'BDS-007-BSS01BB'),
    ('KISS-BODY-SPLASH-BLUSH-PRINCESS-250', 'BDS-008-BSS02BB'),
    ('KISS-BODY-SPLASH-BRONZE-GODDESS-250', 'BDS-009-BSS03BB'),
    ('RK-LAPIS-LABIAL-PALE-NUDE',           'ULE-010-RMLP01BB'),
    ('RK-LAPIS-LABIAL-NUDE-ROSE',           'ULE-012-RMLP03BB'),
    ('RK-LAPIS-LABIAL-MARSALA',             'ULE-013-RMLP04BB'),
    ('RK-LAPIS-LABIAL-RED',                 'ULE-014-RMLP05BB'),
    ('RK-LAPIS-LABIAL-DEEP-RED',            'ULE-015-RMLP06BB'),
    ('RK-LAPIS-LABIAL-MAUVE',               'ULE-016-RMLP14BB'),
    ('RSV-OLEO-ROSA-100',                   'RSS-001-14345'),
    ('RSV-ACIDO-CLAREADOR-100',             'RSS-002-14429'),
    ('RSV-DESODORANTE-85',                  'RSS-003-14717')
  ) AS v(antigo, novo)
 WHERE p."sku" = v.antigo
   AND NOT EXISTS (SELECT 1 FROM "products" x WHERE x."sku" = v.novo);

-- 2) Lápis Nude (estava na nota e no controle de estoque, faltava no sistema) — sem foto por enquanto
INSERT INTO "products" ("id", "sku", "name", "brandId", "description", "unit", "costCents", "taxRefBps", "priceCents",
                        "stockQty", "reservedQty", "active", "internalNotes", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'ULE-011-RMLP02BB', 'Lápis Contorno Labial - Nude', b."id",
       'Linha Ruby Kisses • Lip Liner Ultra Easy • Cor Nude • Com apontador na tampa',
       'UN', 0, 0, 100, 0, 0, true,
       'PREÇO DE TESTE (R$ 1,00). Definir o preço real após a reunião com o contador. Falta a foto.', now(), now()
  FROM "brands" b WHERE b."name" = 'Kiss New York'
ON CONFLICT ("sku") DO NOTHING;

-- 3) Entrada das notas (movimentação de estoque, uma única vez por produto)
WITH entrada(sku, qtd, nota) AS (VALUES
    ('SHM-001-CCS02BB', 12, 'NF 41.212 (Kiss)'), ('SHM-002-CCS04BB', 12, 'NF 41.212 (Kiss)'), ('SHM-003-CCS07BB', 12, 'NF 41.212 (Kiss)'),
    ('BDS-004-BS01B',   12, 'NF 41.212 (Kiss)'), ('BDS-005-BS07B',   12, 'NF 41.212 (Kiss)'), ('BDS-006-BS09B',   12, 'NF 41.212 (Kiss)'),
    ('BDS-007-BSS01BB', 12, 'NF 41.212 (Kiss)'), ('BDS-008-BSS02BB', 12, 'NF 41.212 (Kiss)'), ('BDS-009-BSS03BB', 12, 'NF 41.212 (Kiss)'),
    ('ULE-010-RMLP01BB',12, 'NF 41.212 (Kiss)'), ('ULE-011-RMLP02BB',12, 'NF 41.212 (Kiss)'), ('ULE-012-RMLP03BB',12, 'NF 41.212 (Kiss)'),
    ('ULE-013-RMLP04BB',12, 'NF 41.212 (Kiss)'), ('ULE-014-RMLP05BB',12, 'NF 41.212 (Kiss)'), ('ULE-015-RMLP06BB',12, 'NF 41.212 (Kiss)'),
    ('ULE-016-RMLP14BB',12, 'NF 41.212 (Kiss)'),
    ('RSS-001-14345',   60, 'Nota Rosa Selvagem'), ('RSS-002-14429', 48, 'Nota Rosa Selvagem'), ('RSS-003-14717', 96, 'Nota Rosa Selvagem')
), alvo AS (
  SELECT p."id", e.qtd, e.nota, p."stockQty", p."reservedQty"
    FROM entrada e JOIN "products" p ON p."sku" = e.sku
   WHERE NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."dedupeKey" = 'entrada-inicial:' || p."id")
), mov AS (
  INSERT INTO "stock_movements" ("id", "productId", "type", "quantity", "stockAfter", "reservedAfter", "reason", "dedupeKey", "userId", "createdAt")
  SELECT gen_random_uuid(), a."id", 'IN', a.qtd, a."stockQty" + a.qtd, a."reservedQty",
         'Entrada da ' || a.nota, 'entrada-inicial:' || a."id",
         (SELECT u."id" FROM "users" u WHERE u."role" = 'ADMIN' ORDER BY u."createdAt" LIMIT 1), now()
    FROM alvo a
   WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."role" = 'ADMIN')
  RETURNING "productId", "quantity"
)
UPDATE "products" p SET "stockQty" = p."stockQty" + mov."quantity", "updatedAt" = now()
  FROM mov WHERE p."id" = mov."productId";
