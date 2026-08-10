import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, runTenantDatabaseTransaction } from '../src/data/prisma';
import { CreateProductDto } from '../src/domain/dtos/create-product.dto';
import { UpdateProductDto } from '../src/domain/dtos/update-product.dto';
import {
    normalizeProductDisplayName,
    normalizeProductNameKey,
} from '../src/domain/normalization/product-name';
import { LEGACY_TENANT_ID } from '../src/modules/tenant/tenant-data-context';
import { ProductService } from '../src/presentation/services/product.service';

const tag = Date.now().toString(36);
let dbReady = false;
let tenantBId = '';
let categoryAId = 0;
let categoryBId = 0;
const productIds: number[] = [];

function createDto(name: string, categoryId: number) {
    const [error, dto] = CreateProductDto.create({
        name,
        categoryId,
        variantMode: 'SIMPLE',
        variants: [{ price: 25, isActive: true }],
    });
    if (error || !dto) throw new Error(error || 'DTO de producto invalido');
    return dto;
}

async function createProduct(tenantId: string, name: string, categoryId: number) {
    const result = await runTenantDatabaseTransaction(
        tenantId,
        () => new ProductService().createProduct(createDto(name, categoryId)),
    );
    productIds.push(Number(result.product.id));
    return result.product;
}

describe('normalizacion del nombre de producto', () => {
    it('colapsa espacios sin alterar el nombre visible', () => {
        expect(normalizeProductDisplayName('  Pólo\t de   Algodón  ')).toBe('Pólo de Algodón');
    });

    it('iguala mayusculas, espacios y tildes en la clave canonica', () => {
        expect(normalizeProductNameKey('  PÓLO   NIÑO  ')).toBe('polo nino');
        expect(normalizeProductNameKey('polo nino')).toBe('polo nino');
    });
});

describe('REL-001: unicidad de producto por empresa', () => {
    beforeAll(async () => {
        try {
            const migration = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
                `SELECT migration_name
                 FROM "_prisma_migrations"
                 WHERE migration_name = '20260810213000_product_name_uniqueness_per_tenant'
                   AND finished_at IS NOT NULL`,
            );
            if (migration.length !== 1) return;

            const tenantB = await prisma.tenant.create({
                data: {
                    slug: `product-name-b-${tag}`,
                    name: `Product Name B ${tag}`,
                    status: 'ACTIVE',
                },
            });
            tenantBId = tenantB.id;
            const categoryName = `Product Name Category ${tag}`;
            const categoryA = await runTenantDatabaseTransaction(
                LEGACY_TENANT_ID,
                () => prisma.category.create({ data: { name: categoryName } }),
            );
            const categoryB = await runTenantDatabaseTransaction(
                tenantBId,
                () => prisma.category.create({ data: { name: categoryName } }),
            );
            categoryAId = categoryA.id;
            categoryBId = categoryB.id;
            dbReady = true;
        } catch {
            dbReady = false;
        }
    });

    afterAll(async () => {
        try {
            if (productIds.length) {
                await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
                await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
                await prisma.product.deleteMany({ where: { id: { in: productIds } } });
            }
            if (categoryAId || categoryBId) {
                await prisma.category.deleteMany({ where: { id: { in: [categoryAId, categoryBId].filter(Boolean) } } });
            }
            if (tenantBId) await prisma.tenant.delete({ where: { id: tenantBId } });
        } catch { /* limpieza de mejor esfuerzo */ }
        await prisma.$disconnect().catch(() => undefined);
    });

    it('bloquea dos creaciones concurrentes con el mismo nombre logico', async (ctx) => {
        if (!dbReady) return ctx.skip();
        const base = `Pólo Carrera ${tag}`;
        const results = await Promise.allSettled([
            createProduct(LEGACY_TENANT_ID, base, categoryAId),
            createProduct(LEGACY_TENANT_ID, `  POLO   CARRERA ${tag} `, categoryAId),
        ]);
        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
            statusCode: 400,
            message: 'Ya existe un producto con el mismo nombre en esta empresa',
        });
    }, 60_000);

    it('bloquea una edicion que colisiona y conserva el nombre anterior', async (ctx) => {
        if (!dbReady) return ctx.skip();
        const first = await createProduct(LEGACY_TENANT_ID, `Camísa Formal ${tag}`, categoryAId);
        const second = await createProduct(LEGACY_TENANT_ID, `Pantalon Formal ${tag}`, categoryAId);
        const [error, dto] = UpdateProductDto.create({ name: ` camisa   formal ${tag} ` });
        expect(error).toBeUndefined();

        await expect(runTenantDatabaseTransaction(
            LEGACY_TENANT_ID,
            () => new ProductService().updateProduct(second.id, dto!),
        )).rejects.toMatchObject({ statusCode: 400 });

        const persisted = await runTenantDatabaseTransaction(
            LEGACY_TENANT_ID,
            () => prisma.product.findUnique({ where: { id: second.id } }),
        );
        expect(persisted?.name).toBe(`Pantalon Formal ${tag}`);
        expect(first.name).toBe(`Camísa Formal ${tag}`);
    }, 60_000);

    it('permite el mismo nombre logico en empresas diferentes', async (ctx) => {
        if (!dbReady) return ctx.skip();
        const companyA = await createProduct(LEGACY_TENANT_ID, `Zapatílla Urbana ${tag}`, categoryAId);
        const companyB = await createProduct(tenantBId, ` zapatilla   urbana ${tag} `, categoryBId);
        const persistedA = await runTenantDatabaseTransaction(
            LEGACY_TENANT_ID,
            () => prisma.product.findUnique({ where: { id: companyA.id } }),
        );
        const persistedB = await runTenantDatabaseTransaction(
            tenantBId,
            () => prisma.product.findUnique({ where: { id: companyB.id } }),
        );

        expect(persistedA?.tenantId).toBe(LEGACY_TENANT_ID);
        expect(persistedB?.tenantId).toBe(tenantBId);
        expect(normalizeProductNameKey(companyA.name)).toBe(normalizeProductNameKey(companyB.name));
    }, 60_000);
});
