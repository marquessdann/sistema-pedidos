-- Novos status no andamento do pedido: Faturado e Em rota de entrega
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INVOICED' BEFORE 'SHIPPED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'OUT_FOR_DELIVERY' AFTER 'SHIPPED';

-- Gestor pode atualizar o andamento por padrão
ALTER TABLE "manager_profiles" ALTER COLUMN "canUpdateOrderStatus" SET DEFAULT true;
