import { AddressInfo } from "node:net";
import express, { Router } from "express";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import {
    GENERIC_SIGNUP_RESPONSE,
} from "../src/modules/registration/controller";
import { OwnerSignupDto } from "../src/modules/registration/owner-registration.dto";
import {
    OwnerRegistrationService,
    OwnerRegistrationTokenError,
} from "../src/modules/registration/owner-registration.service";
import {
    OwnerVerificationEmail,
    OwnerVerificationEmailSender,
} from "../src/modules/registration/ports/owner-verification-email.port";
import { registerOwnerRegistrationRoutes } from "../src/modules/registration/routes";
import { OwnerSignupAbuseGuard } from "../src/modules/registration/owner-signup-abuse.service";

class FakeEmailSender implements OwnerVerificationEmailSender {
    readonly messages: OwnerVerificationEmail[] = [];
    failNext = false;

    async sendVerificationEmail(message: OwnerVerificationEmail): Promise<void> {
        if (this.failNext) {
            this.failNext = false;
            throw new Error("delivery unavailable");
        }
        this.messages.push(message);
    }
}

const tag = `${Date.now().toString(36)}-${process.pid}`;
const emailPrefix = `emp001-${tag}`;
const sender = new FakeEmailSender();
let currentTime = new Date("2026-08-01T16:00:00.000Z");
const service = new OwnerRegistrationService(sender, {
    tokenPepper: "emp-001-test-pepper-with-at-least-32-characters",
    verificationTtlMinutes: 30,
    trialProvisioningTtlMinutes: 60,
    termsVersion: "2026-08-01-test",
    now: () => currentTime,
    bcryptRounds: 4,
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
registerOwnerRegistrationRoutes(router, service, abuseGuard);
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0, "127.0.0.1");
let baseUrl = "";

function signupBody(label: string, overrides: Record<string, unknown> = {}) {
    return {
        firstName: "Ana",
        lastName: "Propietaria",
        email: `${emailPrefix}-${label}@example.test`,
        password: "Segura-2026!Clave",
        businessName: `Tienda ${label}`,
        termsAccepted: true,
        captchaToken: "test-captcha-token",
        ...overrides,
    };
}

function signupDto(label: string, overrides: Record<string, unknown> = {}): OwnerSignupDto {
    const [error, dto] = OwnerSignupDto.create(signupBody(label, overrides));
    if (error || !dto) throw new Error(error ?? "DTO no disponible");
    return dto;
}

async function post(path: string, body: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-signup-device-id": "emp001-test-device-0001",
        },
        body: JSON.stringify(body),
    });
    return {
        status: response.status,
        body: await response.json() as Record<string, unknown>,
    };
}

beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
        if (server.listening) return resolve();
        server.once("listening", () => resolve());
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await platformPrisma.ownerRegistration.deleteMany({
        where: { email: { startsWith: emailPrefix } },
    });
});

beforeEach(() => {
    currentTime = new Date("2026-08-01T16:00:00.000Z");
});

afterAll(async () => {
    await platformPrisma.ownerRegistration.deleteMany({
        where: { email: { startsWith: emailPrefix } },
    }).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await platformPrisma.$disconnect().catch(() => undefined);
});

describe("EMP-001 registro de propietario", () => {
    it("crea solo una identidad pendiente con secretos protegidos", async () => {
        const messageOffset = sender.messages.length;
        const request = signupBody("pending");

        const response = await post("/api/public/signup", request);

        expect(response).toEqual({ status: 202, body: GENERIC_SIGNUP_RESPONSE });
        const registration = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: request.email },
        });
        expect(registration.status).toBe("EMAIL_PENDING");
        expect(registration.termsVersion).toBe("2026-08-01-test");
        expect(registration.verificationTokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(registration.trialProvisioningTokenHash).toBeNull();
        expect(await bcrypt.compare(String(request.password), registration.passwordHash))
            .toBe(true);
        expect(registration.passwordHash).not.toContain(String(request.password));

        const message = sender.messages[messageOffset];
        expect(message?.to).toBe(request.email);
        expect(message?.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
        expect(registration.verificationTokenHash).not.toBe(message?.token);
        expect(await platformPrisma.user.count({ where: { email: request.email } })).toBe(0);
        expect(await platformPrisma.tenant.count({
            where: { name: String(request.businessName) },
        })).toBe(0);
        expect(await platformPrisma.tenantMembership.count({
            where: { user: { email: String(request.email) } },
        })).toBe(0);
    });

    it("es idempotente, preserva el enlace vigente y deja una identidad consumible una sola vez", async () => {
        const original = signupDto("retry");
        await service.signup(original);
        const firstMessage = sender.messages.at(-1)!;
        const messagesBeforeRetry = sender.messages.length;
        const before = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: original.email },
        });

        const attackerPassword = "Atacante-2026!Clave";
        await service.signup(signupDto("retry", {
            firstName: "Otra",
            password: attackerPassword,
            businessName: "Negocio reemplazado",
        }));
        const after = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: original.email },
        });

        expect(await platformPrisma.ownerRegistration.count({
            where: { email: original.email },
        })).toBe(1);
        expect(after.firstName).toBe(original.firstName);
        expect(after.businessName).toBe(original.businessName);
        expect(after.passwordHash).toBe(before.passwordHash);
        expect(after.verificationTokenHash).toBe(before.verificationTokenHash);
        expect(sender.messages).toHaveLength(messagesBeforeRetry);
        expect(await bcrypt.compare(original.password, after.passwordHash)).toBe(true);
        expect(await bcrypt.compare(attackerPassword, after.passwordHash)).toBe(false);

        const verified = await service.verifyEmail(firstMessage.token);
        const verifiedRegistration = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: original.email },
        });
        await service.signup(signupDto("retry"));
        const retriedAfterVerification = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: original.email },
        });
        expect(sender.messages).toHaveLength(messagesBeforeRetry);
        expect(retriedAfterVerification.trialProvisioningTokenHash)
            .toBe(verifiedRegistration.trialProvisioningTokenHash);

        const consumedEmail = await service.consumeVerifiedIdentity(
            verified.trialToken,
            async (identity) => identity.email,
        );
        expect(consumedEmail).toBe(original.email);
        await expect(service.consumeVerifiedIdentity(
            verified.trialToken,
            async (identity) => identity.email,
        )).rejects.toBeInstanceOf(OwnerRegistrationTokenError);

        const consumed = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: original.email },
        });
        expect(consumed.status).toBe("CONSUMED");
        expect(consumed.consumedAt).toEqual(currentTime);
        expect(consumed.trialProvisioningTokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(consumed.trialProvisioningTokenHash).not.toBe(verified.trialToken);
        expect(consumed.trialProvisioningTokenExpiresAt).toBeInstanceOf(Date);
    });

    it("mantiene la idempotencia ante solicitudes simultáneas", async () => {
        const dto = signupDto("concurrent");
        const messagesBefore = sender.messages.length;

        await Promise.all([
            service.signup(dto),
            service.signup(dto),
        ]);

        expect(await platformPrisma.ownerRegistration.count({
            where: { email: dto.email },
        })).toBe(1);
        expect(sender.messages).toHaveLength(messagesBefore + 1);
    });

    it("expira el enlace, rechaza su reutilización y permite renovarlo", async () => {
        const dto = signupDto("expired");
        await service.signup(dto);
        const verificationToken = sender.messages.at(-1)!.token;
        const messagesBeforeRenewal = sender.messages.length;
        currentTime = new Date(currentTime.getTime() + 31 * 60_000);

        await expect(service.verifyEmail(verificationToken))
            .rejects.toBeInstanceOf(OwnerRegistrationTokenError);
        const pending = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: dto.email },
        });
        expect(pending.status).toBe("EMAIL_PENDING");
        expect(pending.emailVerifiedAt).toBeNull();

        await service.signup(dto);
        expect(sender.messages).toHaveLength(messagesBeforeRenewal + 1);
        const renewedToken = sender.messages.at(-1)!.token;
        expect(renewedToken).not.toBe(verificationToken);
        await expect(service.verifyEmail(renewedToken)).resolves.toMatchObject({
            trialToken: expect.any(String),
        });
    });

    it("reenvía un enlace vigente solo cuando la contraseña del registro coincide", async () => {
        const dto = signupDto("resend");
        await service.signup(dto);
        const originalToken = sender.messages.at(-1)!.token;
        const messagesBefore = sender.messages.length;

        await service.resendVerification(dto.email, "Clave-incorrecta-2026!");
        expect(sender.messages).toHaveLength(messagesBefore);

        await service.resendVerification(dto.email, dto.password);
        expect(sender.messages).toHaveLength(messagesBefore + 1);
        const resentToken = sender.messages.at(-1)!.token;
        expect(resentToken).not.toBe(originalToken);
        await expect(service.verifyEmail(resentToken)).resolves.toMatchObject({
            trialToken: expect.any(String),
        });
    });

    it("responde igual para un correo que ya pertenece a un usuario", async () => {
        const existingUser = await platformPrisma.user.findFirst({
            orderBy: { id: "asc" },
            select: { email: true },
        });
        expect(existingUser).not.toBeNull();
        const messageCount = sender.messages.length;

        const response = await post("/api/public/signup", signupBody("existing", {
            email: existingUser!.email,
        }));

        expect(response).toEqual({ status: 202, body: GENERIC_SIGNUP_RESPONSE });
        expect(sender.messages).toHaveLength(messageCount);
        expect(await platformPrisma.ownerRegistration.count({
            where: { email: existingUser!.email },
        })).toBe(0);
    });

    it("invalida el token si el proveedor de correo falla", async () => {
        const dto = signupDto("delivery-failure");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        sender.failNext = true;

        await expect(service.signup(dto)).resolves.toBeUndefined();

        const pending = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: dto.email },
        });
        expect(pending.verificationTokenHash).toBeNull();
        expect(pending.verificationTokenExpiresAt).toBeNull();
        expect(consoleError).toHaveBeenCalledWith(
            "[owner-signup] verification delivery failed",
            { registrationId: pending.id },
        );
        consoleError.mockRestore();
    });
});
