-- Base operativa para pertenencia por sede y bandeja personal de tareas.

CREATE TYPE "StoreAssignmentType" AS ENUM ('PRIMARY', 'REGULAR', 'TEMPORARY');
CREATE TYPE "OperationalTaskType" AS ENUM (
    'ORDER_REVIEW',
    'LOCAL_PICKING',
    'REMOTE_PICKING',
    'PACKING',
    'TRANSFER_DISPATCH',
    'TRANSFER_RECEIVE',
    'DELIVERY_DISPATCH',
    'CUSTOMER_HANDOFF',
    'DISCREPANCY_REVIEW'
);
CREATE TYPE "OperationalTaskStatus" AS ENUM (
    'PENDING_ACCEPTANCE',
    'ACCEPTED',
    'IN_PROGRESS',
    'WAITING_CONFIRMATION',
    'COMPLETED',
    'REJECTED',
    'CANCELLED',
    'OVERDUE'
);
CREATE TYPE "OperationalTaskPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "UserStoreAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "assignmentType" "StoreAssignmentType" NOT NULL DEFAULT 'REGULAR',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reason" VARCHAR(500),
    "grantedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserStoreAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserStoreAssignment_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserStoreAssignment_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserStoreAssignment_storeId_fkey"
        FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserStoreAssignment_grantedByUserId_fkey"
        FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UserStoreAssignment_period_check"
        CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"),
    CONSTRAINT "UserStoreAssignment_temporary_period_check"
        CHECK ("assignmentType" <> 'TEMPORARY' OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "UserStoreAssignment_tenantId_userId_storeId_assignmentType_key"
    ON "UserStoreAssignment"("tenantId", "userId", "storeId", "assignmentType");
CREATE UNIQUE INDEX "UserStoreAssignment_id_tenantId_key"
    ON "UserStoreAssignment"("id", "tenantId");
CREATE UNIQUE INDEX "UserStoreAssignment_one_active_primary_key"
    ON "UserStoreAssignment"("tenantId", "userId")
    WHERE "isActive" = true AND "assignmentType" = 'PRIMARY';
CREATE INDEX "UserStoreAssignment_tenantId_storeId_isActive_idx"
    ON "UserStoreAssignment"("tenantId", "storeId", "isActive");
CREATE INDEX "UserStoreAssignment_tenantId_userId_isActive_idx"
    ON "UserStoreAssignment"("tenantId", "userId", "isActive");
CREATE INDEX "UserStoreAssignment_tenantId_endsAt_idx"
    ON "UserStoreAssignment"("tenantId", "endsAt");

CREATE TABLE "OperationalTask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "type" "OperationalTaskType" NOT NULL,
    "status" "OperationalTaskStatus" NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    "priority" "OperationalTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "title" VARCHAR(180) NOT NULL,
    "description" VARCHAR(1000),
    "storeId" INTEGER NOT NULL,
    "assignedUserId" INTEGER,
    "assignedByUserId" INTEGER,
    "isCrossStoreAssignment" BOOLEAN NOT NULL DEFAULT false,
    "assignmentOverrideReason" VARCHAR(500),
    "overrideAuthorizedByUserId" INTEGER,
    "orderId" INTEGER,
    "transferId" INTEGER,
    "pickingSessionId" INTEGER,
    "dueAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OperationalTask_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_storeId_fkey"
        FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_assignedUserId_fkey"
        FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_assignedByUserId_fkey"
        FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_overrideAuthorizedByUserId_fkey"
        FOREIGN KEY ("overrideAuthorizedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_transferId_fkey"
        FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_pickingSessionId_fkey"
        FOREIGN KEY ("pickingSessionId") REFERENCES "PickingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OperationalTask_override_check"
        CHECK (
            ("isCrossStoreAssignment" = false AND "assignmentOverrideReason" IS NULL AND "overrideAuthorizedByUserId" IS NULL)
            OR
            ("isCrossStoreAssignment" = true AND length(trim(COALESCE("assignmentOverrideReason", ''))) >= 5 AND "overrideAuthorizedByUserId" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX "OperationalTask_tenantId_code_key"
    ON "OperationalTask"("tenantId", "code");
CREATE UNIQUE INDEX "OperationalTask_id_tenantId_key"
    ON "OperationalTask"("id", "tenantId");
CREATE INDEX "OperationalTask_tenantId_assignedUserId_status_dueAt_idx"
    ON "OperationalTask"("tenantId", "assignedUserId", "status", "dueAt");
CREATE INDEX "OperationalTask_tenantId_storeId_status_idx"
    ON "OperationalTask"("tenantId", "storeId", "status");
CREATE INDEX "OperationalTask_tenantId_orderId_idx"
    ON "OperationalTask"("tenantId", "orderId");
CREATE INDEX "OperationalTask_tenantId_transferId_idx"
    ON "OperationalTask"("tenantId", "transferId");
CREATE INDEX "OperationalTask_tenantId_pickingSessionId_idx"
    ON "OperationalTask"("tenantId", "pickingSessionId");

CREATE TABLE "OperationalTaskEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "fromStatus" "OperationalTaskStatus",
    "toStatus" "OperationalTaskStatus",
    "note" VARCHAR(500),
    "metadata" JSONB,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalTaskEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OperationalTaskEvent_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OperationalTaskEvent_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "OperationalTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OperationalTaskEvent_actorUserId_fkey"
        FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OperationalTaskEvent_id_tenantId_key"
    ON "OperationalTaskEvent"("id", "tenantId");
CREATE INDEX "OperationalTaskEvent_tenantId_taskId_createdAt_idx"
    ON "OperationalTaskEvent"("tenantId", "taskId", "createdAt");
CREATE INDEX "OperationalTaskEvent_tenantId_actorUserId_createdAt_idx"
    ON "OperationalTaskEvent"("tenantId", "actorUserId", "createdAt");

-- Asignación inicial: cada miembro activo queda asociado a la sede principal
-- configurada; si no existe, se utiliza la primera sede activa del tenant.
INSERT INTO "UserStoreAssignment" (
    "tenantId",
    "userId",
    "storeId",
    "assignmentType",
    "startsAt",
    "isActive",
    "reason"
)
SELECT
    membership."tenantId",
    membership."userId",
    selected_store."storeId",
    'PRIMARY'::"StoreAssignmentType",
    COALESCE(membership."activatedAt", membership."createdAt"),
    true,
    'Asignación principal creada durante la migración'
FROM "TenantMembership" membership
JOIN LATERAL (
    SELECT store."id" AS "storeId"
    FROM "Store" store
    LEFT JOIN "Tenant" tenant ON tenant."id" = membership."tenantId"
    WHERE store."tenantId" = membership."tenantId"
      AND store."isActive" = true
    ORDER BY
      CASE WHEN store."id" = tenant."primaryStoreId" THEN 0 ELSE 1 END,
      store."createdAt",
      store."id"
    LIMIT 1
) selected_store ON true
WHERE membership."status" = 'ACTIVE'
ON CONFLICT ("tenantId", "userId", "storeId", "assignmentType") DO NOTHING;

-- Las nuevas capacidades formalizan funciones ya existentes. Se agregan a los
-- snapshots sin habilitar todavía recepción parcial/evidencias.
UPDATE "Tenant"
SET "planFeatures" = ARRAY(
    SELECT DISTINCT feature
    FROM unnest("planFeatures" || ARRAY['tasks.operational']::TEXT[]) feature
)
WHERE 'picking.basic' = ANY("planFeatures");

UPDATE "Tenant"
SET "planFeatures" = ARRAY(
    SELECT DISTINCT feature
    FROM unnest("planFeatures" || ARRAY['fulfillment.remote']::TEXT[]) feature
)
WHERE 'picking.collaborative' = ANY("planFeatures")
  AND 'transfers' = ANY("planFeatures");

UPDATE "PlanVersion"
SET "featureCodes" = ARRAY(
    SELECT DISTINCT feature
    FROM unnest("featureCodes" || ARRAY['tasks.operational']::TEXT[]) feature
)
WHERE 'picking.basic' = ANY("featureCodes");

UPDATE "PlanVersion"
SET "featureCodes" = ARRAY(
    SELECT DISTINCT feature
    FROM unnest("featureCodes" || ARRAY['fulfillment.remote']::TEXT[]) feature
)
WHERE 'picking.collaborative' = ANY("featureCodes")
  AND 'transfers' = ANY("featureCodes");

ALTER TABLE "UserStoreAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationalTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationalTaskEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "UserStoreAssignment_tenant_isolation_policy"
    ON "UserStoreAssignment" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());
CREATE POLICY "OperationalTask_tenant_isolation_policy"
    ON "OperationalTask" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());
CREATE POLICY "OperationalTaskEvent_tenant_isolation_policy"
    ON "OperationalTaskEvent" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE "UserStoreAssignment", "OperationalTask", "OperationalTaskEvent"
    TO "tienda_tenant_app";

