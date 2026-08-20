import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { ImageProviderProfile, ImageProviderType, Prisma } from "@prisma/client";
import { cloudinary } from "../../config/cloudinary";

export type ProviderConfig = Record<string, unknown>;
export type ImageUploadInput = { buffer: Buffer; contentType: string; key: string };
export type StoredImage = {
    provider: ImageProviderType;
    externalId: string;
    url: string;
    bytes: number;
    width: number | null;
    height: number | null;
    variants: Array<{ name: string; url: string; width?: number; height?: number }>;
};
export type ObjectInfo = { exists: boolean; bytes?: number; contentType?: string };

export interface ImageProviderAdapter {
    upload(input: ImageUploadInput): Promise<StoredImage>;
    head(externalId: string): Promise<ObjectInfo>;
    delete(externalId: string): Promise<void>;
}

export function profileConfig(profile: Pick<ImageProviderProfile, "config">): ProviderConfig {
    return profile.config && typeof profile.config === "object" && !Array.isArray(profile.config)
        ? profile.config as ProviderConfig
        : {};
}

function safeKey(value: string): string {
    return String(value || "image")
        .normalize("NFKD")
        .replace(/[^A-Za-z0-9/_-]+/g, "-")
        .replace(/\.{2,}/g, "-")
        .replace(/^\/+|\/+$/g, "")
        .slice(0, 180) || `image-${randomUUID()}`;
}

export class CloudinaryImageAdapter implements ImageProviderAdapter {
    private readonly config: ProviderConfig;
    constructor(profile: ImageProviderProfile) { this.config = profileConfig(profile); }

    async upload(input: ImageUploadInput): Promise<StoredImage> {
        const folder = safeKey(String(this.config.folder || "product_images"));
        const payload = `data:${input.contentType};base64,${input.buffer.toString("base64")}`;
        const result = await cloudinary.uploader.upload(payload, {
            folder,
            public_id: `${safeKey(input.key)}-${randomUUID()}`,
            overwrite: false,
            unique_filename: false,
            resource_type: "image",
            transformation: [{ width: 1600, height: 1600, crop: "limit", quality: "auto:good", fetch_format: "auto" }],
            eager: [
                { width: 320, height: 320, crop: "limit", quality: "auto:eco", fetch_format: "auto" },
                { width: 800, height: 800, crop: "limit", quality: "auto:good", fetch_format: "auto" },
                { width: 1600, height: 1600, crop: "limit", quality: "auto:good", fetch_format: "auto" },
            ],
            eager_async: false,
        });
        return {
            provider: ImageProviderType.CLOUDINARY,
            externalId: result.public_id,
            url: result.secure_url,
            bytes: Number(result.bytes || input.buffer.byteLength) + (Array.isArray(result.eager)
                ? result.eager.reduce((sum: number, item: any) => sum + Number(item.bytes || 0), 0)
                : 0),
            width: Number(result.width) || null,
            height: Number(result.height) || null,
            variants: Array.isArray(result.eager) ? result.eager.map((item: any, index: number) => ({
                name: ["thumbnail", "catalog", "detail"][index] || `size-${index}`,
                url: String(item.secure_url || item.url),
                ...(Number(item.width) ? { width: Number(item.width) } : {}),
                ...(Number(item.height) ? { height: Number(item.height) } : {}),
            })) : [],
        };
    }

    async head(externalId: string): Promise<ObjectInfo> {
        try {
            const result = await cloudinary.api.resource(externalId, { resource_type: "image" });
            return { exists: true, bytes: Number(result.bytes || 0), ...(result.format ? { contentType: `image/${result.format}` } : {}) };
        } catch { return { exists: false }; }
    }

    async delete(externalId: string): Promise<void> {
        await cloudinary.uploader.destroy(externalId, { resource_type: "image", invalidate: true });
    }
}

export class S3ImageAdapter implements ImageProviderAdapter {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly folder: string;
    private readonly publicBaseUrl: string;
    constructor(profile: ImageProviderProfile) {
        const config = profileConfig(profile);
        this.bucket = String(config.bucket || process.env.PRODUCT_IMAGE_S3_BUCKET || "").trim();
        if (!this.bucket) throw new Error("El perfil S3 no tiene bucket provisionado");
        const region = String(config.region || process.env.AWS_REGION || "us-east-1").trim();
        const endpoint = String(process.env.AWS_ENDPOINT_URL || "").trim() || undefined;
        this.folder = safeKey(String(config.folder || "commercial-images"));
        this.publicBaseUrl = String(config.cdnBaseUrl || process.env.PRODUCT_IMAGE_S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
        this.client = new S3Client({
            region,
            ...(endpoint ? { endpoint } : {}),
            forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase() === "true",
        });
    }

    async upload(input: ImageUploadInput): Promise<StoredImage> {
        const externalId = `${this.folder}/${safeKey(input.key)}-${randomUUID()}`;
        const sizes = [
            { name: "thumbnail", width: 320 },
            { name: "catalog", width: 800 },
            { name: "detail", width: 1600 },
        ] as const;
        const rendered = await Promise.all(sizes.map(async (size) => {
            const buffer = await sharp(input.buffer)
                .rotate()
                .resize({ width: size.width, height: size.width, fit: "inside", withoutEnlargement: true })
                .webp({ quality: size.name === "thumbnail" ? 72 : 82 })
                .toBuffer();
            const key = `${externalId}-${size.name}.webp`;
            await this.client.send(new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: "image/webp",
                CacheControl: "public,max-age=31536000,immutable",
                Metadata: { sha256: createHash("sha256").update(buffer).digest("hex") },
            }));
            const encodedKey = key.split("/").map(encodeURIComponent).join("/");
            const url = this.publicBaseUrl
                ? `${this.publicBaseUrl}/${encodedKey}`
                : `https://${this.bucket}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${encodedKey}`;
            return { name: size.name, url, bytes: buffer.byteLength };
        }));
        const detail = rendered.find((item) => item.name === "detail")!;
        return {
            provider: ImageProviderType.S3,
            externalId,
            url: detail.url,
            bytes: rendered.reduce((sum, item) => sum + item.bytes, 0),
            width: null,
            height: null,
            variants: rendered.map(({ name, url }) => ({ name, url })),
        };
    }

    async head(externalId: string): Promise<ObjectInfo> {
        if (!/\.[a-z0-9]+$/i.test(externalId)) {
            const results = await Promise.all(["thumbnail", "catalog", "detail"].map(async (name) => {
                try {
                    return await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: `${externalId}-${name}.webp` }));
                } catch { return null; }
            }));
            if (results.some((result) => !result)) return { exists: false };
            return { exists: true, bytes: results.reduce((sum, result) => sum + Number(result?.ContentLength || 0), 0), contentType: "image/webp" };
        }
        try {
            const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: externalId }));
            return { exists: true, bytes: Number(result.ContentLength || 0), ...(result.ContentType ? { contentType: result.ContentType } : {}) };
        } catch { return { exists: false }; }
    }

    async delete(externalId: string): Promise<void> {
        const keys = /\.[a-z0-9]+$/i.test(externalId)
            ? [externalId]
            : ["thumbnail", "catalog", "detail"].map((name) => `${externalId}-${name}.webp`);
        await Promise.all(keys.map((key) => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))));
    }
}

export function imageAdapter(profile: ImageProviderProfile): ImageProviderAdapter {
    if (profile.type === ImageProviderType.CLOUDINARY) return new CloudinaryImageAdapter(profile);
    if (profile.type === ImageProviderType.S3) return new S3ImageAdapter(profile);
    throw new Error("Proveedor de imágenes no soportado");
}

export function jsonVariants(value: StoredImage["variants"]): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
