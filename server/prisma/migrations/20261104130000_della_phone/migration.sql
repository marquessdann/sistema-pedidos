-- Telefone da Della: (41) 99679-0904 no lugar de (41) 99984-6920.
-- Só altera onde ainda estiver o número antigo (não sobrescreve edições feitas no painel).
UPDATE "company_settings" SET "phone" = '41996790904', "updatedAt" = now() WHERE "phone" = '41999846920';
UPDATE "clients" SET "commercialPhone" = '41996790904', "updatedAt" = now() WHERE "commercialPhone" = '41999846920';
UPDATE "clients" SET "financePhone" = '41996790904', "updatedAt" = now() WHERE "financePhone" = '41999846920';
