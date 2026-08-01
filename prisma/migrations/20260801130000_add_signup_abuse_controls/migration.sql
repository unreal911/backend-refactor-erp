-- EMP-002: limites persistentes y auditoria antiabuso sin PII en claro.
CREATE TYPE "SignupRateLimitDimension" AS ENUM ('IP', 'EMAIL', 'DEVICE');
CREATE TYPE "SignupAbuseReason" AS ENUM (
    'CAPTCHA_FAILED',
    'CAPTCHA_UNAVAILABLE',
    'IP_RATE_LIMIT',
    'EMAIL_RATE_LIMIT',
    'DEVICE_RATE_LIMIT',
    'ACTIVE_TRIAL_LIMIT'
);
CREATE TYPE "SignupAbuseReviewStatus" AS ENUM (
    'UNREVIEWED',
    'FALSE_POSITIVE',
    'CONFIRMED_ABUSE'
);

ALTER TABLE "OwnerRegistration"
    ADD COLUMN "signupEmailFingerprint" CHAR(64),
    ADD COLUMN "signupIpFingerprint" CHAR(64),
    ADD COLUMN "signupDeviceFingerprint" CHAR(64);

CREATE INDEX "OwnerRegistration_signupEmailFingerprint_signupDeviceFingerprint_idx"
    ON "OwnerRegistration"("signupEmailFingerprint", "signupDeviceFingerprint");

CREATE TABLE "SignupRateLimitBucket" (
    "id" UUID NOT NULL,
    "dimension" "SignupRateLimitDimension" NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SignupRateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignupAbuseEvent" (
    "id" UUID NOT NULL,
    "reason" "SignupAbuseReason" NOT NULL,
    "aggregationKey" CHAR(64) NOT NULL,
    "emailFingerprint" CHAR(64) NOT NULL,
    "ipFingerprint" CHAR(64) NOT NULL,
    "deviceFingerprint" CHAR(64) NOT NULL,
    "captchaVerified" BOOLEAN NOT NULL DEFAULT false,
    "bucketStartedAt" TIMESTAMP(3) NOT NULL,
    "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "reviewStatus" "SignupAbuseReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewNote" VARCHAR(500),
    "reviewedAt" TIMESTAMP(3),
    "overrideUntil" TIMESTAMP(3),
    "reviewedByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SignupAbuseEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignupRateLimitBucket_dimension_fingerprint_windowStartedAt_key"
    ON "SignupRateLimitBucket"("dimension", "fingerprint", "windowStartedAt");
CREATE INDEX "SignupRateLimitBucket_windowEndsAt_idx"
    ON "SignupRateLimitBucket"("windowEndsAt");
CREATE UNIQUE INDEX "SignupAbuseEvent_reason_aggregationKey_bucketStartedAt_key"
    ON "SignupAbuseEvent"("reason", "aggregationKey", "bucketStartedAt");
CREATE INDEX "SignupAbuseEvent_reviewStatus_lastOccurredAt_idx"
    ON "SignupAbuseEvent"("reviewStatus", "lastOccurredAt");
CREATE INDEX "SignupAbuseEvent_emailFingerprint_deviceFingerprint_overrideUntil_idx"
    ON "SignupAbuseEvent"("emailFingerprint", "deviceFingerprint", "overrideUntil");

ALTER TABLE "SignupAbuseEvent"
    ADD CONSTRAINT "SignupAbuseEvent_reviewedByPlatformAdminId_fkey"
    FOREIGN KEY ("reviewedByPlatformAdminId") REFERENCES "PlatformAdmin"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON TABLE "SignupRateLimitBucket" IS
    'Contadores antiabuso compartidos entre instancias; solo contienen huellas HMAC.';
COMMENT ON TABLE "SignupAbuseEvent" IS
    'Rechazos antiabuso agregados y revisables; no contiene correo, IP ni dispositivo en claro.';
