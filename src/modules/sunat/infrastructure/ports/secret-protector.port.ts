export type SecretPurpose =
    | "PFX"
    | "PFX_PASSWORD"
    | "SOL_PASSWORD"
    | "TENANT_DATABASE_CREDENTIAL";

export interface SealSecretInput {
    tenantId: string;
    purpose: SecretPurpose;
    plaintext: Buffer;
}

export interface OpenSecretInput {
    tenantId: string;
    purpose: SecretPurpose;
    payload: string;
}

/**
 * Cifra secretos mediante un formato opaco y versionado.
 *
 * La implementación productiva utiliza KMS para proteger una data key única y
 * AES-256-GCM para cifrar el contenido dentro del backend.
 */
export interface SecretProtector {
    seal(input: SealSecretInput): Promise<string>;
    open(input: OpenSecretInput): Promise<Buffer>;
}
