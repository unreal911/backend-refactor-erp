import { ImageProviderEnvironment, ImageProviderType, Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

const AWS_S3_PROFILE_NAME = "AWS S3 commercial images";
export type AwsS3ImageProviderConfig = { bucket: string; cdnBaseUrl: string; region: string };

export function requestedAwsS3ImageProvider(source: NodeJS.ProcessEnv = process.env): AwsS3ImageProviderConfig | null {
    if (String(source.PRODUCT_IMAGE_PROVIDER ?? "").trim().toUpperCase() !== "S3") return null;

    const bucket = String(source.PRODUCT_IMAGE_S3_BUCKET ?? "").trim();
    const cdnBaseUrl = String(source.PRODUCT_IMAGE_S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
    const region = String(source.AWS_REGION ?? "us-east-1").trim();
    if (!bucket || !cdnBaseUrl || !/^https:\/\//i.test(cdnBaseUrl)) {
        throw new Error("PRODUCT_IMAGE_PROVIDER=S3 exige PRODUCT_IMAGE_S3_BUCKET y una URL HTTPS de CloudFront en PRODUCT_IMAGE_S3_PUBLIC_BASE_URL");
    }
    return { bucket, cdnBaseUrl, region };
}

/**
 * On an explicitly opted-in AWS deployment, create the initial S3 profile once
 * and make it the upload provider. Existing profiles and later admin choices
 * are left alone on subsequent starts.
 */
export async function seedAwsS3ImageProvider(source: NodeJS.ProcessEnv = process.env): Promise<void> {
    const config = requestedAwsS3ImageProvider(source);
    if (!config) return;

    await platformPrisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('image-provider-activation', 0))`);
        const existingProfile = await tx.imageProviderProfile.findUnique({ where: { name: AWS_S3_PROFILE_NAME } });
        if (existingProfile) return;

        const current = await tx.imageProviderProfile.findFirst({ where: { isActive: true } });
        if (current) {
            await tx.imageProviderProfile.update({ where: { id: current.id }, data: { isActive: false } });
        }

        await tx.imageProviderProfile.create({
            data: {
                type: ImageProviderType.S3,
                name: AWS_S3_PROFILE_NAME,
                environment: ImageProviderEnvironment.ANY,
                secretRef: "env:AWS_REGION,PRODUCT_IMAGE_S3_BUCKET,PRODUCT_IMAGE_S3_PUBLIC_BASE_URL",
                config: {
                    bucket: config.bucket,
                    cdnBaseUrl: config.cdnBaseUrl,
                    region: config.region,
                    folder: "commercial-images",
                } as Prisma.InputJsonValue,
                isEnabled: true,
                isActive: true,
                maxUploadBytes: 10n * 1024n * 1024n,
                warningPercent: 80,
            },
        });
    });
}
