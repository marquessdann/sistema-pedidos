-- 1) Ruby Kisses é linha da Kiss New York: os lápis passam para a marca Kiss New York e a marca separada é inativada.
UPDATE "products" p
   SET "brandId" = k."id",
       "description" = CASE WHEN p."description" LIKE 'Linha Ruby Kisses%' THEN p."description" ELSE 'Linha Ruby Kisses • ' || COALESCE(p."description", '') END,
       "updatedAt" = now()
  FROM "brands" r, "brands" k
 WHERE r."name" = 'Ruby Kisses' AND k."name" = 'Kiss New York' AND p."brandId" = r."id";
UPDATE "brands" SET "active" = false, "updatedAt" = now()
 WHERE "name" = 'Ruby Kisses' AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."brandId" = "brands"."id");

-- 2) Títulos padronizados: "Tipo do produto - Modelo/Cor Tamanho" (a marca aparece à parte no catálogo).
UPDATE "products" p SET "name" = v.name, "updatedAt" = now()
  FROM (VALUES
    ('HID-AMEIXA-500',                      'Loção Desodorante - Ameixa Negra 500ml'),
    ('HID-COLAGENO-500',                    'Loção Desodorante - Colágeno e Vitamina E 500ml'),
    ('HID-ROSA-500',                        'Loção Desodorante - Rosa Mosqueta 500ml'),
    ('HID-MILK-500',                        'Loção Desodorante - Milk+ 500ml'),
    ('HID-BEBE-500',                        'Loção Desodorante - Perfume de Bebê 500ml'),
    ('HID-BEBE-REFIL-400',                  'Sabonete Líquido Refil - Perfume de Bebê 400ml'),
    ('HID-DRENAGEM-1KG',                    'Creme para Massagem - Drenagem Linfática 1kg'),
    ('HID-MASSAGEM-NEUTRO-1KG',             'Creme para Massagem - Neutro 1kg'),
    ('RSV-OLEO-ROSA-100',                   'Óleo Corporal - Rosa Mosqueta Clareador 100ml'),
    ('RSV-ACIDO-CLAREADOR-100',             'Ácido Clareador - Ativado 100ml'),
    ('RSV-DESODORANTE-85',                  'Desodorante Roll-on - Clareador 85ml'),
    ('KISS-BODY-SPLASH-LADY-RED-200',       'Body Splash - Lady in Red 200ml'),
    ('KISS-BODY-SPLASH-DARK-KISS-200',      'Body Splash - Dark Kiss 200ml'),
    ('KISS-BODY-SPLASH-VANILLA-200',        'Body Splash - Vanilla Passion 200ml'),
    ('KISS-BODY-SPLASH-SILVER-QUEEN-250',   'Body Splash Shimmer - Silver Queen 250ml'),
    ('KISS-BODY-SPLASH-BLUSH-PRINCESS-250', 'Body Splash Shimmer - Blush Princess 250ml'),
    ('KISS-BODY-SPLASH-BRONZE-GODDESS-250', 'Body Splash Shimmer - Bronze Goddess 250ml'),
    ('KISS-TONALIZANTE-CAST-ESC',           'Shampoo Tonalizante - Castanho Escuro (3 unidades)'),
    ('KISS-TONALIZANTE-CAST-MED',           'Shampoo Tonalizante - Castanho Médio (3 unidades)'),
    ('KISS-TONALIZANTE-LOIRO-ESC',          'Shampoo Tonalizante - Loiro Escuro (3 unidades)'),
    ('RK-LAPIS-LABIAL-PALE-NUDE',           'Lápis Contorno Labial - Pale Nude'),
    ('RK-LAPIS-LABIAL-NUDE-ROSE',           'Lápis Contorno Labial - Nude Rose'),
    ('RK-LAPIS-LABIAL-MARSALA',             'Lápis Contorno Labial - Marsala'),
    ('RK-LAPIS-LABIAL-RED',                 'Lápis Contorno Labial - Red'),
    ('RK-LAPIS-LABIAL-DEEP-RED',            'Lápis Contorno Labial - Deep Red'),
    ('RK-LAPIS-LABIAL-MAUVE',               'Lápis Contorno Labial - Mauve')
  ) AS v(sku, name)
 WHERE p."sku" = v.sku;

-- detalhes que saíram do título continuam na descrição
UPDATE "products" SET "description" = 'Blooming Collection • ' || "description", "updatedAt" = now()
 WHERE "sku" = 'KISS-BODY-SPLASH-VANILLA-200' AND "description" NOT LIKE '%Blooming Collection%';
UPDATE "products" SET "description" = 'Loção desodorante corporal aveludada • Colágeno vegetal', "updatedAt" = now()
 WHERE "sku" = 'HID-MILK-500' AND ("description" IS NULL OR "description" = 'Aveludada');
