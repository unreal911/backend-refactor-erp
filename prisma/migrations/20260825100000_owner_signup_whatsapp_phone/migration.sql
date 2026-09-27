ALTER TABLE "OwnerRegistration"
    ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "OwnerRegistration"
    ADD COLUMN "phone" VARCHAR(20);

CREATE UNIQUE INDEX "OwnerRegistration_phone_key"
    ON "OwnerRegistration"("phone");

ALTER TABLE "User"
    ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "User"
    ADD COLUMN "phone" VARCHAR(20);

CREATE UNIQUE INDEX "User_phone_key"
    ON "User"("phone");
