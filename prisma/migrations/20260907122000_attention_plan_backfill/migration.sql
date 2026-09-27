-- Habilita la bandeja para snapshots existentes de Trial, Negocio y Pro.
UPDATE "Tenant"
SET "planFeatures" = array_append("planFeatures", 'attention.inbox')
WHERE "planCode" IN ('TRIAL', 'GROWTH', 'PREMIUM')
  AND NOT ('attention.inbox' = ANY("planFeatures"));

UPDATE "PlanVersion" AS version
SET "featureCodes" = array_append(version."featureCodes", 'attention.inbox')
FROM "Plan" AS plan
WHERE version."planId" = plan."id"
  AND plan."code" IN ('TRIAL', 'GROWTH', 'PREMIUM')
  AND NOT ('attention.inbox' = ANY(version."featureCodes"));

