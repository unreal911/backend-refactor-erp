import { describe, expect, it } from "vitest";
import { requestedAwsS3ImageProvider } from "../src/modules/commercial-assets/aws-image-provider-bootstrap";

describe("configuración inicial del proveedor de imágenes S3", () => {
    it("mantiene el comportamiento actual si S3 no fue pedido explícitamente", () => {
        expect(requestedAwsS3ImageProvider({ AWS_REGION: "us-east-1" })).toBeNull();
    });

    it("exige bucket y URL HTTPS de CloudFront al elegir S3", () => {
        expect(() => requestedAwsS3ImageProvider({ PRODUCT_IMAGE_PROVIDER: "S3" }))
            .toThrow("PRODUCT_IMAGE_PROVIDER=S3 exige");
        expect(() => requestedAwsS3ImageProvider({
            PRODUCT_IMAGE_PROVIDER: "S3",
            PRODUCT_IMAGE_S3_BUCKET: "private-images",
            PRODUCT_IMAGE_S3_PUBLIC_BASE_URL: "http://images.example.test",
        })).toThrow("PRODUCT_IMAGE_PROVIDER=S3 exige");
    });

    it("normaliza el dominio CloudFront y usa us-east-1 como región por omisión", () => {
        expect(requestedAwsS3ImageProvider({
            PRODUCT_IMAGE_PROVIDER: "S3",
            PRODUCT_IMAGE_S3_BUCKET: " private-images ",
            PRODUCT_IMAGE_S3_PUBLIC_BASE_URL: "https://images.example.test///",
        })).toEqual({
            bucket: "private-images",
            cdnBaseUrl: "https://images.example.test",
            region: "us-east-1",
        });
    });
});
