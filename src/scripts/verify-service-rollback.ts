import { createHash } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { platformPrisma } from "../data/platform-prisma";
import { AppRouter } from "../presentation/routes";
import { createExpressApp } from "../presentation/server";

type TableNameRow = { tableName: string };
type TableFingerprintRow = { count: bigint; digest: string };

function safeIdentifier(value: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Identificador SQL no permitido");
    return value;
}

async function fingerprintDatabase(): Promise<{
    sha256: string;
    tables: Array<{ name: string; rows: number; digest: string }>;
}> {
    const descriptors = await platformPrisma.$queryRawUnsafe<TableNameRow[]>(`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `);
    const tables: Array<{ name: string; rows: number; digest: string }> = [];
    for (const descriptor of descriptors) {
        const tableName = safeIdentifier(descriptor.tableName);
        const rows = await platformPrisma.$queryRawUnsafe<TableFingerprintRow[]>(`
            SELECT
                COUNT(*)::bigint AS count,
                md5(COALESCE(string_agg(md5(to_jsonb(source_row)::text), '' ORDER BY md5(to_jsonb(source_row)::text)), '')) AS digest
            FROM "${tableName}" AS source_row
        `);
        tables.push({
            name: tableName,
            rows: Number(rows[0]?.count ?? 0n),
            digest: String(rows[0]?.digest ?? ""),
        });
    }
    return {
        sha256: createHash("sha256").update(JSON.stringify(tables)).digest("hex"),
        tables,
    };
}

async function readJson(response: Response): Promise<Record<string, any>> {
    const body = await response.json() as Record<string, any>;
    if (!response.ok) throw new Error(`HTTP_${response.status}:${String(body.message || body.error || "error")}`);
    return body;
}

async function main(): Promise<void> {
    if (process.env.ROLLBACK_CONFIRM !== "READ_ONLY_SOURCE") {
        throw new Error("Exige ROLLBACK_CONFIRM=READ_ONLY_SOURCE");
    }
    const responsible = String(process.env.ROLLBACK_RESPONSIBLE || "").trim();
    if (!responsible) throw new Error("ROLLBACK_RESPONSIBLE requerido para el acta");
    const readOnly = await platformPrisma.$queryRawUnsafe<Array<{ transactionReadOnly: string }>>(
        `SELECT current_setting('transaction_read_only') AS "transactionReadOnly"`,
    );
    if (String(readOnly[0]?.transactionReadOnly || "").toLowerCase() !== "on") {
        throw new Error("La conexion de rollback debe imponer transaction_read_only=on");
    }

    const email = String(process.env.ROLLBACK_LOGIN_EMAIL || "admin@example.com").trim();
    const password = String(process.env.ROLLBACK_LOGIN_PASSWORD || process.env.SEED_DEMO_PASSWORD || "");
    const tenantSlug = String(process.env.ROLLBACK_TENANT_SLUG || "legacy-main").trim();
    if (!email || !password || !tenantSlug) {
        throw new Error("Faltan credenciales de smoke o ROLLBACK_TENANT_SLUG");
    }

    const before = await fingerprintDatabase();
    const app = createExpressApp({ routes: AppRouter.router });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const checks: Record<string, unknown> = {};
    try {
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;
        checks.health = (await readJson(await fetch(`${baseUrl}/api/health`))).status;
        checks.ready = (await readJson(await fetch(`${baseUrl}/api/ready`))).status;
        const login = await readJson(await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password, tenantSlug }),
        }));
        const token = String(login.token || "");
        if (!token) throw new Error("LOGIN_WITHOUT_TOKEN");
        const authorization = `Bearer ${token}`;
        const context = await readJson(await fetch(`${baseUrl}/api/tenant/context`, {
            headers: { authorization },
        }));
        if (context.tenant?.slug !== tenantSlug) throw new Error("TENANT_CONTEXT_MISMATCH");
        const products = await readJson(await fetch(`${baseUrl}/api/products?skip=1&take=3`, {
            headers: { authorization },
        }));
        const publicProducts = await readJson(await fetch(`${baseUrl}/api/public/products?skip=1&take=3`, {
            headers: { "x-tenant-slug": tenantSlug },
        }));
        checks.login = "ok";
        checks.tenantId = context.tenant.id;
        checks.authenticatedReadRows = Array.isArray(products.data) ? products.data.length : 0;
        checks.publicReadRows = Array.isArray(publicProducts.data) ? publicProducts.data.length : 0;
    } finally {
        await new Promise<void>((resolve, reject) => (
            server.close((error) => error ? reject(error) : resolve())
        ));
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await fingerprintDatabase();
    const unchanged = before.sha256 === after.sha256;
    const report = {
        story: "MIG-012",
        check: "READ_ONLY_SOURCE_SERVICE_ROLLBACK",
        executedAt: new Date().toISOString(),
        responsible,
        sourceFingerprintBefore: before.sha256,
        sourceFingerprintAfter: after.sha256,
        sourceUnchanged: unchanged,
        tableCount: before.tables.length,
        checks,
        result: unchanged ? "PASSED" : "FAILED_SOURCE_CHANGED",
    };
    const reportDirectory = path.resolve("reports", "mig-012");
    fs.mkdirSync(reportDirectory, { recursive: true });
    const runId = String(process.env.ROLLBACK_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-"))
        .replace(/[^A-Za-z0-9._-]/g, "-");
    const reportFile = path.join(reportDirectory, `rollback-${runId}.json`);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ reportFile, result: report.result, sourceFingerprint: before.sha256 }));
    if (!unchanged) process.exitCode = 1;
}

void main()
    .catch((caught) => {
        console.error("[rollback]", caught instanceof Error ? caught.message : "rollback verification failed");
        process.exitCode = 1;
    })
    .finally(() => platformPrisma.$disconnect());
