-- Reserva de estoque na confirmação do pedido + produto vendido só por caixa
ALTER TYPE "StockPolicy" ADD VALUE IF NOT EXISTS 'ON_CONFIRM' BEFORE 'ON_APPROVAL';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "boxOnly" BOOLEAN NOT NULL DEFAULT false;
