import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageProviderEnvironment, ImageProviderHealthStatus, ImageProviderType, type ImageProviderProfile } from "@prisma/client";
import { cloudinary } from "../src/config/cloudinary";
import { CloudinaryImageAdapter } from "../src/modules/commercial-assets/image-provider";

const profile = {
    id: "30000000-0000-4000-8000-000000000001",
    type: ImageProviderType.CLOUDINARY,
    name: "Cloudinary test",
    environment: ImageProviderEnvironment.ANY,
    secretRef: "env:CLOUDINARY_API_KEY",
    config: { folder: "product_images" },
    isEnabled: true,
    isActive: true,
    pauseNewUploads: false,
    maxUploadBytes: 10485760n,
    warningPercent: 80,
    monthlyBudgetUsd: null,
    healthStatus: ImageProviderHealthStatus.HEALTHY,
    lastHealthMessage: null,
    lastHealthCheckedAt: null,
    createdByPlatformAdminId: null,
    updatedByPlatformAdminId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
} as ImageProviderProfile;

describe("adaptador Cloudinary 2.x", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("genera una transformación HTTPS con la API v2", () => {
        const url = cloudinary.url("product_images/demo", {
            secure: true,
            transformation: [
                {
                    width: 320,
                    height: 320,
                    crop: "fill",
                    quality: "auto",
                    fetch_format: "auto",
                },
            ],
        });

        expect(url).toContain("https://res.cloudinary.com/");
        expect(url).toContain("c_fill");
        expect(url).toContain("h_320");
        expect(url).toContain("w_320");
        expect(url).toContain("product_images/demo");
    });

    it("carga mediante el puerto de imágenes y solicita tamaños estables", async () => {
        const upload = vi.spyOn(cloudinary.uploader, "upload").mockResolvedValue({
            secure_url: "https://res.cloudinary.com/demo/image/upload/product_images/producto.jpg",
            public_id: "product_images/producto-uuid",
            bytes: 120,
            width: 640,
            height: 480,
            eager: [],
        } as never);

        const result = await new CloudinaryImageAdapter(profile).upload({
            buffer: Buffer.from("imagen"), contentType: "image/jpeg", key: "producto&seguro",
        });
        expect(result.url).toBe("https://res.cloudinary.com/demo/image/upload/product_images/producto.jpg");
        expect(result.externalId).toBe("product_images/producto-uuid");
        expect(upload).toHaveBeenCalledWith(
            `data:image/jpeg;base64,${Buffer.from("imagen").toString("base64")}`,
            expect.objectContaining({
                folder: "product_images",
                overwrite: false,
                resource_type: "image",
                eager: expect.any(Array),
            }),
        );
    });

    it("mantiene la eliminación por public ID mediante uploader.destroy", async () => {
        const destroy = vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({
            result: "ok",
        } as never);

        await new CloudinaryImageAdapter(profile).delete("product_images/producto");

        expect(destroy).toHaveBeenCalledWith(
            "product_images/producto",
            { resource_type: "image", invalidate: true },
        );
    });
});
