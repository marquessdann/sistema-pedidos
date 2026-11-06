-- Pedido do Daniel: por enquanto só os produtos Hidramais ficam à venda.
-- Os demais (produtos da NF-e 18967 e os de demonstração) são INATIVADOS — nada é apagado;
-- para voltar a vender, basta ativar o produto em Produtos.
UPDATE "products" p
   SET "active" = false, "updatedAt" = now()
  FROM "brands" b
 WHERE b."id" = p."brandId" AND b."name" <> 'Hidramais' AND p."active" = true;
