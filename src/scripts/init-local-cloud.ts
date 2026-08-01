import "dotenv/config";
import {
    CreateAliasCommand,
    CreateKeyCommand,
    KMSClient,
    ListAliasesCommand,
} from "@aws-sdk/client-kms";
import {
    CreateBucketCommand,
    HeadBucketCommand,
    PutBucketVersioningCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { loadSunatInfrastructureConfig } from "../modules/sunat/infrastructure/sunat-infrastructure.config";

function isMissingBucket(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
    };
    return (
        candidate.name === "NotFound"
        || candidate.name === "NoSuchBucket"
        || candidate.$metadata?.httpStatusCode === 404
    );
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
    try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
        if (!isMissingBucket(error)) throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }

    await client.send(
        new PutBucketVersioningCommand({
            Bucket: bucket,
            VersioningConfiguration: { Status: "Enabled" },
        }),
    );
}

async function ensureKmsAlias(client: KMSClient, aliasName: string): Promise<void> {
    if (!aliasName.startsWith("alias/")) {
        throw new Error("SUNAT_KMS_KEY_ID local debe ser un alias con prefijo alias/");
    }

    let marker: string | undefined;
    do {
        const result = await client.send(
            new ListAliasesCommand({
                ...(marker ? { Marker: marker } : {}),
                Limit: 100,
            }),
        );
        if (result.Aliases?.some((alias) => alias.AliasName === aliasName)) return;
        marker = result.Truncated ? result.NextMarker : undefined;
    } while (marker);

    const key = await client.send(
        new CreateKeyCommand({
            Description: "Clave local desechable para pruebas SUNAT con Moto",
            KeyUsage: "ENCRYPT_DECRYPT",
            KeySpec: "SYMMETRIC_DEFAULT",
            Tags: [
                { TagKey: "environment", TagValue: "local" },
                { TagKey: "managed-by", TagValue: "proyecto-tienda" },
            ],
        }),
    );
    const keyId = key.KeyMetadata?.KeyId;
    if (!keyId) throw new Error("Moto KMS no devolvió KeyId");

    await client.send(
        new CreateAliasCommand({
            AliasName: aliasName,
            TargetKeyId: keyId,
        }),
    );
}

async function main(): Promise<void> {
    const config = loadSunatInfrastructureConfig();
    if (config.cloudMode !== "moto" || config.runtimeEnvironment === "production") {
        throw new Error("Este script solo puede ejecutarse contra Moto fuera de producción");
    }

    const credentials = {
        accessKeyId: config.accessKeyId ?? "test",
        secretAccessKey: config.secretAccessKey ?? "test",
    };
    const clientOptions = {
        region: config.region,
        credentials,
        ...(config.endpointUrl ? { endpoint: config.endpointUrl } : {}),
    };
    const s3 = new S3Client({
        ...clientOptions,
        forcePathStyle: true,
    });
    const kms = new KMSClient(clientOptions);

    try {
        await ensureBucket(s3, config.bucket);
        await ensureKmsAlias(kms, config.envelopeKmsKeyId);
        console.info(`[cloud-local] Bucket listo: ${config.bucket}`);
        console.info(`[cloud-local] Alias KMS listo: ${config.envelopeKmsKeyId}`);
        console.info("[cloud-local] Entorno Moto inicializado con datos desechables");
    } finally {
        s3.destroy();
        kms.destroy();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cloud-local] Error: ${message}`);
    process.exitCode = 1;
});
