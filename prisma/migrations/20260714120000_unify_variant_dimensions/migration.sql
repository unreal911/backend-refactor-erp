-- Modelo unificado de dimensiones opcionales (color/talla) para productos.
-- Reemplaza la inferencia por centinelas (__SIN_COLOR__/__SIN_TALLA__) por datos
-- explicitos. Aditivo: no borra filas centinela (eso ocurre en F4).

-- Product: dimensiones explicitas
ALTER TABLE "Product" ADD COLUMN "hasColor" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "hasSize"  BOOLEAN NOT NULL DEFAULT true;

-- ProductVariant: color/talla opcionales + clave de dimension
DROP INDEX "ProductVariant_productId_colorId_sizeId_key";
ALTER TABLE "ProductVariant" ALTER COLUMN "colorId" DROP NOT NULL;
ALTER TABLE "ProductVariant" ALTER COLUMN "sizeId"  DROP NOT NULL;
ALTER TABLE "ProductVariant" ADD COLUMN "variantKey" TEXT NOT NULL DEFAULT '0-0';

-- Backfill 1: anular referencias a las filas centinela
UPDATE "ProductVariant"
   SET "colorId" = NULL
 WHERE "colorId" IN (SELECT "id" FROM "Color" WHERE "name" = '__SIN_COLOR__');

UPDATE "ProductVariant"
   SET "sizeId" = NULL
 WHERE "sizeId" IN (SELECT "id" FROM "Size" WHERE "name" = '__SIN_TALLA__');

-- Backfill 2: variantKey = "{colorId ?? 0}-{sizeId ?? 0}"
UPDATE "ProductVariant"
   SET "variantKey" = COALESCE("colorId", 0)::text || '-' || COALESCE("sizeId", 0)::text;

-- Backfill 3: flags por producto (derivadas de las variantes reales tras anular centinelas)
UPDATE "Product" p
   SET "hasColor" = EXISTS (
         SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."colorId" IS NOT NULL
       ),
       "hasSize" = EXISTS (
         SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."sizeId" IS NOT NULL
       );

-- Unicidad por (producto, clave de dimension); soporta dimensiones NULL
CREATE UNIQUE INDEX "ProductVariant_productId_variantKey_key" ON "ProductVariant"("productId", "variantKey");
