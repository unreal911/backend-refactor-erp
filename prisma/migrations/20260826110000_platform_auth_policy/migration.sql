CREATE TABLE "PlatformAuthPolicy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "signupEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "signupWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "loginEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "loginWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "passwordResetEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "passwordResetWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "invitationEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "invitationWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuthPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformAuthPolicy_singleton_check" CHECK ("id" = 1)
);

INSERT INTO "PlatformAuthPolicy" ("id")
VALUES (1)
ON CONFLICT ("id") DO NOTHING;
