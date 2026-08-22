CREATE TABLE "TrialBenefitClaim" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "emailFingerprint" CHAR(64),
    "ipFingerprint" CHAR(64),
    "deviceFingerprint" CHAR(64),
    "rucFingerprint" CHAR(64),
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rucConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrialBenefitClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialBenefitClaim_tenantId_key" ON "TrialBenefitClaim"("tenantId");
CREATE UNIQUE INDEX "TrialBenefitClaim_rucFingerprint_key" ON "TrialBenefitClaim"("rucFingerprint");
CREATE INDEX "TrialBenefitClaim_emailFingerprint_idx" ON "TrialBenefitClaim"("emailFingerprint");
CREATE INDEX "TrialBenefitClaim_deviceFingerprint_idx" ON "TrialBenefitClaim"("deviceFingerprint");

ALTER TABLE "TrialBenefitClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrialBenefitClaim" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TrialBenefitClaim_tenant_isolation_policy"
    ON "TrialBenefitClaim" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TrialBenefitClaim" TO "tienda_tenant_app";

INSERT INTO "TrialBenefitClaim" (
    "tenantId", "emailFingerprint", "ipFingerprint", "deviceFingerprint", "claimedAt"
)
SELECT
    "provisionedTenantId",
    "signupEmailFingerprint",
    "signupIpFingerprint",
    "signupDeviceFingerprint",
    COALESCE("consumedAt", "createdAt")
FROM "OwnerRegistration"
WHERE "provisionedTenantId" IS NOT NULL
  AND "consumedAt" IS NOT NULL
ON CONFLICT ("tenantId") DO NOTHING;

ALTER TYPE "SignupAbuseReason" ADD VALUE IF NOT EXISTS 'RUC_TRIAL_LIMIT';
ALTER TABLE "SignupAbuseEvent" ADD COLUMN "rucFingerprint" CHAR(64);
CREATE INDEX "SignupAbuseEvent_rucFingerprint_idx" ON "SignupAbuseEvent"("rucFingerprint");
