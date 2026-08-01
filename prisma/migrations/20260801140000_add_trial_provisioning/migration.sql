CREATE TYPE "TenantKind" AS ENUM ('TRIAL', 'CUSTOMER', 'INTERNAL');

ALTER TABLE "Tenant"
ADD COLUMN "kind" "TenantKind" NOT NULL DEFAULT 'CUSTOMER';

UPDATE "Tenant"
SET "kind" = 'TRIAL'
WHERE "status" = 'TRIAL';

ALTER TABLE "Tenant"
ADD CONSTRAINT "Tenant_trial_kind_check"
CHECK ("status" <> 'TRIAL' OR "kind" = 'TRIAL');

ALTER TABLE "OwnerRegistration"
ADD COLUMN "provisionedTenantId" UUID,
ADD COLUMN "provisionedUserId" INTEGER;

CREATE UNIQUE INDEX "OwnerRegistration_provisionedTenantId_key"
ON "OwnerRegistration"("provisionedTenantId");

CREATE UNIQUE INDEX "OwnerRegistration_provisionedUserId_key"
ON "OwnerRegistration"("provisionedUserId");

ALTER TABLE "OwnerRegistration"
ADD CONSTRAINT "OwnerRegistration_provisionedTenantId_fkey"
FOREIGN KEY ("provisionedTenantId") REFERENCES "Tenant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OwnerRegistration"
ADD CONSTRAINT "OwnerRegistration_provisionedUserId_fkey"
FOREIGN KEY ("provisionedUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
