export interface PutDocumentInput {
    tenantId: string;
    relativeKey: string;
    body: Buffer;
    contentType: string;
    expectedSha256?: string;
    metadata?: Record<string, string>;
}

export interface GetDocumentInput {
    tenantId: string;
    relativeKey: string;
    expectedSha256?: string;
}

export interface HeadDocumentInput {
    tenantId: string;
    relativeKey: string;
}

export interface CreateDownloadUrlInput {
    tenantId: string;
    relativeKey: string;
    expiresInSeconds?: number;
    responseContentType?: string;
    responseContentDisposition?: string;
}

export interface StoredObjectInfo {
    provider: "s3";
    bucket: string;
    objectKey: string;
    byteSize: number;
    sha256: string;
    contentType?: string;
    etag?: string;
    versionId?: string;
}

/**
 * Almacenamiento privado de artefactos SUNAT.
 *
 * No expone delete deliberadamente: la eliminación fiscal/por retención será
 * un proceso separado, autorizado y auditable.
 */
export interface DocumentStorage {
    put(input: PutDocumentInput): Promise<StoredObjectInfo>;
    get(input: GetDocumentInput): Promise<Buffer>;
    head(input: HeadDocumentInput): Promise<StoredObjectInfo | null>;
    createDownloadUrl(input: CreateDownloadUrlInput): Promise<string>;
}
