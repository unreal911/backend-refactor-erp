import { describe, expect, it } from "vitest";
import {
    runStartupBootstraps,
    validateSunatDocumentInfrastructureAtStartup,
} from "../src/bootstrap/startup";
import { loadSunatInfrastructureConfig } from "../src/modules/sunat/infrastructure/sunat-infrastructure.config";

describe("configuración de infraestructura SUNAT", () => {
    it("usa Moto con valores locales seguros fuera de producción", () => {
        const config = loadSunatInfrastructureConfig({
            NODE_ENV: "test",
        });

        expect(config).toMatchObject({
            runtimeEnvironment: "test",
            cloudMode: "moto",
            region: "us-east-1",
            endpointUrl: "http://127.0.0.1:5000",
            forcePathStyle: true,
            bucket: "sunat-dev",
            envelopeKmsKeyId: "alias/sunat-dev",
        });
    });

    it("prohíbe ejecutar Moto en producción", () => {
        expect(() =>
            loadSunatInfrastructureConfig({
                NODE_ENV: "production",
                CLOUD_MODE: "moto",
                SUNAT_S3_BUCKET: "sunat-production",
                SUNAT_KMS_KEY_ID: "alias/sunat-production",
                SUNAT_S3_KMS_KEY_ID: "alias/sunat-s3-production",
            }),
        ).toThrow("CLOUD_MODE=moto está prohibido en producción");
    });

    it("prohíbe endpoints personalizados y path style en producción", () => {
        expect(() =>
            loadSunatInfrastructureConfig({
                NODE_ENV: "production",
                CLOUD_MODE: "aws",
                AWS_ENDPOINT_URL: "http://localhost:5000",
                S3_FORCE_PATH_STYLE: "false",
                SUNAT_S3_BUCKET: "sunat-production",
                SUNAT_KMS_KEY_ID: "alias/sunat-production",
                SUNAT_S3_KMS_KEY_ID: "alias/sunat-s3-production",
            }),
        ).toThrow("AWS_ENDPOINT_URL debe estar vacío en producción");
    });

    it("exige una clave KMS para el cifrado del bucket en producción", () => {
        expect(() =>
            loadSunatInfrastructureConfig({
                NODE_ENV: "production",
                CLOUD_MODE: "aws",
                S3_FORCE_PATH_STYLE: "false",
                SUNAT_S3_BUCKET: "sunat-production",
                SUNAT_KMS_KEY_ID: "alias/sunat-production",
            }),
        ).toThrow("SUNAT_S3_KMS_KEY_ID es obligatorio");
    });

    it("acepta una configuración AWS de producción sin credenciales estáticas", () => {
        const config = loadSunatInfrastructureConfig({
            NODE_ENV: "production",
            CLOUD_MODE: "aws",
            AWS_REGION: "us-east-1",
            S3_FORCE_PATH_STYLE: "false",
            SUNAT_S3_BUCKET: "sunat-production",
            SUNAT_KMS_KEY_ID: "alias/sunat-production",
            SUNAT_S3_KMS_KEY_ID: "alias/sunat-s3-production",
        });

        expect(config.cloudMode).toBe("aws");
        expect(config.endpointUrl).toBeUndefined();
        expect(config.forcePathStyle).toBe(false);
        expect(config.accessKeyId).toBeUndefined();
    });

    it("rechaza credenciales AWS configuradas a medias", () => {
        expect(() =>
            loadSunatInfrastructureConfig({
                NODE_ENV: "test",
                AWS_ACCESS_KEY_ID: "incompleta",
            }),
        ).toThrow("AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY deben configurarse juntos");
    });

    it("no exige infraestructura documental mientras la integración está apagada", () => {
        expect(() =>
            validateSunatDocumentInfrastructureAtStartup({
                NODE_ENV: "production",
                SUNAT_DOCUMENT_STORAGE_ENABLED: "false",
                CLOUD_MODE: "moto",
            }),
        ).not.toThrow();
    });

    it("rechaza un valor inválido para la bandera documental", () => {
        expect(() =>
            validateSunatDocumentInfrastructureAtStartup({
                SUNAT_DOCUMENT_STORAGE_ENABLED: "quizas",
            }),
        ).toThrow("Valor booleano inválido");
    });

    it("el bootstrap aborta por Moto productivo antes de consultar PostgreSQL", async () => {
        await expect(
            runStartupBootstraps(
                "postgresql://usuario:clave@127.0.0.1:1/no-debe-consultarse",
                {
                    NODE_ENV: "production",
                    SUNAT_DOCUMENT_STORAGE_ENABLED: "true",
                    CLOUD_MODE: "moto",
                    AWS_ENDPOINT_URL: "http://127.0.0.1:5000",
                    AWS_REGION: "us-east-1",
                    S3_FORCE_PATH_STYLE: "true",
                    SUNAT_S3_BUCKET: "no-usar",
                    SUNAT_KMS_KEY_ID: "alias/no-usar",
                    SUNAT_S3_KMS_KEY_ID: "alias/no-usar-s3",
                },
            ),
        ).rejects.toThrow("CLOUD_MODE=moto está prohibido en producción");
    });
});
