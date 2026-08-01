import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudinary } from "../src/config/cloudinary";
import { ProductService } from "../src/presentation/services/product.service";

type ProductServiceCloudinaryHooks = {
    uploadBase64Image(data: string, publicId: string): Promise<string>;
    deleteCloudinaryUrl(url: string): Promise<void>;
};

function cloudinaryHooks(): ProductServiceCloudinaryHooks {
    return new ProductService() as unknown as ProductServiceCloudinaryHooks;
}

describe("compatibilidad Cloudinary 2.x", () => {
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

    it("mantiene la carga Base64 mediante uploader.upload", async () => {
        const upload = vi.spyOn(cloudinary.uploader, "upload").mockResolvedValue({
            secure_url: "https://res.cloudinary.com/demo/image/upload/product_images/producto.jpg",
        } as never);

        await expect(
            cloudinaryHooks().uploadBase64Image("YWJj", "producto&seguro"),
        ).resolves.toBe(
            "https://res.cloudinary.com/demo/image/upload/product_images/producto.jpg",
        );
        expect(upload).toHaveBeenCalledWith(
            "data:image/jpeg;base64,YWJj",
            {
                folder: "product_images",
                public_id: "producto&seguro",
                overwrite: true,
                resource_type: "image",
            },
        );
    });

    it("mantiene la eliminación por public ID mediante uploader.destroy", async () => {
        const destroy = vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({
            result: "ok",
        } as never);

        await cloudinaryHooks().deleteCloudinaryUrl(
            "https://res.cloudinary.com/demo/image/upload/v123/product_images/producto.jpg",
        );

        expect(destroy).toHaveBeenCalledWith(
            "product_images/producto",
            { resource_type: "image" },
        );
    });
});
