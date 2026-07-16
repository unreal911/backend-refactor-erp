-- Limpieza (F4): eliminar las filas centinela de color/talla, ya sin referencias
-- tras el modelo unificado de dimensiones opcionales. Defensivo: primero anula
-- cualquier referencia remanente, luego borra.

UPDATE "ProductVariant"
   SET "colorId" = NULL
 WHERE "colorId" IN (SELECT "id" FROM "Color" WHERE "name" = '__SIN_COLOR__');

UPDATE "ProductVariant"
   SET "sizeId" = NULL
 WHERE "sizeId" IN (SELECT "id" FROM "Size" WHERE "name" = '__SIN_TALLA__');

DELETE FROM "Color" WHERE "name" = '__SIN_COLOR__';
DELETE FROM "Size"  WHERE "name" = '__SIN_TALLA__';
