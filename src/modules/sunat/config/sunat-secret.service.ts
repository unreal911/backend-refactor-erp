import { timingSafeEqual } from "node:crypto";
import { TenantDataContext } from "../../tenant/tenant-data-context";
import { SecretProtector, SecretPurpose } from "../infrastructure/ports/secret-protector.port";
import { createSunatInfrastructure, SunatInfrastructure } from "../infrastructure/sunat-infrastructure.factory";
import { decryptSecret, isSunatEncryptionConfigured } from "./sunat-crypto";

const V1_PREFIX = "v1.";
const V2_PREFIX = "v2.kms.";

export function isKmsSecretWritingEnabled(
    source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
    return ["1", "true", "yes", "on"].includes(
        String(source.SUNAT_KMS_SECRETS_ENABLED ?? "").trim().toLowerCase(),
    );
}

export function isLegacySunatSecret(payload: string | null | undefined): boolean {
    return Boolean(payload?.startsWith(V1_PREFIX));
}

export function isKmsSunatSecret(payload: string | null | undefined): boolean {
    return Boolean(payload?.startsWith(V2_PREFIX));
}

export class SunatSecretService {
    constructor(private readonly protector: SecretProtector | null) {}

    canWrite(): boolean {
        return this.protector !== null;
    }

    async seal(plaintext: string | Buffer, purpose: SecretPurpose): Promise<string> {
        if (!this.protector) {
            throw new Error("SUNAT_KMS_SECRETS_ENABLED requiere infraestructura KMS configurada");
        }
        const tenantId = TenantDataContext.requireTenantId();
        const bytes = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
        return this.protector.seal({ tenantId, purpose, plaintext: bytes });
    }

    async open(payload: string, purpose: SecretPurpose): Promise<Buffer> {
        const tenantId = TenantDataContext.requireTenantId();
        if (isKmsSunatSecret(payload)) {
            if (!this.protector) {
                throw new Error("No existe un proveedor KMS disponible para abrir el secreto SUNAT v2");
            }
            return this.protector.open({ tenantId, purpose, payload });
        }
        if (isLegacySunatSecret(payload)) {
            return decryptSecret(payload);
        }
        throw new Error("Formato de secreto SUNAT no soportado");
    }

    async openString(payload: string, purpose: SecretPurpose): Promise<string> {
        return (await this.open(payload, purpose)).toString("utf8");
    }

    async migrateAndVerify(payload: string, purpose: SecretPurpose): Promise<string> {
        if (isKmsSunatSecret(payload)) {
            await this.open(payload, purpose);
            return payload;
        }
        const plaintext = await this.open(payload, purpose);
        try {
            const migrated = await this.seal(plaintext, purpose);
            const verified = await this.open(migrated, purpose);
            try {
                if (
                    plaintext.length !== verified.length
                    || !timingSafeEqual(plaintext, verified)
                ) {
                    throw new Error("La verificación del secreto SUNAT v2 no coincide");
                }
            } finally {
                verified.fill(0);
            }
            return migrated;
        } finally {
            plaintext.fill(0);
        }
    }
}

let sharedInfrastructure: SunatInfrastructure | null = null;
let sharedService: SunatSecretService | null = null;

export function getSunatSecretServiceFromEnvironment(): SunatSecretService {
    if (!sharedService) {
        if (isKmsSecretWritingEnabled()) {
            sharedInfrastructure = createSunatInfrastructure();
            sharedService = new SunatSecretService(sharedInfrastructure.secretProtector);
        } else {
            sharedService = new SunatSecretService(null);
        }
    }
    return sharedService;
}

export function isAnySunatSecretEncryptionConfigured(): boolean {
    return isKmsSecretWritingEnabled() || isSunatEncryptionConfigured();
}

export function destroySharedSunatSecretInfrastructure(): void {
    sharedInfrastructure?.destroy();
    sharedInfrastructure = null;
    sharedService = null;
}
