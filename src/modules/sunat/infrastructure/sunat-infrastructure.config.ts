export type CloudMode = "moto" | "aws";
export type SunatRuntimeEnvironment = "development" | "test" | "production";

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface SunatInfrastructureConfig {
    runtimeEnvironment: SunatRuntimeEnvironment;
    cloudMode: CloudMode;
    region: string;
    endpointUrl?: string;
    forcePathStyle: boolean;
    bucket: string;
    envelopeKmsKeyId: string;
    s3KmsKeyId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
}

function parseRuntimeEnvironment(raw: string | undefined): SunatRuntimeEnvironment {
    const normalized = (raw ?? "development").trim().toLowerCase();
    if (normalized === "production" || normalized === "test" || normalized === "development") {
        return normalized;
    }
    return "development";
}

function parseCloudMode(raw: string | undefined, runtime: SunatRuntimeEnvironment): CloudMode {
    const fallback: CloudMode = runtime === "production" ? "aws" : "moto";
    const normalized = (raw ?? fallback).trim().toLowerCase();
    if (normalized === "aws" || normalized === "moto") return normalized;
    throw new Error(`CLOUD_MODE inválido: ${normalized || "(vacío)"}`);
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined || raw.trim() === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    throw new Error(`Valor booleano inválido: ${raw}`);
}

export function isSunatDocumentStorageEnabled(source: EnvironmentSource = process.env): boolean {
    return parseBoolean(source.SUNAT_DOCUMENT_STORAGE_ENABLED, false);
}

function optional(raw: string | undefined): string | undefined {
    const normalized = raw?.trim();
    return normalized ? normalized : undefined;
}

function required(name: string, value: string | undefined): string {
    if (!value) throw new Error(`${name} es obligatorio para la infraestructura SUNAT`);
    return value;
}

export function validateSunatInfrastructureConfig(config: SunatInfrastructureConfig): void {
    if (Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey)) {
        throw new Error(
            "AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY deben configurarse juntos",
        );
    }

    if (config.runtimeEnvironment === "production" && config.cloudMode === "moto") {
        throw new Error("CLOUD_MODE=moto está prohibido en producción");
    }

    if (config.cloudMode === "moto") {
        if (!config.endpointUrl) {
            throw new Error("AWS_ENDPOINT_URL es obligatorio cuando CLOUD_MODE=moto");
        }
        if (!config.forcePathStyle) {
            throw new Error("S3_FORCE_PATH_STYLE debe estar activo cuando CLOUD_MODE=moto");
        }
    }

    if (config.runtimeEnvironment === "production") {
        if (config.endpointUrl) {
            throw new Error("AWS_ENDPOINT_URL debe estar vacío en producción");
        }
        if (config.forcePathStyle) {
            throw new Error("S3_FORCE_PATH_STYLE debe estar desactivado en producción");
        }
        required("SUNAT_S3_KMS_KEY_ID", config.s3KmsKeyId);
    }

    required("AWS_REGION", config.region);
    required("SUNAT_S3_BUCKET", config.bucket);
    required("SUNAT_KMS_KEY_ID", config.envelopeKmsKeyId);
}

export function loadSunatInfrastructureConfig(
    source: EnvironmentSource = process.env,
): SunatInfrastructureConfig {
    const runtimeEnvironment = parseRuntimeEnvironment(source.NODE_ENV);
    const cloudMode = parseCloudMode(source.CLOUD_MODE, runtimeEnvironment);
    const endpointUrl = optional(source.AWS_ENDPOINT_URL)
        ?? (cloudMode === "moto" ? "http://127.0.0.1:5000" : undefined);
    const defaultBucket = runtimeEnvironment === "production" ? undefined : "sunat-dev";
    const defaultKeyId = runtimeEnvironment === "production" ? undefined : "alias/sunat-dev";
    const s3KmsKeyId = optional(source.SUNAT_S3_KMS_KEY_ID);
    const accessKeyId = optional(source.AWS_ACCESS_KEY_ID);
    const secretAccessKey = optional(source.AWS_SECRET_ACCESS_KEY);

    const base = {
        runtimeEnvironment,
        cloudMode,
        region: optional(source.AWS_REGION) ?? "us-east-1",
        forcePathStyle: parseBoolean(source.S3_FORCE_PATH_STYLE, cloudMode === "moto"),
        bucket: required("SUNAT_S3_BUCKET", optional(source.SUNAT_S3_BUCKET) ?? defaultBucket),
        envelopeKmsKeyId: required(
            "SUNAT_KMS_KEY_ID",
            optional(source.SUNAT_KMS_KEY_ID) ?? defaultKeyId,
        ),
    } satisfies Omit<
        SunatInfrastructureConfig,
        "endpointUrl" | "s3KmsKeyId" | "accessKeyId" | "secretAccessKey"
    >;

    const config: SunatInfrastructureConfig = {
        ...base,
        ...(endpointUrl ? { endpointUrl } : {}),
        ...(s3KmsKeyId ? { s3KmsKeyId } : {}),
        ...(accessKeyId ? { accessKeyId } : {}),
        ...(secretAccessKey ? { secretAccessKey } : {}),
    };

    validateSunatInfrastructureConfig(config);
    return config;
}
