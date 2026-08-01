-- EMP-001: identidad pendiente global, previa a cualquier tenant o membresia.
CREATE TYPE "OwnerRegistrationStatus" AS ENUM (
    'EMAIL_PENDING',
    'EMAIL_VERIFIED',
    'CONSUMED',
    'CANCELLED'
);

CREATE TABLE "OwnerRegistration" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "businessName" VARCHAR(120) NOT NULL,
    "status" "OwnerRegistrationStatus" NOT NULL DEFAULT 'EMAIL_PENDING',
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" VARCHAR(50) NOT NULL,
    "verificationTokenHash" CHAR(64),
    "verificationTokenExpiresAt" TIMESTAMP(3),
    "verificationRequestedAt" TIMESTAMP(3) NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "trialProvisioningTokenHash" CHAR(64),
    "trialProvisioningTokenExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerRegistration_email_key"
    ON "OwnerRegistration"("email");
CREATE UNIQUE INDEX "OwnerRegistration_verificationTokenHash_key"
    ON "OwnerRegistration"("verificationTokenHash");
CREATE UNIQUE INDEX "OwnerRegistration_trialProvisioningTokenHash_key"
    ON "OwnerRegistration"("trialProvisioningTokenHash");
CREATE INDEX "OwnerRegistration_status_verificationTokenExpiresAt_idx"
    ON "OwnerRegistration"("status", "verificationTokenExpiresAt");
CREATE INDEX "OwnerRegistration_status_trialProvisioningTokenExpiresAt_idx"
    ON "OwnerRegistration"("status", "trialProvisioningTokenExpiresAt");

COMMENT ON TABLE "OwnerRegistration" IS
    'Identidad global pendiente de EMP-001; nunca equivale a un tenant ni a una membresia activa.';
