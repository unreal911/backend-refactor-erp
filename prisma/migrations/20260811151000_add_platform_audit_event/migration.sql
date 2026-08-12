CREATE TABLE "PlatformAuditEvent" (
    "id" UUID NOT NULL,
    "actorPlatformAdminId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "correlationId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAuditEvent_occurredAt_idx" ON "PlatformAuditEvent"("occurredAt");
CREATE INDEX "PlatformAuditEvent_actorPlatformAdminId_occurredAt_idx" ON "PlatformAuditEvent"("actorPlatformAdminId", "occurredAt");
CREATE INDEX "PlatformAuditEvent_entityType_entityId_occurredAt_idx" ON "PlatformAuditEvent"("entityType", "entityId", "occurredAt");

REVOKE ALL ON TABLE "PlatformAuditEvent" FROM "tienda_tenant_app";
