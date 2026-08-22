import { KMSClient } from "@aws-sdk/client-kms";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { KmsEnvelopeSecretProtector } from "../src/modules/sunat/infrastructure/providers/kms-envelope-secret-protector";
import { S3DocumentStorage } from "../src/modules/sunat/infrastructure/providers/s3-document-storage";
import { documentStorageContract } from "./contracts/document-storage.contract";
import { secretProtectorContract } from "./contracts/secret-protector.contract";

const enabled = process.env.RUN_AWS_STAGING_TESTS === "true";
const region = process.env.AWS_REGION ?? "us-east-1";
const bucket = process.env.SUNAT_S3_BUCKET ?? "";
const artifactKey = process.env.SUNAT_S3_KMS_KEY_ID ?? "";
const envelopeKey = process.env.SUNAT_KMS_KEY_ID ?? "";

documentStorageContract("AWS staging", () => {
    const client = new S3Client({ region });
    const storage = new S3DocumentStorage({ client, bucket, sseKmsKeyId: artifactKey });
    return {
        storage,
        async tamper(input: { tenantId: string; relativeKey: string; body: Buffer }) {
            await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `tenants/${input.tenantId}/${input.relativeKey}`,
                Body: input.body,
                ServerSideEncryption: "aws:kms",
                SSEKMSKeyId: artifactKey,
            }));
        },
        async download(url: string) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`AWS signed download failed: ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        },
        dispose: () => client.destroy(),
    };
}, { skip: !enabled });

secretProtectorContract("AWS staging", () => {
    const client = new KMSClient({ region });
    return {
        secretProtector: new KmsEnvelopeSecretProtector({ client, keyId: envelopeKey }),
        dispose: () => client.destroy(),
    };
}, { skip: !enabled });
