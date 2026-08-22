import { AddressInfo } from "node:net";
import express, { Router } from "express";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import { COMPANY_EMAIL_KEY, COMPANY_NAME_KEY } from "../src/data/system-config-keys";
import { tenantPrisma } from "../src/data/tenant-prisma";
import { OwnerSignupDto } from "../src/modules/registration/owner-registration.dto";
import { OwnerRegistrationService } from "../src/modules/registration/owner-registration.service";
import {
    OwnerVerificationEmail,
    OwnerVerificationEmailSender,
} from "../src/modules/registration/ports/owner-verification-email.port";
import { registerOwnerRegistrationRoutes } from "../src/modules/registration/routes";
import { OwnerSignupAbuseGuard } from "../src/modules/registration/owner-signup-abuse.service";
import { ProvisionTrialDto } from "../src/modules/registration/trial-provisioning.dto";
import { TrialProvisioningService } from "../src/modules/registration/trial-provisioning.service";

class FakeEmailSender implements OwnerVerificationEmailSender {
    readonly messages: OwnerVerificationEmail[] = [];

    async sendVerificationEmail(message: OwnerVerificationEmail): Promise<void> {
        this.messages.push(message);
    }
}

const tag = `${Date.now().toString(36)}-${process.pid}`;
const emailPrefix = `tri001-${tag}`;
const sender = new FakeEmailSender();
let currentTime = new Date("2026-08-01T18:00:00.000Z");
const registrationService = new OwnerRegistrationService(sender, {
    tokenPepper: "tri-001-test-token-pepper-with-at-least-32-characters",
    verificationTtlMinutes: 30,
    trialProvisioningTtlMinutes: 60,
    termsVersion: "2026-08-01-tri-001",
    now: () => currentTime,
    bcryptRounds: 4,
});
const trialService = new TrialProvisioningService(registrationService, {
    now: () => currentTime,
});
const abuseGuard: OwnerSignupAbuseGuard = {
    async assess() {
        return {
            allowed: true,
            identity: {
                emailFingerprint: "e".repeat(64),
                ipFingerprint: "i".repeat(64),
                deviceFingerprint: "d".repeat(64),
            },
        };
    },
};
const router = Router();
registerOwnerRegistrationRoutes(
    router,
    registrationService,
    abuseGuard,
    undefined,
    trialService,
);
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0, "127.0.0.1");
let baseUrl = "";

function signupDto(label: string, businessName: string): OwnerSignupDto {
    const [error, dto] = OwnerSignupDto.create({
        firstName: "Ana",
        lastName: "Propietaria",
        email: `${emailPrefix}-${label}@example.test`,
        password: "Segura-2026!Clave",
        businessName,
        termsAccepted: true,
    });
    if (error || !dto) throw new Error(error ?? "DTO no disponible");
    return dto;
}

async function verifiedTrialToken(label: string, businessName: string): Promise<string> {
    const dto = signupDto(label, businessName);
    await registrationService.signup(dto);
    const verificationToken = [...sender.messages]
        .reverse()
        .find((message) => message.to === dto.email)
        ?.token;
    if (!verificationToken) throw new Error("Token de verificación no disponible");
    return (await registrationService.verifyEmail(verificationToken)).trialToken;
}

async function postTrial(
    trialToken: string,
    extraBody: Record<string, unknown> = {},
) {
    const response = await fetch(`${baseUrl}/api/public/signup/trial`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trialToken, ...extraBody }),
    });
    return {
        status: response.status,
        body: await response.json() as Record<string, any>,
    };
}

beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
        if (server.listening) return resolve();
        server.once("listening", () => resolve());
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await platformPrisma.role.upsert({
        where: { name: "ADMIN" },
        update: { isActive: true },
        create: {
            name: "ADMIN",
            description: "Acceso total al sistema",
            isActive: true,
        },
    });
});

beforeEach(() => {
    currentTime = new Date("2026-08-01T18:00:00.000Z");
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await platformPrisma.$disconnect().catch(() => undefined);
});

describe("TRI-001 aprovisionamiento atómico de prueba", () => {
    it("valida la credencial de aprovisionamiento", () => {
        expect(ProvisionTrialDto.create({ trialToken: "corto" })[0]).toBeDefined();
        expect(ProvisionTrialDto.create({ trialToken: "a".repeat(32) })[1]?.trialToken)
            .toBe("a".repeat(32));
    });

    it("crea usuario, trial compartido, OWNER y configuración calculada por servidor", async () => {
        const businessName = `Café Ñandú Norte ${tag}`;
        const trialToken = await verifiedTrialToken("complete", businessName);

        const response = await postTrial(trialToken, {
            slug: "slug-elegido-por-cliente",
            trialEndsAt: "2099-12-31T23:59:59.000Z",
        });

        expect(response.status).toBe(201);
        expect(response.body.idempotentReplay).toBe(false);
        expect(response.body.tenant).toMatchObject({
            name: businessName,
            kind: "TRIAL",
            status: "TRIAL",
            databaseMode: "SHARED",
        });
        expect(response.body.tenant.slug).toBe(`cafe-nandu-norte-${tag}`);
        expect(response.body.membership).toMatchObject({
            role: "OWNER",
            status: "ACTIVE",
        });
        expect(response.body).not.toHaveProperty("user");
        expect(new Date(response.body.tenant.trialStartedAt)).toEqual(currentTime);
        expect(new Date(response.body.tenant.trialEndsAt).getTime() - currentTime.getTime())
            .toBe(15 * 24 * 60 * 60 * 1000);

        const registration = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: `${emailPrefix}-complete@example.test` },
        });
        expect(registration.status).toBe("CONSUMED");
        expect(registration.provisionedTenantId).toBe(response.body.tenant.id);
        expect(registration.provisionedUserId).toBeTypeOf("number");
        expect(registration.trialProvisioningTokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(registration.trialProvisioningTokenHash).not.toBe(trialToken);

        const [paymentMethods, settings] = await Promise.all([
            platformPrisma.paymentMethod.count({
                where: { tenantId: response.body.tenant.id },
            }),
            platformPrisma.$queryRaw<Array<{ key: string; value: string }>>(Prisma.sql`
                SELECT "key", "value"
                FROM "SystemSetting"
                WHERE "tenantId" = ${response.body.tenant.id}::uuid
                  AND "key" IN (${COMPANY_NAME_KEY}, ${COMPANY_EMAIL_KEY})
            `),
        ]);
        expect(paymentMethods).toBe(6);
        expect(new Map(settings.map((row) => [row.key, row.value]))).toEqual(new Map([
            [COMPANY_NAME_KEY, businessName],
            [COMPANY_EMAIL_KEY, `${emailPrefix}-complete@example.test`],
        ]));
    });

    it("devuelve el mismo resultado al reintentar y no duplica filas", async () => {
        const businessName = `Idempotente ${tag}`;
        const trialToken = await verifiedTrialToken("retry", businessName);

        const first = await postTrial(trialToken);
        const replay = await postTrial(trialToken);

        expect(first.status).toBe(201);
        expect(replay.status).toBe(200);
        expect(replay.body.idempotentReplay).toBe(true);
        expect(replay.body.tenant.id).toBe(first.body.tenant.id);
        expect(replay.body.membership.id).toBe(first.body.membership.id);
        expect(await platformPrisma.tenant.count({ where: { name: businessName } })).toBe(1);
        expect(await platformPrisma.user.count({
            where: { email: `${emailPrefix}-retry@example.test` },
        })).toBe(1);
        expect(await platformPrisma.tenantMembership.count({
            where: { tenantId: first.body.tenant.id },
        })).toBe(1);
    });

    it("serializa dos consumos simultáneos del mismo token", async () => {
        const businessName = `Concurrente ${tag}`;
        const trialToken = await verifiedTrialToken("concurrent", businessName);

        const responses = await Promise.all([
            postTrial(trialToken),
            postTrial(trialToken),
        ]);

        expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
        expect(new Set(responses.map((response) => response.body.tenant.id)).size).toBe(1);
        expect(await platformPrisma.tenant.count({ where: { name: businessName } })).toBe(1);
    });

    it("asigna slugs únicos a nombres comerciales iguales bajo concurrencia", async () => {
        const businessName = `Duplicada ${tag}`;
        const [tokenA, tokenB] = await Promise.all([
            verifiedTrialToken("slug-a", businessName),
            verifiedTrialToken("slug-b", businessName),
        ]);

        const [trialA, trialB] = await Promise.all([
            postTrial(tokenA),
            postTrial(tokenB),
        ]);

        expect([trialA.status, trialB.status]).toEqual([201, 201]);
        expect([
            trialA.body.tenant.slug,
            trialB.body.tenant.slug,
        ].sort()).toEqual([
            `duplicada-${tag}`,
            `duplicada-${tag}-2`,
        ]);
    });

    it("revierte el consumo y el usuario si falla el aprovisionamiento interno", async () => {
        const email = `${emailPrefix}-rollback@example.test`;
        const trialToken = await verifiedTrialToken("rollback", `Rollback ${tag}`);
        const failingService = new TrialProvisioningService(registrationService, {
            now: () => currentTime,
            tenantProvisioner: {
                async createWithinTransaction() {
                    throw new Error("fallo inyectado");
                },
            },
        });

        await expect(failingService.provision(trialToken)).rejects.toThrow("fallo inyectado");

        expect(await platformPrisma.user.count({ where: { email } })).toBe(0);
        const registration = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email },
        });
        expect(registration.status).toBe("EMAIL_VERIFIED");
        expect(registration.consumedAt).toBeNull();
        expect(registration.provisionedTenantId).toBeNull();
        await platformPrisma.ownerRegistration.delete({ where: { id: registration.id } });
    });

    it("mantiene aislados dos trials creados por el flujo público", async () => {
        const tokenA = await verifiedTrialToken("isolation-a", `Aislada A ${tag}`);
        const tokenB = await verifiedTrialToken("isolation-b", `Aislada B ${tag}`);
        const [trialA, trialB] = await Promise.all([
            postTrial(tokenA),
            postTrial(tokenB),
        ]);
        const methodB = await platformPrisma.paymentMethod.findFirstOrThrow({
            where: { tenantId: trialB.body.tenant.id },
        });

        await runTenantDatabaseTransaction(trialA.body.tenant.id, async () => {
            expect(await tenantPrisma.tenant.findUnique({
                where: { id: trialB.body.tenant.id },
            })).toBeNull();
            expect(await tenantPrisma.tenantMembership.findUnique({
                where: { id: trialB.body.membership.id },
            })).toBeNull();
            expect(await tenantPrisma.paymentMethod.findUnique({
                where: { id: methodB.id },
            })).toBeNull();
            expect(await tenantPrisma.paymentMethod.count()).toBe(6);
        });
    });
});
