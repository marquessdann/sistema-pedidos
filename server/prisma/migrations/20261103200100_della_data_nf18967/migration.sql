-- Dados iniciais da Della (aplicados uma única vez, sem sobrescrever o que já foi configurado)

-- 1) Caminhos dos novos status (o administrador pode ajustar em Configurações → Fluxo de status).
--    Só em instalações que já têm fluxo configurado; numa instalação nova o seed cria o fluxo padrão completo.
INSERT INTO "order_status_transitions" ("id", "fromStatus", "toStatus")
SELECT gen_random_uuid(), t.f::"OrderStatus", t.t::"OrderStatus"
  FROM (VALUES
    ('AWAITING_SHIPMENT', 'INVOICED'),
    ('APPROVED', 'INVOICED'),
    ('PICKING', 'INVOICED'),
    ('INVOICED', 'SHIPPED'),
    ('INVOICED', 'OUT_FOR_DELIVERY'),
    ('INVOICED', 'DELIVERED'),
    ('INVOICED', 'CANCELLED'),
    ('SHIPPED', 'OUT_FOR_DELIVERY'),
    ('OUT_FOR_DELIVERY', 'DELIVERED')
  ) AS t(f, t)
 WHERE EXISTS (SELECT 1 FROM "order_status_transitions")
ON CONFLICT ("fromStatus", "toStatus") DO NOTHING;

-- 2) Gestores (Vinicius) podem atualizar o andamento dos pedidos
UPDATE "manager_profiles" SET "canUpdateOrderStatus" = true, "updatedAt" = now();

-- 3) Endereço da empresa (NF-e 18967) e do cliente de teste
UPDATE "company_settings"
   SET "address" = 'Rua Assis Figueiredo, 59 – Parolin – Curitiba/PR – CEP 80630-280', "updatedAt" = now()
 WHERE "address" IS NULL OR "address" = '';
UPDATE "clients"
   SET "street" = 'Rua Assis Figueiredo', "number" = '59', "district" = 'Parolin', "city" = 'Curitiba', "state" = 'PR',
       "cep" = '80630280', "updatedAt" = now()
 WHERE "cnpj" = '57534374000104' AND ("street" IS NULL OR "street" = '');

-- 4) Marcas, categorias e produtos da NF-e 18967 (BM Ind. Com. Distr. de Cosm. Ltda, 15/10/2026)
--    Custo por unidade = valor da caixa na NF ÷ unidades por caixa.
--    Preço de venda e tributos ficam em branco: o produto fica INATIVO até o administrador preencher o preço.
INSERT INTO "brands" ("id", "name", "active", "sortOrder", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'Carmesim', true, 1, now(), now()),
  (gen_random_uuid(), 'Mirras', true, 2, now(), now()),
  (gen_random_uuid(), 'Letrinhas', true, 3, now(), now())
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "categories" ("id", "name", "active", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'Cabelo', true, now(), now()),
  (gen_random_uuid(), 'Barba', true, now(), now())
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "products" ("id", "sku", "name", "brandId", "categoryId", "unit", "unitsPerBox", "costCents", "taxRefBps",
                        "priceCents", "stockQty", "reservedQty", "active", "internalNotes", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.sku, v.name, b."id", c."id", 'UN', v.ubox, v.cost, 0, 0, 0, 0, false,
       'Custo da NF-e 18967 (BM, 15/10/2026): R$ ' || v.boxcost || ' por caixa com ' || v.ubox || ' un. Preencha o preço de venda para ativar.',
       now(), now()
  FROM (VALUES
    ('LE001', 'Gel Brilho Molhado Extra Forte Letrinhas 235g',            'Letrinhas', 'Cabelo', 12, 119, '14,24'),
    ('LE002', 'Gel Brilho Molhado Azul Extra Forte Letrinhas 235g',       'Letrinhas', 'Cabelo', 12, 119, '14,24'),
    ('LE003', 'Gel Brilho Molhado Verde Extra Forte Letrinhas 235g',      'Letrinhas', 'Cabelo', 12, 119, '14,24'),
    ('LE004', 'Gel Brilho Molhado Amarelo Extra Forte Letrinhas 235g',    'Letrinhas', 'Cabelo', 12, 119, '14,24'),
    ('MI072', 'Pomada Estilizadora 3 em 1 Capilar Mirras 150g',           'Mirras',    'Cabelo', 12, 301, '36,07'),
    ('MI071', 'Cera Fixadora Capilar Mirras 150g',                        'Mirras',    'Cabelo', 12, 301, '36,07'),
    ('MI073', 'Pomada Finalizadora Efeito Teia Capilar Mirras 150g',      'Mirras',    'Cabelo', 12, 301, '36,07'),
    ('MI108', 'Pomada em Pó Modeladora Fixadora Mirras 10g',              'Mirras',    'Cabelo', 12, 312, '37,49'),
    ('CA054', 'Pomada Efeito Matte Toque Seco Carmesim 50g',              'Carmesim',  'Cabelo', 12, 192, '23,02'),
    ('CA078', 'Pomada Estilizadora 3 em 1 Carmesim 80g',                  'Carmesim',  'Cabelo', 24, 160, '38,44'),
    ('CA075', 'Pasta Finalizadora Efeito Teia Carmesim 80g',              'Carmesim',  'Cabelo', 24, 160, '38,44'),
    ('CA092', 'Pasta Modeladora Efeito Cola Carmesim 80g',                'Carmesim',  'Cabelo', 24, 160, '38,44'),
    ('CA076', 'Cera Modeladora Extra Forte Carmesim 80g',                 'Carmesim',  'Cabelo', 24, 160, '38,44'),
    ('CA056', 'Pomada em Pó Fixadora Carmesim 10g',                       'Carmesim',  'Cabelo', 12, 312, '37,49'),
    ('CA049', 'Loção Pós-Barba Carmesim 170ml',                           'Carmesim',  'Barba',  12, 241, '28,95'),
    ('CA050', 'Shampoo para Barba Carmesim 170ml',                        'Carmesim',  'Barba',  12, 245, '29,42'),
    ('CA051', 'Condicionador para Barba Carmesim 170ml',                  'Carmesim',  'Barba',  12, 301, '36,07'),
    ('CA052', 'Óleo para Barba Carmesim 30ml',                            'Carmesim',  'Barba',  12, 393, '47,22'),
    ('CA053', 'Balm para Barba Carmesim 50g',                             'Carmesim',  'Barba',  12, 246, '29,52')
  ) AS v(sku, name, brand, cat, ubox, cost, boxcost)
  JOIN "brands" b ON b."name" = v.brand
  JOIN "categories" c ON c."name" = v.cat
ON CONFLICT ("sku") DO NOTHING;
