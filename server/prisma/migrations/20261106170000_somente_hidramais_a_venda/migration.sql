-- Somente Hidramais à venda para o Victor: inativa as outras MARCAS (some do catálogo e dos filtros)
-- e garante que os produtos delas também estejam inativos. Nada é apagado; reative em Marcas/Produtos.
UPDATE "brands" SET "active" = false, "updatedAt" = now()
 WHERE "name" <> 'Hidramais' AND "active" = true;

UPDATE "products" p
   SET "active" = false, "updatedAt" = now()
  FROM "brands" b
 WHERE b."id" = p."brandId" AND b."name" <> 'Hidramais' AND p."active" = true;

UPDATE "brands" SET "active" = true, "updatedAt" = now() WHERE "name" = 'Hidramais';
