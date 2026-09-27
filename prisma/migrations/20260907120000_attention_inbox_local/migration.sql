-- Bandeja local de atención desacoplada del proveedor Meta.
CREATE TABLE "AttentionConversation" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "channel" VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
  "provider" VARCHAR(30) NOT NULL DEFAULT 'LOCAL',
  "externalId" VARCHAR(160),
  "contactName" VARCHAR(160),
  "contactPhone" VARCHAR(20) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "assignedUserId" INTEGER,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "customerId" INTEGER,
  "orderId" INTEGER,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttentionConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttentionConversation_unreadCount_check" CHECK ("unreadCount" >= 0)
);

CREATE TABLE "AttentionMessage" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "direction" VARCHAR(20) NOT NULL,
  "type" VARCHAR(30) NOT NULL DEFAULT 'TEXT',
  "body" TEXT NOT NULL,
  "providerMessageId" VARCHAR(180),
  "deliveryStatus" VARCHAR(30) NOT NULL DEFAULT 'LOCAL',
  "sentByUserId" INTEGER,
  "metadata" JSONB,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttentionMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttentionConversation_id_tenantId_key" ON "AttentionConversation"("id", "tenantId");
CREATE INDEX "AttentionConversation_tenantId_status_lastMessageAt_idx" ON "AttentionConversation"("tenantId", "status", "lastMessageAt");
CREATE INDEX "AttentionConversation_tenantId_assignedUserId_status_idx" ON "AttentionConversation"("tenantId", "assignedUserId", "status");
CREATE INDEX "AttentionConversation_tenantId_contactPhone_idx" ON "AttentionConversation"("tenantId", "contactPhone");
CREATE UNIQUE INDEX "AttentionMessage_tenantId_providerMessageId_key" ON "AttentionMessage"("tenantId", "providerMessageId");
CREATE INDEX "AttentionMessage_tenantId_conversationId_sentAt_idx" ON "AttentionMessage"("tenantId", "conversationId", "sentAt");

ALTER TABLE "AttentionConversation"
  ADD CONSTRAINT "AttentionConversation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttentionConversation"
  ADD CONSTRAINT "AttentionConversation_customerId_tenantId_fkey"
  FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttentionConversation"
  ADD CONSTRAINT "AttentionConversation_orderId_tenantId_fkey"
  FOREIGN KEY ("orderId", "tenantId") REFERENCES "Order"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttentionConversation"
  ADD CONSTRAINT "AttentionConversation_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttentionMessage"
  ADD CONSTRAINT "AttentionMessage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttentionMessage"
  ADD CONSTRAINT "AttentionMessage_conversationId_tenantId_fkey"
  FOREIGN KEY ("conversationId", "tenantId") REFERENCES "AttentionConversation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttentionMessage"
  ADD CONSTRAINT "AttentionMessage_sentByUserId_fkey"
  FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
