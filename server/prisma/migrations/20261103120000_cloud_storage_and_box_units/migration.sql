-- DropIndex
DROP INDEX "order_items_orderId_productId_key";

-- DropIndex
DROP INDEX "quote_items_quoteId_productId_key";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "saleUnit" TEXT NOT NULL DEFAULT 'UN',
ADD COLUMN     "unitsPerSaleUnit" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "unitsPerBox" INTEGER;

-- AlterTable
ALTER TABLE "quote_items" ADD COLUMN     "saleUnit" TEXT NOT NULL DEFAULT 'UN',
ADD COLUMN     "unitsPerSaleUnit" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "area" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_fileName_key" ON "stored_files"("fileName");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_productId_saleUnit_key" ON "order_items"("orderId", "productId", "saleUnit");

-- CreateIndex
CREATE UNIQUE INDEX "quote_items_quoteId_productId_saleUnit_key" ON "quote_items"("quoteId", "productId", "saleUnit");


-- Regras de integridade das unidades de venda
ALTER TABLE "products" ADD CONSTRAINT "products_units_per_box_pos" CHECK ("unitsPerBox" IS NULL OR "unitsPerBox" >= 2);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sale_unit_valid" CHECK ("saleUnit" IN ('UN', 'CX') AND "unitsPerSaleUnit" >= 1);
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_sale_unit_valid" CHECK ("saleUnit" IN ('UN', 'CX') AND "unitsPerSaleUnit" >= 1);
