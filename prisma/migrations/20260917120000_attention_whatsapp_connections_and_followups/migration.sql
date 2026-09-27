CREATE TABLE "WhatsAppConnection" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "wabaId" VARCHAR(80) NOT NULL,
  "phoneNumberId" VARCHAR(80) NOT NULL,
  "displayPhone" VARCHAR(40) NOT NULL,
  "accessTokenEncrypted" TEXT NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'CONNECTED',
  "lastErrorCode" VARCHAR(80),
  "lastErrorMessage" VARCHAR(500),
  "lastErrorAt" TIMESTAMP(3),
  "connectedByUserId" INTEGER NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppConnection_tenantId_key" ON "WhatsAppConnection"("tenantId");
CREATE UNIQUE INDEX "WhatsAppConnection_phoneNumberId_key" ON "WhatsAppConnection"("phoneNumberId");
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AttentionOrderCase" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "orderId" INTEGER NOT NULL,
  "summary" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttentionOrderCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttentionOrderCase_tenantId_conversationId_orderId_key" ON "AttentionOrderCase"("tenantId", "conversationId", "orderId");
CREATE UNIQUE INDEX "AttentionOrderCase_id_tenantId_key" ON "AttentionOrderCase"("id", "tenantId");
CREATE INDEX "AttentionOrderCase_tenantId_orderId_idx" ON "AttentionOrderCase"("tenantId", "orderId");
ALTER TABLE "AttentionOrderCase" ADD CONSTRAINT "AttentionOrderCase_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttentionOrderCase" ADD CONSTRAINT "AttentionOrderCase_conversationId_tenantId_fkey"
  FOREIGN KEY ("conversationId", "tenantId") REFERENCES "AttentionConversation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttentionOrderCase" ADD CONSTRAINT "AttentionOrderCase_orderId_tenantId_fkey"
  FOREIGN KEY ("orderId", "tenantId") REFERENCES "Order"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AttentionFollowUp" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "createdByUserId" INTEGER NOT NULL,
  "completedByUserId" INTEGER,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttentionFollowUp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttentionFollowUp_status_check" CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED'))
);
CREATE INDEX "AttentionFollowUp_tenantId_caseId_createdAt_idx" ON "AttentionFollowUp"("tenantId", "caseId", "createdAt");
ALTER TABLE "AttentionFollowUp" ADD CONSTRAINT "AttentionFollowUp_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttentionFollowUp" ADD CONSTRAINT "AttentionFollowUp_caseId_tenantId_fkey"
  FOREIGN KEY ("caseId", "tenantId") REFERENCES "AttentionOrderCase"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- La bandeja antigua también queda cubierta por las mismas políticas de aislamiento.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AttentionConversation', 'AttentionMessage', 'AttentionTemplate',
    'WhatsAppConnection', 'AttentionOrderCase', 'AttentionFollowUp'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO "tienda_tenant_app" USING ("tenantId" = "current_tenant_id"()) WITH CHECK ("tenantId" = "current_tenant_id"())',
      table_name || '_tenant_isolation_policy', table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO "tienda_tenant_app"', table_name);
  END LOOP;
END $$;
