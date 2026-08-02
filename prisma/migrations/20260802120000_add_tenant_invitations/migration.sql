CREATE TYPE "TenantInvitationStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REVOKED',
    'EXPIRED'
);

CREATE UNIQUE INDEX "TenantMembership_id_tenantId_key"
ON "TenantMembership"("id", "tenantId");

CREATE TABLE "TenantInvitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "TenantMembershipRole" NOT NULL,
    "status" "TenantInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByMembershipId" UUID NOT NULL,
    "acceptedMembershipId" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantInvitation_lifecycle_check" CHECK (
        ("status" = 'PENDING' AND "acceptedMembershipId" IS NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NULL)
        OR ("status" = 'ACCEPTED' AND "acceptedMembershipId" IS NOT NULL AND "acceptedAt" IS NOT NULL AND "revokedAt" IS NULL)
        OR ("status" = 'REVOKED' AND "acceptedMembershipId" IS NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NOT NULL)
        OR ("status" = 'EXPIRED' AND "acceptedMembershipId" IS NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key"
ON "TenantInvitation"("tokenHash");

CREATE UNIQUE INDEX "TenantInvitation_acceptedMembershipId_key"
ON "TenantInvitation"("acceptedMembershipId");

CREATE UNIQUE INDEX "TenantInvitation_one_pending_email_per_tenant_key"
ON "TenantInvitation"("tenantId", "email")
WHERE "status" = 'PENDING';

CREATE INDEX "TenantInvitation_tenantId_status_createdAt_idx"
ON "TenantInvitation"("tenantId", "status", "createdAt");

CREATE INDEX "TenantInvitation_email_status_idx"
ON "TenantInvitation"("email", "status");

ALTER TABLE "TenantInvitation"
ADD CONSTRAINT "TenantInvitation_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantInvitation"
ADD CONSTRAINT "TenantInvitation_invitedByMembershipId_tenantId_fkey"
FOREIGN KEY ("invitedByMembershipId", "tenantId")
REFERENCES "TenantMembership"("id", "tenantId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantInvitation"
ADD CONSTRAINT "TenantInvitation_acceptedMembershipId_tenantId_fkey"
FOREIGN KEY ("acceptedMembershipId", "tenantId")
REFERENCES "TenantMembership"("id", "tenantId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantInvitation" FORCE ROW LEVEL SECURITY;

CREATE POLICY "TenantInvitation_tenant_isolation"
ON "TenantInvitation"
FOR ALL
TO "tienda_tenant_app"
USING ("tenantId" = "current_tenant_id"())
WITH CHECK ("tenantId" = "current_tenant_id"());

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "TenantInvitation"
TO "tienda_tenant_app";
