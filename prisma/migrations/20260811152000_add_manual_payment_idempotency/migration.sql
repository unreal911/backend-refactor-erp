ALTER TABLE "ManualPaymentRequest" ADD COLUMN "clientRequestId" TEXT NOT NULL;
CREATE UNIQUE INDEX "ManualPaymentRequest_tenantId_clientRequestId_key"
    ON "ManualPaymentRequest"("tenantId", "clientRequestId");
