-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGER';

-- CreateTable
CREATE TABLE "manager_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "canViewSales" BOOLEAN NOT NULL DEFAULT true,
    "canViewCommissions" BOOLEAN NOT NULL DEFAULT true,
    "canReleaseProducts" BOOLEAN NOT NULL DEFAULT true,
    "canReleaseClients" BOOLEAN NOT NULL DEFAULT true,
    "canApproveDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "canUpdateOrderStatus" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_reps" (
    "managerId" UUID NOT NULL,
    "salesRepId" UUID NOT NULL,

    CONSTRAINT "manager_reps_pkey" PRIMARY KEY ("managerId","salesRepId")
);

-- CreateIndex
CREATE UNIQUE INDEX "manager_profiles_userId_key" ON "manager_profiles"("userId");

-- AddForeignKey
ALTER TABLE "manager_profiles" ADD CONSTRAINT "manager_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_reps" ADD CONSTRAINT "manager_reps_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "manager_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_reps" ADD CONSTRAINT "manager_reps_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "sales_representatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

