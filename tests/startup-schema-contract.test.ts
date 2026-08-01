import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    queryRawUnsafe: vi.fn(),
    seedRbacDefaults: vi.fn(),
    seedDefaultPaymentMethods: vi.fn(),
    seedDefaultSystemSettings: vi.fn(),
    seedLegacyTenantMemberships: vi.fn(),
}));

vi.mock("../src/data/prisma", () => ({
    prisma: {
        $queryRawUnsafe: mocks.queryRawUnsafe,
    },
}));

vi.mock("../src/data/rbac-bootstrap", () => ({
    seedRbacDefaults: mocks.seedRbacDefaults,
}));

vi.mock("../src/data/payment-method-bootstrap", () => ({
    seedDefaultPaymentMethods: mocks.seedDefaultPaymentMethods,
}));

vi.mock("../src/data/system-config-bootstrap", () => ({
    seedDefaultSystemSettings: mocks.seedDefaultSystemSettings,
}));

vi.mock("../src/data/tenant-bootstrap", () => ({
    seedLegacyTenantMemberships: mocks.seedLegacyTenantMemberships,
}));

import {
    REQUIRED_SCHEMA_MIGRATION,
    REQUIRED_SCHEMA_TABLES,
    runStartupBootstraps,
} from "../src/bootstrap/startup";

const startupEnvironment = {
    NODE_ENV: "test",
    SUNAT_DOCUMENT_STORAGE_ENABLED: "false",
};

describe("contrato de esquema al arrancar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.seedRbacDefaults.mockResolvedValue(undefined);
        mocks.seedDefaultPaymentMethods.mockResolvedValue(undefined);
        mocks.seedDefaultSystemSettings.mockResolvedValue(undefined);
        mocks.seedLegacyTenantMemberships.mockResolvedValue(undefined);
    });

    it("valida la migración formal y ejecuta solo seeds de datos", async () => {
        mocks.queryRawUnsafe
            .mockResolvedValueOnce([{ connected: true }])
            .mockResolvedValueOnce(
                REQUIRED_SCHEMA_TABLES.map((tableName) => ({ table_name: tableName })),
            )
            .mockResolvedValueOnce([{ migration_name: REQUIRED_SCHEMA_MIGRATION }]);

        await expect(
            runStartupBootstraps(
                "postgresql://postgres:test@127.0.0.1:5432/test",
                startupEnvironment,
            ),
        ).resolves.toBeUndefined();

        expect(mocks.seedRbacDefaults).toHaveBeenCalledOnce();
        expect(mocks.seedDefaultPaymentMethods).toHaveBeenCalledOnce();
        expect(mocks.seedDefaultSystemSettings).toHaveBeenCalledOnce();
        expect(mocks.seedLegacyTenantMemberships).toHaveBeenCalledOnce();
        expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(3);
    });

    it("aborta antes de los seeds si falta una tabla", async () => {
        mocks.queryRawUnsafe
            .mockResolvedValueOnce([{ connected: true }])
            .mockResolvedValueOnce(
                REQUIRED_SCHEMA_TABLES.slice(1).map((tableName) => ({ table_name: tableName })),
            );

        await expect(
            runStartupBootstraps(
                "postgresql://postgres:test@127.0.0.1:5432/test",
                startupEnvironment,
            ),
        ).rejects.toThrow("required schema migration is missing");

        expect(mocks.seedRbacDefaults).not.toHaveBeenCalled();
        expect(mocks.seedDefaultPaymentMethods).not.toHaveBeenCalled();
        expect(mocks.seedDefaultSystemSettings).not.toHaveBeenCalled();
        expect(mocks.seedLegacyTenantMemberships).not.toHaveBeenCalled();
    });

    it("aborta si la migración formal no está registrada como aplicada", async () => {
        mocks.queryRawUnsafe
            .mockResolvedValueOnce([{ connected: true }])
            .mockResolvedValueOnce(
                REQUIRED_SCHEMA_TABLES.map((tableName) => ({ table_name: tableName })),
            )
            .mockResolvedValueOnce([]);

        await expect(
            runStartupBootstraps(
                "postgresql://postgres:test@127.0.0.1:5432/test",
                startupEnvironment,
            ),
        ).rejects.toThrow("required schema migration is missing");

        expect(mocks.seedRbacDefaults).not.toHaveBeenCalled();
    });
});
