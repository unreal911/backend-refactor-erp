-- Una variante es una combinación interna de un producto y no consume la
-- cuota de productos. Trial admite hasta 20 variantes en cada producto.
UPDATE "Tenant"
SET "maxVariantsPerProduct" = 20,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "planCode" = 'TRIAL'
  AND "maxVariantsPerProduct" < 20;

UPDATE "PlanVersion" AS version
SET "maxVariantsPerProduct" = 20,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Plan" AS plan
WHERE version."planId" = plan."id"
  AND plan."code" = 'TRIAL'
  AND version."status" IN ('DRAFT', 'SCHEDULED', 'ACTIVE')
  AND version."maxVariantsPerProduct" < 20;
