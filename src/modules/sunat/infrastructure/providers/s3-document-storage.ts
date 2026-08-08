import crypto from "node:crypto";
import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { OperationalMetrics } from "../../../operations/operational-metrics";
import {
    CreateDownloadUrlInput,
    DocumentStorage,
    GetDocumentInput,
    HeadDocumentInput,
    PutDocumentInput,
    StoredObjectInfo,
} from "../ports/document-storage.port";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const TENANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const KEY_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._=-]{0,254}$/;
const METADATA_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface S3DocumentStorageOptions {
    client: S3Client;
    bucket: string;
    rootPrefix?: string;
    sseKmsKeyId?: string;
}

function sha256(body: Buffer): string {
    return crypto.createHash("sha256").update(body).digest("hex");
}

function normalizeEtag(etag: string | undefined): string | undefined {
    return etag?.replace(/^"|"$/g, "");
}

function assertTenantId(tenantId: string): string {
    const normalized = tenantId.trim();
    if (!TENANT_ID_PATTERN.test(normalized)) {
        throw new Error("tenantId inválido para almacenamiento SUNAT");
    }
    return normalized;
}

function assertRelativeKey(relativeKey: string): string {
    if (
        !relativeKey
        || relativeKey.startsWith("/")
        || relativeKey.endsWith("/")
        || relativeKey.includes("\\")
        || relativeKey.includes("\0")
    ) {
        throw new Error("relativeKey inválida para almacenamiento SUNAT");
    }

    const segments = relativeKey.split("/");
    if (
        segments.some(
            (segment) =>
                segment === ""
                || segment === "."
                || segment === ".."
                || !KEY_SEGMENT_PATTERN.test(segment),
        )
    ) {
        throw new Error("relativeKey contiene segmentos no permitidos");
    }
    return segments.join("/");
}

function assertRootPrefix(rootPrefix: string): string {
    return assertRelativeKey(rootPrefix).replace(/\/+$/g, "");
}

function assertExpectedSha256(expected: string | undefined): string | undefined {
    if (expected === undefined) return undefined;
    const normalized = expected.trim().toLowerCase();
    if (!SHA256_PATTERN.test(normalized)) {
        throw new Error("expectedSha256 debe ser un SHA-256 hexadecimal");
    }
    return normalized;
}

function buildMetadata(
    metadata: Record<string, string> | undefined,
    tenantId: string,
    digest: string,
): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(metadata ?? {})) {
        const key = rawKey.trim().toLowerCase();
        if (!METADATA_KEY_PATTERN.test(key)) {
            throw new Error(`Metadata S3 inválida: ${rawKey}`);
        }
        if (/[\r\n\0]/.test(rawValue)) {
            throw new Error(`Valor de metadata S3 inválido: ${rawKey}`);
        }
        safe[key] = rawValue;
    }

    // Los valores reservados siempre los decide el backend.
    safe["tenant-id"] = tenantId;
    safe.sha256 = digest;
    return safe;
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
    };
    return (
        candidate.name === "NotFound"
        || candidate.name === "NoSuchKey"
        || candidate.Code === "NotFound"
        || candidate.Code === "NoSuchKey"
        || candidate.$metadata?.httpStatusCode === 404
    );
}

export class S3DocumentStorage implements DocumentStorage {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly rootPrefix: string;
    private readonly sseKmsKeyId: string | undefined;

    constructor(options: S3DocumentStorageOptions) {
        this.client = options.client;
        this.bucket = options.bucket.trim();
        this.rootPrefix = assertRootPrefix(options.rootPrefix ?? "tenants");
        this.sseKmsKeyId = options.sseKmsKeyId?.trim() || undefined;

        if (!this.bucket) throw new Error("El bucket S3 es obligatorio");
    }

    private objectKey(tenantId: string, relativeKey: string): string {
        return `${this.rootPrefix}/${assertTenantId(tenantId)}/${assertRelativeKey(relativeKey)}`;
    }

    async put(input: PutDocumentInput): Promise<StoredObjectInfo> {
        const tenantId = assertTenantId(input.tenantId);
        const objectKey = this.objectKey(tenantId, input.relativeKey);
        const digest = sha256(input.body);
        const expected = assertExpectedSha256(input.expectedSha256);

        if (expected && expected !== digest) {
            throw new Error("El SHA-256 esperado no coincide con el documento");
        }
        if (!input.contentType.trim()) {
            throw new Error("contentType es obligatorio");
        }

        const response = await OperationalMetrics.measureDependency("S3", "put", () => (
            this.client.send(new PutObjectCommand({
                Bucket: this.bucket,
                Key: objectKey,
                Body: input.body,
                ContentType: input.contentType,
                Metadata: buildMetadata(input.metadata, tenantId, digest),
                ...(this.sseKmsKeyId
                    ? {
                        ServerSideEncryption: "aws:kms" as const,
                        SSEKMSKeyId: this.sseKmsKeyId,
                    }
                    : {}),
            }))
        ));

        const etag = normalizeEtag(response.ETag);
        return {
            provider: "s3",
            bucket: this.bucket,
            objectKey,
            byteSize: input.body.byteLength,
            sha256: digest,
            contentType: input.contentType,
            ...(etag ? { etag } : {}),
            ...(response.VersionId ? { versionId: response.VersionId } : {}),
        };
    }

    async get(input: GetDocumentInput): Promise<Buffer> {
        const objectKey = this.objectKey(input.tenantId, input.relativeKey);
        const response = await OperationalMetrics.measureDependency("S3", "get", () => (
            this.client.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: objectKey,
            }))
        ));
        if (!response.Body) {
            throw new Error("S3 devolvió un documento sin contenido");
        }

        const body = Buffer.from(await response.Body.transformToByteArray());
        const digest = sha256(body);
        const expected = assertExpectedSha256(input.expectedSha256);
        const storedDigest = response.Metadata?.sha256?.toLowerCase();

        if (expected && expected !== digest) {
            throw new Error("El documento recuperado no coincide con su SHA-256 esperado");
        }
        if (storedDigest && storedDigest !== digest) {
            throw new Error("El documento recuperado no coincide con su metadata SHA-256");
        }

        return body;
    }

    async head(input: HeadDocumentInput): Promise<StoredObjectInfo | null> {
        const objectKey = this.objectKey(input.tenantId, input.relativeKey);
        try {
            const response = await OperationalMetrics.measureDependency("S3", "head", () => (
                this.client.send(new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: objectKey,
                }))
            ));
            const digest = response.Metadata?.sha256?.toLowerCase();
            if (!digest || !SHA256_PATTERN.test(digest)) {
                throw new Error("El objeto S3 no contiene metadata SHA-256 válida");
            }

            const etag = normalizeEtag(response.ETag);
            return {
                provider: "s3",
                bucket: this.bucket,
                objectKey,
                byteSize: response.ContentLength ?? 0,
                sha256: digest,
                ...(response.ContentType ? { contentType: response.ContentType } : {}),
                ...(etag ? { etag } : {}),
                ...(response.VersionId ? { versionId: response.VersionId } : {}),
            };
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    }

    async createDownloadUrl(input: CreateDownloadUrlInput): Promise<string> {
        const expiresIn = input.expiresInSeconds ?? 300;
        if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 900) {
            throw new Error("expiresInSeconds debe estar entre 1 y 900");
        }

        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(input.tenantId, input.relativeKey),
            ...(input.responseContentType
                ? { ResponseContentType: input.responseContentType }
                : {}),
            ...(input.responseContentDisposition
                ? { ResponseContentDisposition: input.responseContentDisposition }
                : {}),
        });
        return OperationalMetrics.measureDependency("S3", "presign", () => (
            getSignedUrl(this.client, command, { expiresIn })
        ));
    }

}
