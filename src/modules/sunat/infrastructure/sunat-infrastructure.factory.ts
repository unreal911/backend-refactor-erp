import { KMSClient } from "@aws-sdk/client-kms";
import { S3Client } from "@aws-sdk/client-s3";
import { DocumentStorage } from "./ports/document-storage.port";
import { SecretProtector } from "./ports/secret-protector.port";
import { KmsEnvelopeSecretProtector } from "./providers/kms-envelope-secret-protector";
import { S3DocumentStorage } from "./providers/s3-document-storage";
import {
    loadSunatInfrastructureConfig,
    SunatInfrastructureConfig,
    validateSunatInfrastructureConfig,
} from "./sunat-infrastructure.config";

export interface SunatInfrastructure {
    documentStorage: DocumentStorage;
    secretProtector: SecretProtector;
    destroy(): void;
}

function credentialsFor(config: SunatInfrastructureConfig):
    | { accessKeyId: string; secretAccessKey: string }
    | undefined {
    if (config.accessKeyId && config.secretAccessKey) {
        return {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        };
    }
    if (config.cloudMode === "moto") {
        return {
            accessKeyId: "test",
            secretAccessKey: "test",
        };
    }
    return undefined;
}

export function createSunatInfrastructure(
    config: SunatInfrastructureConfig = loadSunatInfrastructureConfig(),
): SunatInfrastructure {
    validateSunatInfrastructureConfig(config);
    const credentials = credentialsFor(config);
    const sharedClientOptions = {
        region: config.region,
        ...(config.endpointUrl ? { endpoint: config.endpointUrl } : {}),
        ...(credentials ? { credentials } : {}),
    };

    const s3Client = new S3Client({
        ...sharedClientOptions,
        forcePathStyle: config.forcePathStyle,
    });
    const kmsClient = new KMSClient(sharedClientOptions);

    return {
        documentStorage: new S3DocumentStorage({
            client: s3Client,
            bucket: config.bucket,
            ...(config.s3KmsKeyId ? { sseKmsKeyId: config.s3KmsKeyId } : {}),
        }),
        secretProtector: new KmsEnvelopeSecretProtector({
            client: kmsClient,
            keyId: config.envelopeKmsKeyId,
        }),
        destroy(): void {
            s3Client.destroy();
            kmsClient.destroy();
        },
    };
}
