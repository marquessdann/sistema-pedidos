-- Produtos de DEMONSTRAÇÃO (baseados na NF-e 18967) para apresentar o processo de pedido.
-- São cópias separadas, com código "DEMO-" e "(DEMO)" no nome, já ativas e com preço fictício.
-- Os produtos reais da nota não são alterados. Para retirar: inative ou edite estes 5 produtos no painel.
INSERT INTO "products" ("id", "sku", "name", "brandId", "categoryId", "description", "unit", "unitsPerBox", "costCents", "taxRefBps",
                        "priceCents", "stockQty", "reservedQty", "active", "internalNotes", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.sku, v.name, b."id", c."id", v.descr, 'UN', v.ubox, v.cost, 0, v.price, 0, 0, true,
       'Produto de DEMONSTRAÇÃO (preço fictício) para apresentar o sistema. Pode ser inativado a qualquer momento.',
       now(), now()
  FROM (VALUES
    ('DEMO-CA054', 'Pomada Efeito Matte Toque Seco Carmesim 50g (DEMO)', 'Carmesim', 'Cabelo', 12, 192, 490,
     'Pomada de efeito matte e toque seco, fixação média.'),
    ('DEMO-MI072', 'Pomada Estilizadora 3 em 1 Capilar Mirras 150g (DEMO)', 'Mirras', 'Cabelo', 12, 301, 790,
     'Modela, fixa e dá brilho. Pote de 150 g.'),
    ('DEMO-LE001', 'Gel Brilho Molhado Extra Forte Letrinhas 235g (DEMO)', 'Letrinhas', 'Cabelo', 12, 119, 299,
     'Gel de efeito molhado com fixação extra forte.'),
    ('DEMO-CA076', 'Cera Modeladora Extra Forte Carmesim 80g (DEMO)', 'Carmesim', 'Cabelo', 24, 160, 399,
     'Cera de fixação extra forte. Caixa com 24 unidades.'),
    ('DEMO-CA052', 'Óleo para Barba Carmesim 30ml (DEMO)', 'Carmesim', 'Barba', 12, 393, 990,
     'Hidrata e perfuma a barba. Frasco de 30 ml.')
  ) AS v(sku, name, brand, cat, ubox, cost, price, descr)
  JOIN "brands" b ON b."name" = v.brand
  JOIN "categories" c ON c."name" = v.cat
ON CONFLICT ("sku") DO NOTHING;
