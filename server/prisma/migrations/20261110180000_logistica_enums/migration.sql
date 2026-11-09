-- Logística: novo perfil de usuário e novo status "Recebido na logística"
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LOGISTICS';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'LOGISTICS_RECEIVED' AFTER 'AWAITING_PICKING';
