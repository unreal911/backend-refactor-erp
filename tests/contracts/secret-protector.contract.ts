import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    SecretProtector,
} from "../../src/modules/sunat/infrastructure/ports/secret-protector.port";
import { ContractSuiteOptions } from "./document-storage.contract";

export interface SecretProtectorContractHarness {
    secretProtector: SecretProtector;
    dispose?(): Promise<void> | void;
}

export function secretProtectorContract(
    implementationName: string,
    createHarness: () => Promise<SecretProtectorContractHarness> | SecretProtectorContractHarness,
    options: ContractSuiteOptions = {},
): void {
    const suite = options.skip ? describe.skip : describe;

    suite(`contrato SecretProtector: ${implementationName}`, () => {
        let harness: SecretProtectorContractHarness;

        beforeAll(async () => {
            harness = await createHarness();
        });

        afterAll(async () => {
            await harness?.dispose?.();
        });

        it("sella y abre un secreto sin incluir el texto claro", async () => {
            const plaintext = Buffer.from("clave-sol-super-secreta", "utf8");
            const payload = await harness.secretProtector.seal({
                tenantId: "tenant-a",
                purpose: "SOL_PASSWORD",
                plaintext,
            });

            expect(payload).not.toContain(plaintext.toString("utf8"));
            await expect(
                harness.secretProtector.open({
                    tenantId: "tenant-a",
                    purpose: "SOL_PASSWORD",
                    payload,
                }),
            ).resolves.toEqual(plaintext);
        });

        it("produce payloads distintos para el mismo secreto", async () => {
            const input = {
                tenantId: "tenant-a",
                purpose: "PFX" as const,
                plaintext: Buffer.from("certificado"),
            };

            const first = await harness.secretProtector.seal(input);
            const second = await harness.secretProtector.seal(input);

            expect(first).not.toBe(second);
        });

        it("acepta un secreto vacío", async () => {
            const payload = await harness.secretProtector.seal({
                tenantId: "tenant-a",
                purpose: "PFX_PASSWORD",
                plaintext: Buffer.alloc(0),
            });

            await expect(
                harness.secretProtector.open({
                    tenantId: "tenant-a",
                    purpose: "PFX_PASSWORD",
                    payload,
                }),
            ).resolves.toEqual(Buffer.alloc(0));
        });

        it("impide abrir desde otro tenant o propósito", async () => {
            const payload = await harness.secretProtector.seal({
                tenantId: "tenant-a",
                purpose: "PFX",
                plaintext: Buffer.from("certificado"),
            });

            await expect(
                harness.secretProtector.open({
                    tenantId: "tenant-b",
                    purpose: "PFX",
                    payload,
                }),
            ).rejects.toThrow();
            await expect(
                harness.secretProtector.open({
                    tenantId: "tenant-a",
                    purpose: "SOL_PASSWORD",
                    payload,
                }),
            ).rejects.toThrow();
        });

        it("rechaza un payload alterado", async () => {
            const payload = await harness.secretProtector.seal({
                tenantId: "tenant-a",
                purpose: "PFX",
                plaintext: Buffer.from("certificado"),
            });
            const last = payload.slice(-1);
            const tampered = `${payload.slice(0, -1)}${last === "a" ? "b" : "a"}`;

            await expect(
                harness.secretProtector.open({
                    tenantId: "tenant-a",
                    purpose: "PFX",
                    payload: tampered,
                }),
            ).rejects.toThrow();
        });

        it("no conserva una referencia mutable al buffer de entrada", async () => {
            const plaintext = Buffer.from("secreto-original");
            const expected = Buffer.from(plaintext);
            const payload = await harness.secretProtector.seal({
                tenantId: "tenant-a",
                purpose: "TENANT_DATABASE_CREDENTIAL",
                plaintext,
            });
            plaintext.fill(0);

            await expect(
                harness.secretProtector.open({
                    tenantId: "tenant-a",
                    purpose: "TENANT_DATABASE_CREDENTIAL",
                    payload,
                }),
            ).resolves.toEqual(expected);
        });
    });
}
