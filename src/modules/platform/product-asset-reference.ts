import { Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

export type ProductAssetReference = {
    tenantId: string;
    url: string;
};

/**
 * Consulta global deliberada: la eliminación del objeto físico debe considerar
 * referencias de todas las empresas aunque el solicitante solo vea la suya.
 */
export async function listProductAssetReferencesOutsideTenant(
    tenantId: string,
): Promise<ProductAssetReference[]> {
    return platformPrisma.$queryRaw<ProductAssetReference[]>(Prisma.sql`
        SELECT "tenantId", "url"
        FROM "ProductImage"
        WHERE "tenantId" <> ${tenantId}::uuid
        UNION ALL
        SELECT "tenantId", "imageUrl" AS "url"
        FROM "ProductVariant"
        WHERE "tenantId" <> ${tenantId}::uuid
          AND "imageUrl" IS NOT NULL
    `);
}
