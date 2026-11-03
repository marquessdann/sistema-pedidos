-- Análise do cadastro de clientes enviado pelo vendedor (pendência cadastral)
ALTER TABLE "clients" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "clients" ADD COLUMN "reviewedById" UUID;
ALTER TABLE "clients" ADD COLUMN "reviewedAt" TIMESTAMP(3);
CREATE INDEX "clients_status_pending_idx" ON "clients" ("status") WHERE "status" IN ('UNDER_REVIEW', 'PENDING_REGISTRATION');
