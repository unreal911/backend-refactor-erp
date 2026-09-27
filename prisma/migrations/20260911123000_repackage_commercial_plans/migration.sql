UPDATE "Plan" SET
    "displayName" = 'Básico',
    "description" = 'Vende, controla stock y factura desde un local'
WHERE "code" = 'STARTER';
UPDATE "Plan" SET "description" = 'Prueba durante 15 días la operación colaborativa de Negocio, sin SUNAT' WHERE "code" = 'TRIAL';
UPDATE "Plan" SET "description" = 'Coordina ventas, equipo y hasta dos locales' WHERE "code" = 'GROWTH';
UPDATE "Plan" SET "description" = 'Controla una operación de mayor escala con roles y reportes avanzados' WHERE "code" = 'PREMIUM';

UPDATE "PlanVersion"
SET "status" = 'RETIRED', "retiredAt" = CURRENT_TIMESTAMP, "effectiveUntil" = CURRENT_TIMESTAMP
WHERE "status" = 'ACTIVE' AND "planId" IN (
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'
);

INSERT INTO "PlanVersion" (
    "id", "planId", "version", "status", "currency", "monthlyPrice", "annualPrice",
    "trialDays", "applicationPolicy", "maxUsers", "maxProducts", "maxVariantsPerProduct",
    "maxStores", "maxPosSalesPerMonth", "maxStorageBytes", "maxMainImagesPerProduct",
    "maxImagesPerVariant", "featureCodes", "effectiveFrom", "activatedAt", "activationReason"
) VALUES
('21000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',(SELECT COALESCE(MAX("version"),0)+1 FROM "PlanVersion" WHERE "planId"='10000000-0000-4000-8000-000000000001'),'ACTIVE','PEN',NULL,NULL,15,'NEW_CUSTOMERS',2,10,20,2,70,5368709120,3,1,ARRAY['marketplace','attention.inbox','tasks.operational','fulfillment.remote','picking.basic','picking.collaborative','transfers','roles.partial','images.variant'],CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Replanteamiento comercial: Trial demuestra Negocio'),
('21000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',(SELECT COALESCE(MAX("version"),0)+1 FROM "PlanVersion" WHERE "planId"='10000000-0000-4000-8000-000000000002'),'ACTIVE','PEN',30.00,300.00,NULL,'NEW_CUSTOMERS',2,100,20,1,300,5368709120,3,0,ARRAY['tasks.operational','picking.basic','sunat'],CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Replanteamiento comercial: operación completa de un local'),
('21000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',(SELECT COALESCE(MAX("version"),0)+1 FROM "PlanVersion" WHERE "planId"='10000000-0000-4000-8000-000000000003'),'ACTIVE','PEN',70.00,700.00,NULL,'NEW_CUSTOMERS',5,500,100,2,1000,21474836480,5,1,ARRAY['marketplace','attention.inbox','tasks.operational','fulfillment.remote','picking.basic','picking.collaborative','transfers','roles.partial','images.variant','sunat'],CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Replanteamiento comercial: coordinación de equipo y locales'),
('21000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',(SELECT COALESCE(MAX("version"),0)+1 FROM "PlanVersion" WHERE "planId"='10000000-0000-4000-8000-000000000004'),'ACTIVE','PEN',130.00,1300.00,NULL,'NEW_CUSTOMERS',15,2000,300,5,5000,53687091200,8,1,ARRAY['marketplace','attention.inbox','tasks.operational','fulfillment.remote','picking.basic','picking.collaborative','transfers','roles.partial','roles.custom','reports.advanced','images.variant','sunat'],CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Replanteamiento comercial: control y escala sin anunciar WMS pendiente');
