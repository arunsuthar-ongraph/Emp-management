-- Tenant subdomain + active flag
ALTER TABLE "Tenant" ADD COLUMN "slug" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Tenant" SET "slug" = trim(both '-' from left(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), 24)) || '-' || left("id", 4);
ALTER TABLE "Tenant" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- Email is unique per company, not globally
DROP INDEX "User_email_key";
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");
