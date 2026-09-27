ALTER TABLE "TenantInvitation"
    ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "TenantInvitation"
    ADD COLUMN "phone" VARCHAR(20);

CREATE INDEX "TenantInvitation_phone_status_idx"
    ON "TenantInvitation"("phone", "status");

ALTER TABLE "TenantInvitation"
    ADD CONSTRAINT "TenantInvitation_recipient_check"
    CHECK (("email" IS NOT NULL) <> ("phone" IS NOT NULL));
