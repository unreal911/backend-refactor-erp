UPDATE "Tenant"
SET "maxImagesPerVariant" = 1
WHERE "maxImagesPerVariant" > 1;

UPDATE "PlanVersion"
SET "maxImagesPerVariant" = 1
WHERE "maxImagesPerVariant" > 1;
