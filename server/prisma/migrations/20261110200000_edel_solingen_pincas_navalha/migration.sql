-- Pedido do Daniel: desativa a Hidramais e cadastra Navalha + Pinças (Edel Solingen).
-- Venda por unidade, preço de TESTE R$ 1,00, sem foto e sem estoque (quantidade e imagens o Daniel lança depois).

-- 1) Hidramais desativada (marca e produtos) — nada é apagado
UPDATE "products" p SET "active" = false, "updatedAt" = now()
  FROM "brands" b WHERE b."id" = p."brandId" AND b."name" = 'Hidramais' AND p."active" = true;
UPDATE "brands" SET "active" = false, "updatedAt" = now() WHERE "name" = 'Hidramais';

-- 2) Marca e categorias
INSERT INTO "brands" ("id", "name", "active", "sortOrder", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Edel Solingen', true, 14, now(), now())
ON CONFLICT ("name") DO UPDATE SET "active" = true, "updatedAt" = now();

INSERT INTO "categories" ("id", "name", "active", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'Pinças Inox', true, now(), now()),
  (gen_random_uuid(), 'Pinças Laqueadas', true, now(), now()),
  (gen_random_uuid(), 'Pinças Douradas', true, now(), now()),
  (gen_random_uuid(), 'Navalhas', true, now(), now())
ON CONFLICT ("name") DO UPDATE SET "active" = true, "updatedAt" = now();

-- 3) Produtos (vendidos por unidade)
INSERT INTO "products" ("id", "sku", "name", "brandId", "categoryId", "description", "unit", "unitsPerBox", "boxOnly",
                        "costCents", "taxRefBps", "priceCents", "stockQty", "reservedQty", "active", "internalNotes", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.sku, v.name, b."id", c."id", v.descr, 'UN', NULL, false, 0, 0, 100, 0, 0, true,
       'PREÇO DE TESTE (R$ 1,00). Definir o preço real, colocar a foto e dar entrada no estoque.', now(), now()
  FROM (VALUES
    ('PIN-001', 'Pinça Inox - Ponta Fina',      'Pinças Inox',      'Pinça em aço inox • Ponta fina de precisão'),
    ('PIN-002', 'Pinça Inox - Ponta Reta',      'Pinças Inox',      'Pinça em aço inox • Ponta reta'),
    ('PIN-003', 'Pinça Inox - Ponta Oblíqua',   'Pinças Inox',      'Pinça em aço inox • Ponta oblíqua (chanfrada)'),
    ('PIN-004', 'Pinça Laqueada - Ponta Fina',  'Pinças Laqueadas', 'Pinça laqueada • Ponta fina de precisão'),
    ('PIN-005', 'Pinça Laqueada - Ponta Reta',  'Pinças Laqueadas', 'Pinça laqueada • Ponta reta'),
    ('PIN-006', 'Pinça Laqueada - Ponta Oblíqua','Pinças Laqueadas','Pinça laqueada • Ponta oblíqua (chanfrada)'),
    ('PIN-007', 'Pinça Dourada - Ponta Fina',   'Pinças Douradas',  'Pinça com ponta dourada • Ponta fina de precisão'),
    ('PIN-008', 'Pinça Dourada - Ponta Reta',   'Pinças Douradas',  'Pinça com ponta dourada • Ponta reta'),
    ('PIN-009', 'Pinça Dourada - Ponta Oblíqua','Pinças Douradas',  'Pinça com ponta dourada • Ponta oblíqua (chanfrada)'),
    ('NAV-010', 'Navalha Aço Standard',         'Navalhas',         'Navalha em aço • Edel Solingen')
  ) AS v(sku, name, cat, descr)
  JOIN "brands" b ON b."name" = 'Edel Solingen'
  JOIN "categories" c ON c."name" = v.cat
ON CONFLICT ("sku") DO NOTHING;
