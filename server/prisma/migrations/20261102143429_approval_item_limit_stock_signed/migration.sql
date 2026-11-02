-- AlterTable
ALTER TABLE "discount_approvals" ADD COLUMN     "maxItemDiscountBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_qty_pos";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_nonzero" CHECK ("quantity" <> 0);
