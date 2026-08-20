CREATE TABLE "ManualPaymentProof" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "paymentRequestId" UUID NOT NULL,
    "filename" VARCHAR(180) NOT NULL,
    "contentType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualPaymentProof_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManualPaymentProof_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "ManualPaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ManualPaymentProof_paymentRequestId_key" ON "ManualPaymentProof"("paymentRequestId");
CREATE INDEX "ManualPaymentProof_tenantId_createdAt_idx" ON "ManualPaymentProof"("tenantId", "createdAt");

ALTER TABLE "ManualPaymentProof" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManualPaymentProof" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ManualPaymentProof_tenant_isolation_policy"
    ON "ManualPaymentProof" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ManualPaymentProof" TO "tienda_tenant_app";
