import crypto from "node:crypto";
import {
    CreateDownloadUrlInput,
    DocumentStorage,
    GetDocumentInput,
    HeadDocumentInput,
    PutDocumentInput,
    StoredObjectInfo,
} from "../../src/modules/sunat/infrastructure/ports/document-storage.port";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const TENANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const KEY_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._=-]{0,254}$/;

interface StoredRecord {
    body: Buffer;
    info: StoredObjectInfo;
}

interface DownloadGrant {
    objectKey: string;
    expiresAt: number;
}

function digest(body: Buffer): string {
    return crypto.createHash("sha256").update(body).digest("hex");
}

function tenantId(value: string): string {
    const normalized = value.trim();
    if (!TENANT_ID_PATTERN.test(normalized)) {
        throw new Error("tenantId inválido para almacenamiento fake");
    }
    return normalized;
}

function relativeKey(value: string): string {
    if (
        !value
        || value.startsWith("/")
        || value.endsWith("/")
        || value.includes("\\")
        || value.includes("\0")
    ) {
        throw new Error("relativeKey inválida para almacenamiento fake");
    }

    const segments = value.split("/");
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

function expectedSha256(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    if (!SHA256_PATTERN.test(normalized)) {
        throw new Error("expectedSha256 debe ser un SHA-256 hexadecimal");
    }
    return normalized;
}

export class InMemoryDocumentStorage implements DocumentStorage {
    private readonly records = new Map<string, StoredRecord>();
    private readonly grants = new Map<string, DownloadGrant>();
    private version = 0;

    private objectKey(inputTenantId: string, inputRelativeKey: string): string {
        return `tenants/${tenantId(inputTenantId)}/${relativeKey(inputRelativeKey)}`;
    }

    async put(input: PutDocumentInput): Promise<StoredObjectInfo> {
        const objectKey = this.objectKey(input.tenantId, input.relativeKey);
        const sha256 = digest(input.body);
        const expected = expectedSha256(input.expectedSha256);
        if (expected && expected !== sha256) {
            throw new Error("El SHA-256 esperado no coincide con el documento");
        }
        if (!input.contentType.trim()) {
            throw new Error("contentType es obligatorio");
        }

        const info: StoredObjectInfo = {
            provider: "s3",
            bucket: "fake-memory",
            objectKey,
            byteSize: input.body.byteLength,
            sha256,
            contentType: input.contentType,
            etag: sha256,
            versionId: String(++this.version),
        };
        this.records.set(objectKey, {
            body: Buffer.from(input.body),
            info,
        });
        return { ...info };
    }

    async get(input: GetDocumentInput): Promise<Buffer> {
        const record = this.records.get(this.objectKey(input.tenantId, input.relativeKey));
        if (!record) throw new Error("Documento fake no encontrado");

        const actual = digest(record.body);
        const expected = expectedSha256(input.expectedSha256);
        if (expected && expected !== actual) {
            throw new Error("El documento recuperado no coincide con su SHA-256 esperado");
        }
        if (record.info.sha256 !== actual) {
            throw new Error("El documento recuperado no coincide con su metadata SHA-256");
        }
        return Buffer.from(record.body);
    }

    async head(input: HeadDocumentInput): Promise<StoredObjectInfo | null> {
        const record = this.records.get(this.objectKey(input.tenantId, input.relativeKey));
        return record ? { ...record.info } : null;
    }

    async createDownloadUrl(input: CreateDownloadUrlInput): Promise<string> {
        const expiresIn = input.expiresInSeconds ?? 300;
        if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 900) {
            throw new Error("expiresInSeconds debe estar entre 1 y 900");
        }

        const objectKey = this.objectKey(input.tenantId, input.relativeKey);
        const token = crypto.randomBytes(24).toString("base64url");
        this.grants.set(token, {
            objectKey,
            expiresAt: Date.now() + expiresIn * 1000,
        });
        return `memory://download/${token}`;
    }

    async download(signedUrl: string): Promise<Buffer> {
        const parsed = new URL(signedUrl);
        if (parsed.protocol !== "memory:") {
            throw new Error("URL fake inválida");
        }

        const token = parsed.pathname.replace(/^\/+/, "");
        const grant = this.grants.get(token);
        if (!grant || grant.expiresAt < Date.now()) {
            throw new Error("URL fake vencida o inválida");
        }

        const record = this.records.get(grant.objectKey);
        if (!record) throw new Error("Documento fake no encontrado");
        return Buffer.from(record.body);
    }

    async tamper(input: {
        tenantId: string;
        relativeKey: string;
        body: Buffer;
    }): Promise<void> {
        const objectKey = this.objectKey(input.tenantId, input.relativeKey);
        const record = this.records.get(objectKey);
        if (!record) throw new Error("Documento fake no encontrado");
        record.body = Buffer.from(input.body);
    }
}
