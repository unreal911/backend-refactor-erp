DROP POLICY IF EXISTS "AdminEventOutbox_tenant_isolation_policy" ON "AdminEventOutbox";
CREATE POLICY "AdminEventOutbox_tenant_isolation_policy"
    ON "AdminEventOutbox" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());

DROP POLICY IF EXISTS "TrialBenefitClaim_tenant_isolation_policy" ON "TrialBenefitClaim";
CREATE POLICY "TrialBenefitClaim_tenant_isolation_policy"
    ON "TrialBenefitClaim" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());

DROP POLICY IF EXISTS "ManualPaymentProof_tenant_isolation_policy" ON "ManualPaymentProof";
CREATE POLICY "ManualPaymentProof_tenant_isolation_policy"
    ON "ManualPaymentProof" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());
