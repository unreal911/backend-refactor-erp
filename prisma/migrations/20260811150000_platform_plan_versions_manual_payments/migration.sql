CREATE TYPE "PlanVersionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED', 'CANCELLED');
CREATE TYPE "PlanApplicationPolicy" AS ENUM ('NEW_CUSTOMERS', 'RENEWAL', 'MANUAL', 'IMMEDIATE');
CREATE TYPE "TenantPlanAssignmentSource" AS ENUM ('MIGRATION', 'TRIAL', 'MANUAL_PAYMENT', 'PLATFORM', 'AUTOMATED_PAYMENT');
CREATE TYPE "TenantPlanAssignmentStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "ManualPaymentMethodType" AS ENUM ('BANK_TRANSFER', 'QR');
CREATE TYPE "ManualPaymentRequestStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" "TenantPlanCode" NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isAvailableForNewSubscriptions" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

CREATE TABLE "PlanVersion" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'PEN',
    "monthlyPrice" DECIMAL(10,2),
    "annualPrice" DECIMAL(10,2),
    "trialDays" INTEGER,
    "applicationPolicy" "PlanApplicationPolicy" NOT NULL DEFAULT 'NEW_CUSTOMERS',
    "maxUsers" INTEGER NOT NULL,
    "maxProducts" INTEGER NOT NULL,
    "maxVariantsPerProduct" INTEGER NOT NULL,
    "maxStores" INTEGER NOT NULL,
    "maxPosSalesPerMonth" INTEGER NOT NULL,
    "maxStorageBytes" BIGINT NOT NULL,
    "maxMainImagesPerProduct" INTEGER NOT NULL,
    "maxImagesPerVariant" INTEGER NOT NULL,
    "featureCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByPlatformAdminId" UUID,
    "activationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "PlanVersion"("planId", "version");
CREATE INDEX "PlanVersion_planId_status_effectiveFrom_idx" ON "PlanVersion"("planId", "status", "effectiveFrom");

ALTER TABLE "Tenant"
    ADD COLUMN "activePlanVersionId" UUID,
    ADD COLUMN "planFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Tenant_activePlanVersionId_idx" ON "Tenant"("activePlanVersionId");
ALTER TABLE "Tenant"
    ADD CONSTRAINT "Tenant_activePlanVersionId_fkey"
    FOREIGN KEY ("activePlanVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantSubscription" ADD COLUMN "planVersionId" UUID;
CREATE INDEX "TenantSubscription_planVersionId_idx" ON "TenantSubscription"("planVersionId");
ALTER TABLE "TenantSubscription"
    ADD CONSTRAINT "TenantSubscription_planVersionId_fkey"
    FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TenantPlanAssignment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "status" "TenantPlanAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "TenantPlanAssignmentSource" NOT NULL,
    "price" DECIMAL(10,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'PEN',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantPlanAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantPlanAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TenantPlanAssignment_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TenantPlanAssignment_id_tenantId_key" ON "TenantPlanAssignment"("id", "tenantId");
CREATE INDEX "TenantPlanAssignment_tenantId_status_startsAt_idx" ON "TenantPlanAssignment"("tenantId", "status", "startsAt");
CREATE INDEX "TenantPlanAssignment_planVersionId_status_idx" ON "TenantPlanAssignment"("planVersionId", "status");

CREATE TABLE "ManualPaymentMethod" (
    "id" UUID NOT NULL,
    "type" "ManualPaymentMethodType" NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "accountHolder" TEXT,
    "accountNumber" TEXT,
    "cci" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'PEN',
    "qrImageUrl" TEXT,
    "instructions" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "createdByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualPaymentMethod_isActive_displayOrder_idx" ON "ManualPaymentMethod"("isActive", "displayOrder");

CREATE TABLE "ManualPaymentRequest" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "paymentMethodId" UUID,
    "assignmentId" UUID,
    "status" "ManualPaymentRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "periodMonths" INTEGER NOT NULL DEFAULT 1,
    "offeredPrice" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PEN',
    "amountReported" DECIMAL(10,2),
    "operationReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "proofUrl" TEXT,
    "applicantNote" TEXT,
    "internalNote" TEXT,
    "requestedByUserId" INTEGER,
    "reviewedByPlatformAdminId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualPaymentRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManualPaymentRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManualPaymentRequest_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManualPaymentRequest_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "ManualPaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManualPaymentRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TenantPlanAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ManualPaymentRequest_code_key" ON "ManualPaymentRequest"("code");
CREATE UNIQUE INDEX "ManualPaymentRequest_assignmentId_key" ON "ManualPaymentRequest"("assignmentId");
CREATE UNIQUE INDEX "ManualPaymentRequest_id_tenantId_key" ON "ManualPaymentRequest"("id", "tenantId");
CREATE INDEX "ManualPaymentRequest_tenantId_status_createdAt_idx" ON "ManualPaymentRequest"("tenantId", "status", "createdAt");
CREATE INDEX "ManualPaymentRequest_status_createdAt_idx" ON "ManualPaymentRequest"("status", "createdAt");
CREATE INDEX "ManualPaymentRequest_operationReference_idx" ON "ManualPaymentRequest"("operationReference");

INSERT INTO "Plan" ("id", "code", "displayName", "description") VALUES
    ('10000000-0000-4000-8000-000000000001', 'TRIAL', 'Trial', 'Prueba gratuita de 15 días sin acceso SUNAT'),
    ('10000000-0000-4000-8000-000000000002', 'STARTER', 'Económico', 'Plan para microempresas que inician'),
    ('10000000-0000-4000-8000-000000000003', 'GROWTH', 'Negocio', 'Plan para empresas con operación colaborativa'),
    ('10000000-0000-4000-8000-000000000004', 'PREMIUM', 'Pro', 'Plan para operaciones de mayor volumen');

INSERT INTO "PlanVersion" (
    "id", "planId", "version", "status", "currency", "monthlyPrice",
    "trialDays", "applicationPolicy", "maxUsers", "maxProducts",
    "maxVariantsPerProduct", "maxStores", "maxPosSalesPerMonth",
    "maxStorageBytes", "maxMainImagesPerProduct", "maxImagesPerVariant",
    "featureCodes", "effectiveFrom", "activatedAt", "activationReason"
) VALUES
    (
        '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1,
        'ACTIVE', 'PEN', NULL, 15, 'NEW_CUSTOMERS', 2, 10, 10, 5, 70,
        5368709120, 3, 1,
        ARRAY['marketplace','picking.basic','picking.collaborative','picking.advanced','transfers','roles.partial','roles.custom','reports.advanced','images.variant'],
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Migración del catálogo estático vigente'
    ),
    (
        '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1,
        'ACTIVE', 'PEN', 30.00, NULL, 'NEW_CUSTOMERS', 2, 25, 20, 1, 70,
        5368709120, 3, 0,
        ARRAY['picking.basic','sunat'],
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Migración del catálogo estático vigente'
    ),
    (
        '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 1,
        'ACTIVE', 'PEN', 70.00, NULL, 'NEW_CUSTOMERS', 5, 50, 100, 2, 300,
        21474836480, 5, 1,
        ARRAY['marketplace','picking.basic','picking.collaborative','transfers','roles.partial','images.variant','sunat'],
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Migración del catálogo estático vigente'
    ),
    (
        '20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 1,
        'ACTIVE', 'PEN', 130.00, NULL, 'NEW_CUSTOMERS', 15, 200, 300, 5, 1500,
        53687091200, 8, 1,
        ARRAY['marketplace','picking.basic','picking.collaborative','picking.advanced','transfers','roles.partial','roles.custom','reports.advanced','images.variant','sunat'],
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Migración del catálogo estático vigente'
    );

UPDATE "Tenant"
SET
    "activePlanVersionId" = CASE "planCode"::text
        WHEN 'TRIAL' THEN '20000000-0000-4000-8000-000000000001'::uuid
        WHEN 'STARTER' THEN '20000000-0000-4000-8000-000000000002'::uuid
        WHEN 'GROWTH' THEN '20000000-0000-4000-8000-000000000003'::uuid
        ELSE '20000000-0000-4000-8000-000000000004'::uuid
    END,
    "planFeatures" = CASE "planCode"::text
        WHEN 'TRIAL' THEN ARRAY['marketplace','picking.basic','picking.collaborative','picking.advanced','transfers','roles.partial','roles.custom','reports.advanced','images.variant']
        WHEN 'STARTER' THEN ARRAY['picking.basic','sunat']
        WHEN 'GROWTH' THEN ARRAY['marketplace','picking.basic','picking.collaborative','transfers','roles.partial','images.variant','sunat']
        ELSE ARRAY['marketplace','picking.basic','picking.collaborative','picking.advanced','transfers','roles.partial','roles.custom','reports.advanced','images.variant','sunat']
    END;

UPDATE "TenantSubscription"
SET "planVersionId" = CASE "planCode"::text
    WHEN 'TRIAL' THEN '20000000-0000-4000-8000-000000000001'::uuid
    WHEN 'STARTER' THEN '20000000-0000-4000-8000-000000000002'::uuid
    WHEN 'GROWTH' THEN '20000000-0000-4000-8000-000000000003'::uuid
    ELSE '20000000-0000-4000-8000-000000000004'::uuid
END;

INSERT INTO "TenantPlanAssignment" (
    "id", "tenantId", "planVersionId", "status", "source", "price", "currency", "startsAt", "reason"
)
SELECT
    gen_random_uuid(),
    t."id",
    t."activePlanVersionId",
    'ACTIVE'::"TenantPlanAssignmentStatus",
    'MIGRATION'::"TenantPlanAssignmentSource",
    pv."monthlyPrice",
    pv."currency",
    COALESCE(t."trialStartedAt", t."createdAt"),
    'Asignación inicial creada al migrar planes versionados'
FROM "Tenant" t
JOIN "PlanVersion" pv ON pv."id" = t."activePlanVersionId";

ALTER TABLE "TenantPlanAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPlanAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantPlanAssignment_tenant_isolation_policy"
    ON "TenantPlanAssignment" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());

ALTER TABLE "ManualPaymentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManualPaymentRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ManualPaymentRequest_tenant_isolation_policy"
    ON "ManualPaymentRequest" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());

GRANT SELECT ON TABLE "Plan", "PlanVersion", "ManualPaymentMethod" TO "tienda_tenant_app";
GRANT SELECT ON TABLE "TenantPlanAssignment" TO "tienda_tenant_app";
GRANT SELECT, INSERT ON TABLE "ManualPaymentRequest" TO "tienda_tenant_app";
