-- Alinea snapshots existentes con la matriz aprobada. El WMS avanzado permanece
-- reconocido, pero no se concede mientras su implementación esté pendiente.
UPDATE "Tenant"
SET "maxStores" = LEAST("maxStores", 2),
    "planFeatures" = array_remove("planFeatures", 'picking.advanced')
WHERE "planCode" = 'TRIAL';

UPDATE "Tenant"
SET "planFeatures" = array_remove("planFeatures", 'picking.advanced')
WHERE "planCode" = 'PREMIUM';

UPDATE "PlanVersion" version
SET "maxStores" = LEAST(version."maxStores", 2),
    "featureCodes" = array_remove(version."featureCodes", 'picking.advanced')
FROM "Plan" plan
WHERE plan."id" = version."planId"
  AND plan."code" = 'TRIAL';

UPDATE "PlanVersion" version
SET "featureCodes" = array_remove(version."featureCodes", 'picking.advanced')
FROM "Plan" plan
WHERE plan."id" = version."planId"
  AND plan."code" = 'PREMIUM';
