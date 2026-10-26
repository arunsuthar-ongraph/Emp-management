-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_planId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_tenantId_fkey";

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "gstin";

-- DropTable
DROP TABLE "Invoice";

-- DropTable
DROP TABLE "Plan";

-- DropTable
DROP TABLE "Subscription";

-- DropEnum
DROP TYPE "BillingCycle";

-- DropEnum
DROP TYPE "InvoiceStatus";

-- DropEnum
DROP TYPE "SubscriptionStatus";

