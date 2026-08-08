import { platformPrisma } from "../data/platform-prisma";
import { runTenantDatabaseTransaction } from "../data/prisma";
import { tenantPrisma } from "../data/tenant-prisma";
import {
    getSunatSecretServiceFromEnvironment,
    isKmsSecretWritingEnabled,
    isKmsSunatSecret,
    destroySharedSunatSecretInfrastructure,
} from "../modules/sunat/config/sunat-secret.service";
import { SecretPurpose } from "../modules/sunat/infrastructure/ports/secret-protector.port";

type SecretField = "solPasswordEnc" | "certP12Enc" | "certPasswordEnc";
const FIELDS: Array<{ field: SecretField; purpose: SecretPurpose }> = [
    { field: "solPasswordEnc", purpose: "SOL_PASSWORD" },
    { field: "certP12Enc", purpose: "PFX" },
    { field: "certPasswordEnc", purpose: "PFX_PASSWORD" },
];

function requestedTenantId(): string | undefined {
    const position = process.argv.indexOf("--tenant");
    const value = position >= 0 ? process.argv[position + 1]?.trim() : undefined;
    if (value && !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("--tenant requiere un UUID válido");
    return value;
}

async function main(): Promise<void> {
    if (!isKmsSecretWritingEnabled()) {
        throw new Error("Activa SUNAT_KMS_SECRETS_ENABLED=true para ejecutar el migrador");
    }
    const tenantId = requestedTenantId();
    const tenants = await platformPrisma.sunatEmisorConfig.findMany({
        ...(tenantId ? { where: { tenantId } } : {}),
        select: { tenantId: true },
        orderBy: { tenantId: "asc" },
    });
    let migrated = 0;
    let alreadyV2 = 0;

    for (const tenant of tenants) {
        await runTenantDatabaseTransaction(tenant.tenantId, async () => {
            const row = await tenantPrisma.sunatEmisorConfig.findUniqueOrThrow({
                where: { tenantId: tenant.tenantId },
            });
            const secrets = getSunatSecretServiceFromEnvironment();
            for (const descriptor of FIELDS) {
                const current = row[descriptor.field];
                if (!current) continue;
                if (isKmsSunatSecret(current)) {
                    await secrets.open(current, descriptor.purpose);
                    alreadyV2 += 1;
                    continue;
                }
                const next = await secrets.migrateAndVerify(current, descriptor.purpose);
                const changed = await tenantPrisma.sunatEmisorConfig.updateMany({
                    where: {
                        id: row.id,
                        tenantId: tenant.tenantId,
                        [descriptor.field]: current,
                    },
                    data: { [descriptor.field]: next },
                });
                if (changed.count !== 1) throw new Error("El secreto cambió durante la migración; reintenta el tenant");
                migrated += 1;
            }
        });
        console.log(`[sunat-secret-migration] tenant=${tenant.tenantId} status=verified`);
    }
    console.log(JSON.stringify({ tenants: tenants.length, migrated, alreadyV2 }));
}

void main()
    .catch((caught) => {
        console.error("[sunat-secret-migration]", caught instanceof Error ? caught.message : "migration failed");
        process.exitCode = 1;
    })
    .finally(async () => {
        destroySharedSunatSecretInfrastructure();
        await platformPrisma.$disconnect();
    });
