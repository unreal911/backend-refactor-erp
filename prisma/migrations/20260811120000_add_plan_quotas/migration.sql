ALTER TABLE "Tenant"
    ADD COLUMN "maxVariantsPerProduct" INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN "maxStores" INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN "maxPosSalesPerMonth" INTEGER NOT NULL DEFAULT 70,
    ADD COLUMN "maxMainImagesPerProduct" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "maxImagesPerVariant" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "welcomeStorePromotionStartedAt" TIMESTAMP(3),
    ADD COLUMN "welcomeStorePromotionEndsAt" TIMESTAMP(3);

UPDATE "Tenant"
SET
    "maxUsers" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 2 WHEN 'STARTER' THEN 2 WHEN 'GROWTH' THEN 5 ELSE 15 END,
    "maxProducts" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 10 WHEN 'STARTER' THEN 25 WHEN 'GROWTH' THEN 50 ELSE 200 END,
    "maxOrders" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 70 WHEN 'STARTER' THEN 70 WHEN 'GROWTH' THEN 300 ELSE 1500 END,
    "maxPosSalesPerMonth" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 70 WHEN 'STARTER' THEN 70 WHEN 'GROWTH' THEN 300 ELSE 1500 END,
    "maxVariantsPerProduct" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 10 WHEN 'STARTER' THEN 20 WHEN 'GROWTH' THEN 100 ELSE 300 END,
    "maxStores" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 5 WHEN 'STARTER' THEN 1 WHEN 'GROWTH' THEN 2 ELSE 5 END,
    "maxMainImagesPerProduct" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 3 WHEN 'STARTER' THEN 3 WHEN 'GROWTH' THEN 5 ELSE 8 END,
    "maxImagesPerVariant" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 1 WHEN 'STARTER' THEN 0 ELSE 1 END,
    "maxStorageBytes" = CASE "planCode"::text
        WHEN 'TRIAL' THEN 5368709120
        WHEN 'STARTER' THEN 5368709120
        WHEN 'GROWTH' THEN 21474836480
        ELSE 53687091200
    END;
