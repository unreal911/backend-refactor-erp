import type { AddressInfo } from "node:net";
import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { platformPrisma } from "../data/platform-prisma";
import { AppRouter } from "../presentation/routes";
import { createExpressApp } from "../presentation/server";

type JsonObject = Record<string, any>;

async function readJson(label: string, response: Response): Promise<JsonObject> {
    const body = await response.json() as JsonObject;
    if (!response.ok) {
        throw new Error(`${label}: ${response.status} ${JSON.stringify(body)}`);
    }
    return body;
}

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    if (!envs.SEED_DEMO_PASSWORD.trim()) {
        throw new Error("SEED_DEMO_PASSWORD requerido para el smoke HTTP");
    }

    const tag = Date.now().toString(36);
    const temporaryTenantIds: string[] = [];
    const admin = await platformPrisma.user.findUnique({
        where: { email: "admin@example.com" },
        select: { id: true },
    });
    if (!admin) {
        throw new Error("No existe admin@example.com para el smoke HTTP");
    }
    for (const fixture of [
        {
            slug: `http-suspended-${tag}`,
            name: `HTTP suspended ${tag}`,
            tenantStatus: "SUSPENDED" as const,
            membershipStatus: "ACTIVE" as const,
        },
        {
            slug: `http-inactive-${tag}`,
            name: `HTTP inactive ${tag}`,
            tenantStatus: "ACTIVE" as const,
            membershipStatus: "INACTIVE" as const,
        },
    ]) {
        const tenant = await platformPrisma.tenant.create({
            data: {
                slug: fixture.slug,
                name: fixture.name,
                status: fixture.tenantStatus,
            },
        });
        temporaryTenantIds.push(tenant.id);
        await platformPrisma.tenantMembership.create({
            data: {
                tenantId: tenant.id,
                userId: admin.id,
                role: "OWNER",
                status: fixture.membershipStatus,
                activatedAt: fixture.membershipStatus === "ACTIVE"
                    ? new Date()
                    : null,
                deactivatedAt: fixture.membershipStatus === "INACTIVE"
                    ? new Date()
                    : null,
            },
        });
    }

    // El tenant legado usa STARTER y ese plan no incluye marketplace. La ruta
    // pública se prueba con una empresa temporal cuyo plan sí habilita la
    // característica, sin alterar el plan real de legacy-main.
    const marketplaceSlug = `http-marketplace-${tag}`;
    const marketplaceTenant = await platformPrisma.tenant.create({
        data: {
            slug: marketplaceSlug,
            marketplaceSlug,
            name: `HTTP marketplace ${tag}`,
            status: "ACTIVE",
            planCode: "GROWTH",
        },
    });
    temporaryTenantIds.push(marketplaceTenant.id);

    const app = createExpressApp({ routes: AppRouter.router });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
        server.once("listening", () => resolve());
        server.once("error", reject);
    });

    try {
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const health = await readJson("health", await fetch(`${baseUrl}/api/health`));
        const login = await readJson("auth/login", await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                email: "admin@example.com",
                password: envs.SEED_DEMO_PASSWORD,
                tenantSlug: "legacy-main",
            }),
        }));
        const authorization = `Bearer ${String(login.token || "")}`;
        if (!login.token) throw new Error("El login no devolvio token");

        // Las peticiones son secuenciales para que cada error identifique su
        // endpoint y no quede oculto por el rechazo agregado de Promise.all.
        const context = await readJson("tenant/context", await fetch(`${baseUrl}/api/tenant/context`, {
            headers: { authorization },
        }));
        const products = await readJson("products", await fetch(`${baseUrl}/api/products?skip=1&take=5`, {
            headers: { authorization },
        }));
        const stores = await readJson("stores", await fetch(`${baseUrl}/api/stores?skip=1&take=5`, {
            headers: { authorization },
        }));
        const users = await readJson("users", await fetch(`${baseUrl}/api/users?skip=1&take=3`, {
            headers: { authorization },
        }));
        const publicProducts = await readJson("public/products", await fetch(`${baseUrl}/api/public/products?skip=1&take=3`, {
            headers: { "x-tenant-slug": marketplaceSlug },
        }));

        const wrongTenant = await fetch(`${baseUrl}/api/products?skip=1&take=1`, {
            headers: {
                authorization,
                "x-tenant-slug": "otra-empresa",
            },
        });
        const unknownMarketplace = await fetch(`${baseUrl}/api/public/products?skip=1&take=1`, {
            headers: {
                "x-tenant-slug": "otra-empresa",
            },
        });
        const blockedLogins: Response[] = [];
        for (const tenantSlug of [
            `http-suspended-${tag}`,
            `http-inactive-${tag}`,
        ]) {
            blockedLogins.push(await fetch(`${baseUrl}/api/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    email: "admin@example.com",
                    password: envs.SEED_DEMO_PASSWORD,
                    tenantSlug,
                }),
            }));
        }

        if (context.tenant?.slug !== "legacy-main") {
            throw new Error("El contexto HTTP no resolvio legacy-main");
        }
        if (wrongTenant.status !== 403) {
            throw new Error(`Header tenant cruzado devolvio ${wrongTenant.status}, se esperaba 403`);
        }
        if (unknownMarketplace.status !== 404) {
            throw new Error(`Marketplace desconocido devolvio ${unknownMarketplace.status}, se esperaba 404`);
        }
        if (blockedLogins[0]?.status !== 200 || blockedLogins[1]?.status !== 403) {
            throw new Error(
                `Accesos suspendido/inactivo devolvieron ${blockedLogins.map((response) => response.status).join("/")}, se esperaba 200/403`,
            );
        }

        console.info("[tenant-http] READY");
        console.info(`[tenant-http] Health: ${health.status}`);
        console.info(`[tenant-http] Tenant autenticado: ${context.tenant.slug}`);
        console.info(`[tenant-http] Productos autenticados: ${Array.isArray(products.data) ? products.data.length : 0}`);
        console.info(`[tenant-http] Tiendas autenticadas: ${Array.isArray(stores) ? stores.length : 0}`);
        console.info(`[tenant-http] Usuarios autenticados: ${Array.isArray(users.data) ? users.data.length : Array.isArray(users) ? users.length : 0}`);
        console.info(`[tenant-http] Productos marketplace: ${Array.isArray(publicProducts.data) ? publicProducts.data.length : 0}`);
        console.info(`[tenant-http] Header cruzado: ${wrongTenant.status}`);
        console.info(`[tenant-http] Marketplace desconocido: ${unknownMarketplace.status}`);
        console.info(`[tenant-http] Tenant suspendido / membresia inactiva: ${blockedLogins.map((response) => response.status).join("/")}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await platformPrisma.tenantMembership.deleteMany({
            where: { tenantId: { in: temporaryTenantIds } },
        }).catch(() => undefined);
        await platformPrisma.tenant.deleteMany({
            where: { id: { in: temporaryTenantIds } },
        }).catch(() => undefined);
    }
}

main()
    .catch((error) => {
        console.error("[tenant-http] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
