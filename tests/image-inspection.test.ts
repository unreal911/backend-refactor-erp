import { describe, expect, it } from "vitest";
import { inspectImage } from "../src/modules/commercial-assets/image-inspection";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("validación defensiva de imágenes comerciales", () => {
    it("detecta MIME y dimensiones reales sin confiar en el nombre", () => {
        const inspected = inspectImage(`data:image/jpeg;base64,${PNG_1X1}`, 1024 * 1024);
        expect(inspected.contentType).toBe("image/png");
        expect(inspected.width).toBe(1);
        expect(inspected.height).toBe(1);
        expect(inspected.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rechaza contenido que no es una imagen aprobada", () => {
        const payload = Buffer.from("<svg><script>alert(1)</script></svg>").toString("base64");
        expect(() => inspectImage(`data:image/svg+xml;base64,${payload}`, 1024 * 1024))
            .toThrow("Solo se aceptan imágenes JPEG, PNG o WebP válidas");
    });

    it("rechaza antes de subir cuando excede el peso permitido", () => {
        expect(() => inspectImage(PNG_1X1, 32)).toThrow("excede");
    });
});
