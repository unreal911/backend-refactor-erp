import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { EmisorConfigService } from "../src/modules/sunat/config/emisor-config.service";
import { ComprobanteService } from "../src/modules/sunat/services/comprobante.service";
import { reserveNextNumber } from "../src/modules/sunat/services/numbering.service";
import { inspectSunatTenantMigration } from "../src/modules/tenant/sunat-reconciliation";

const suffix = Date.now().toString(36);
const LEGACY_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const tenantIds: string[] = [];
let dbReady = false;
let historicalSnapshotReady = false;

type CompanyFixture = {
    tenantId: string;
    storeId: number;
    orderId: number;
    serieId: number;
    comprobanteId: number;
    resumenId: number;
    bajaId: number;
};

let companyA: CompanyFixture | null = null;
let companyB: CompanyFixture | null = null;

function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

async function createCompany(label: "A" | "B"): Promise<CompanyFixture> {
    const tenant = await prisma.tenant.create({
        data: {
            slug: `ten007-${label.toLowerCase()}-${suffix}`,
            name: `TEN007 Empresa ${label} ${suffix}`,
            status: "SUSPENDED",
        },
    });
    tenantIds.push(tenant.id);

    return inTenant(tenant.id, async () => {
        const store = await prisma.store.create({
            data: {
                code: `TEN007-SHARED-${suffix}`,
                name: `TEN007 Tienda ${label}`,
            },
        });
        const order = await prisma.order.create({
            data: {
                code: `TEN007-ORDER-${label}-${suffix}`,
                sourceStoreId: store.id,
                clientName: `Cliente ${label}`,
                total: 118,
            },
        });
        const serie = await prisma.comprobanteSerie.create({
            data: {
                tipo: "FACTURA",
                serie: "F777",
                correlativo: 0,
                storeId: store.id,
            },
        });
        const resumen = await prisma.resumenDiario.create({
            data: {
                correlativo: 1,
                fechaReferencia: new Date("2026-07-29T00:00:00.000Z"),
                fileName: `20100000001-RC-20260729-${suffix}`,
                endpoint: "https://sunat.example.test/billService",
            },
        });
        const baja = await prisma.comunicacionBaja.create({
            data: {
                correlativo: 1,
                fechaReferencia: new Date("2026-07-29T00:00:00.000Z"),
                fileName: `20100000001-RA-20260729-${suffix}`,
                endpoint: "https://sunat.example.test/billService",
            },
        });
        const comprobante = await prisma.comprobante.create({
            data: {
                tipo: "FACTURA",
                tipoCodigo: "01",
                serie: "F777",
                numero: 1,
                nombreArchivo: `20100000001-01-F777-${suffix}`,
                emisorRuc: "20100000001",
                emisorRazonSocial: `TEN007 Empresa ${label}`,
                clienteTipoDoc: "6",
                clienteNumDoc: "20999999991",
                clienteNombre: "Cliente TEN007",
                totalGravado: 100,
                totalIgv: 18,
                totalValorVenta: 100,
                totalPrecioVenta: 118,
                leyendaMontoLetras: "CIENTO DIECIOCHO Y 00/100 SOLES",
                orderId: order.id,
                serieRefId: serie.id,
                resumenDiarioId: resumen.id,
                comunicacionBajaId: baja.id,
                items: {
                    create: {
                        linea: 1,
                        descripcion: "Producto TEN007",
                        cantidad: 1,
                        valorUnitario: 100,
                        precioUnitario: 118,
                        valorVenta: 100,
                        igv: 18,
                    },
                },
                dispatches: {
                    create: {
                        endpoint: "https://sunat.example.test/billService",
                        fileName: `20100000001-01-F777-${suffix}.zip`,
                        documentTypeCode: "01",
                        status: "SIMULATED",
                    },
                },
            },
        });

        const configService = new EmisorConfigService();
        await configService.actualizar({
            ruc: label === "A" ? "20111111111" : "20222222222",
            razonSocial: `Emisor ${label}`,
            ubigeo: "150101",
            solUser: `SOL${label}`,
        });
        await prisma.sunatEmisorConfig.updateMany({
            data: { activo: true },
        });

        return {
            tenantId: tenant.id,
            storeId: store.id,
            orderId: order.id,
            serieId: serie.id,
            comprobanteId: comprobante.id,
            resumenId: resumen.id,
            bajaId: baja.id,
        };
    });
}

beforeAll(async () => {
    const migration = await prisma.$queryRawUnsafe<Array<{
        migration_name: string;
    }>>(
        `SELECT migration_name
         FROM "_prisma_migrations"
         WHERE migration_name='20260729230000_tenant_scope_sunat'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL`,
    ).catch(() => []);
    dbReady = migration.length === 1;
    if (!dbReady) return;
    historicalSnapshotReady = await prisma.comprobante.count({
        where: { tenantId: LEGACY_TENANT_ID },
    }) === 10;
    companyA = await createCompany("A");
    companyB = await createCompany("B");
});

afterAll(async () => {
    if (tenantIds.length > 0) {
        await prisma.sunatDispatch.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.comprobanteItem.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.comprobante.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.resumenDiario.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.comunicacionBaja.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.comprobanteSerie.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.sunatEmisorConfig.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.orderItem.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.order.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.store.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.tenantMembership.deleteMany({
            where: { tenantId: { in: tenantIds } },
        });
        await prisma.tenant.deleteMany({
            where: { id: { in: tenantIds } },
        });
    }
    await prisma.$disconnect();
});

describe("TEN-007: SUNAT aislado por empresa", () => {
    it("reconcilia todos los datos fiscales historicos", async (ctx) => {
        if (!dbReady || !historicalSnapshotReady) return ctx.skip();
        const summary = await inspectSunatTenantMigration();
        expect(summary.tenantColumnsNotNull).toBe(7);
        expect(summary.validatedConstraints).toBe(16);
        expect(summary.crossTenantReferences).toBe(0);
        expect(summary.duplicateFiscalKeys).toBe(0);
        expect(summary.tables.reduce(
            (total, table) => total + table.rowCount,
            0,
        )).toBe(32);
    });

    it("permite las mismas claves fiscales en empresas distintas", async () => {
        if (!dbReady || !companyA || !companyB) return;
        const [serieA, serieB, comprobanteA, comprobanteB] = await Promise.all([
            inTenant(companyA.tenantId, () =>
                prisma.comprobanteSerie.findUniqueOrThrow({
                    where: {
                        tenantId_tipo_serie_scopeKey: {
                            tenantId: companyA!.tenantId,
                            tipo: "FACTURA",
                            serie: "F777",
                            scopeKey: "GLOBAL",
                        },
                    },
                })
            ),
            inTenant(companyB.tenantId, () =>
                prisma.comprobanteSerie.findUniqueOrThrow({
                    where: {
                        tenantId_tipo_serie_scopeKey: {
                            tenantId: companyB!.tenantId,
                            tipo: "FACTURA",
                            serie: "F777",
                            scopeKey: "GLOBAL",
                        },
                    },
                })
            ),
            inTenant(companyA.tenantId, () =>
                prisma.comprobante.findUniqueOrThrow({
                    where: { id: companyA!.comprobanteId },
                })
            ),
            inTenant(companyB.tenantId, () =>
                prisma.comprobante.findUniqueOrThrow({
                    where: { id: companyB!.comprobanteId },
                })
            ),
        ]);
        expect(serieA.tenantId).toBe(companyA.tenantId);
        expect(serieB.tenantId).toBe(companyB.tenantId);
        expect(comprobanteA.nombreArchivo).toBe(comprobanteB.nombreArchivo);
        expect(comprobanteA.tenantId).not.toBe(comprobanteB.tenantId);
    });

    it("oculta lecturas y mutaciones de otra empresa", async () => {
        if (!dbReady || !companyA || !companyB) return;
        const visibleFromA = await inTenant(companyA.tenantId, () =>
            prisma.comprobante.findUnique({
                where: { id: companyB!.comprobanteId },
            })
        );
        const changedFromA = await inTenant(companyA.tenantId, () =>
            prisma.comprobante.updateMany({
                where: { id: companyB!.comprobanteId },
                data: { motivoBaja: "MUTACION CRUZADA" },
            })
        );
        expect(visibleFromA).toBeNull();
        expect(changedFromA.count).toBe(0);
    });

    it("rechaza relaciones de orden, resumen y baja de otra empresa", async () => {
        if (!dbReady || !companyA || !companyB) return;
        await expect(inTenant(companyA.tenantId, () =>
            prisma.comprobante.create({
                data: {
                    tipo: "FACTURA",
                    tipoCodigo: "01",
                    serie: "F778",
                    numero: 1,
                    nombreArchivo: `20100000001-01-F778-${suffix}`,
                    emisorRuc: "20100000001",
                    emisorRazonSocial: "Emisor A",
                    clienteTipoDoc: "6",
                    clienteNumDoc: "20999999991",
                    clienteNombre: "Cliente cruzado",
                    leyendaMontoLetras: "CERO Y 00/100 SOLES",
                    orderId: companyB!.orderId,
                },
            })
        )).rejects.toThrow();

        await expect(inTenant(companyA.tenantId, () =>
            prisma.comprobante.update({
                where: { id: companyA!.comprobanteId },
                data: { resumenDiarioId: companyB!.resumenId },
            })
        )).rejects.toThrow();

        await expect(inTenant(companyA.tenantId, () =>
            prisma.comprobante.update({
                where: { id: companyA!.comprobanteId },
                data: { comunicacionBajaId: companyB!.bajaId },
            })
        )).rejects.toThrow();
    });

    it("mantiene correlativos y configuracion del emisor por empresa", async () => {
        if (!dbReady || !companyA || !companyB) return;
        const [numberA, numberB, configA, configB] = await Promise.all([
            inTenant(companyA.tenantId, () =>
                prisma.$transaction((tx) =>
                    reserveNextNumber(tx, "FACTURA", "F777")
                )
            ),
            inTenant(companyB.tenantId, () =>
                prisma.$transaction((tx) =>
                    reserveNextNumber(tx, "FACTURA", "F777")
                )
            ),
            inTenant(companyA.tenantId, () =>
                new EmisorConfigService().obtener()
            ),
            inTenant(companyB.tenantId, () =>
                new EmisorConfigService().obtener()
            ),
        ]);
        expect(numberA.numero).toBe(1);
        expect(numberB.numero).toBe(1);
        expect(configA.ruc).toBe("20111111111");
        expect(configB.ruc).toBe("20222222222");
        expect(configA.ruc).not.toBe(configB.ruc);
    });

    it("una instancia compartida no reutiliza el emisor de otra empresa", async () => {
        if (!dbReady || !companyA || !companyB) return;
        const sharedService = new ComprobanteService() as unknown as {
            ensureReady(): Promise<void>;
            config: { ruc: string };
        };
        const readRuntimeRuc = (tenantId: string) =>
            inTenant(tenantId, async () => {
                await sharedService.ensureReady();
                return sharedService.config.ruc;
            });

        expect(await readRuntimeRuc(companyA.tenantId)).toBe("20111111111");
        expect(await readRuntimeRuc(companyB.tenantId)).toBe("20222222222");
        expect(await readRuntimeRuc(companyA.tenantId)).toBe("20111111111");
    });
});
