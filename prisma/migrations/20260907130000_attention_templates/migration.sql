CREATE TABLE "AttentionTemplate" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttentionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttentionTemplate_tenantId_title_key" ON "AttentionTemplate"("tenantId", "title");
CREATE INDEX "AttentionTemplate_tenantId_isActive_displayOrder_idx" ON "AttentionTemplate"("tenantId", "isActive", "displayOrder");
ALTER TABLE "AttentionTemplate" ADD CONSTRAINT "AttentionTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
