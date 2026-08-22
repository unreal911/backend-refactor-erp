import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { OperationalMetrics } from "../../../operations/operational-metrics";
import {
    DeleteRetainedDocumentInput,
    DocumentRetention,
} from "../ports/document-retention.port";

const TENANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const KEY_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._=-]{0,254}$/;

function safe(value: string, pattern: RegExp, label: string): string {
    const normalized = value.trim();
    if (!pattern.test(normalized)) throw new Error(`${label} inválido para retención SUNAT`);
    return normalized;
}

function relativeKey(value: string): string {
    const segments = value.split("/");
    if (!value || value.startsWith("/") || value.includes("\\") || segments.some((part) => !KEY_SEGMENT_PATTERN.test(part))) {
        throw new Error("relativeKey inválida para retención SUNAT");
    }
    return segments.join("/");
}

export class S3DocumentRetention implements DocumentRetention {
    constructor(
        private readonly client: S3Client,
        private readonly bucket: string,
        private readonly rootPrefix = "tenants",
    ) {}

    async delete(input: DeleteRetainedDocumentInput): Promise<void> {
        const tenantId = safe(input.tenantId, TENANT_ID_PATTERN, "tenantId");
        const key = `${safe(this.rootPrefix, KEY_SEGMENT_PATTERN, "rootPrefix")}/${tenantId}/${relativeKey(input.relativeKey)}`;
        await OperationalMetrics.measureDependency("S3", "delete", () => (
            this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
        ));
    }
}
