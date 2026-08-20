import { createHmac } from "node:crypto";
import { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import express, { Router } from "express";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envs } from "../src/config/envs";
import { platformPrisma } from "../src/data/platform-prisma";
import { OwnerSignupDto } from "../src/modules/registration/owner-registration.dto";
import {
    OwnerRegistrationService,
    OwnerRegistrationTrialLimitError,
} from "../src/modules/registration/owner-registration.service";
import {
    OwnerSignupAbuseService,
    SignupAbuseReviewService,
} from "../src/modules/registration/owner-signup-abuse.service";
import {
    OwnerSignupCaptchaResult,
    OwnerSignupCaptchaVerifier,
} from "../src/modules/registration/ports/owner-signup-captcha.port";
import {
    OwnerVerificationEmail,
    OwnerVerificationEmailSender,
} from "../src/modules/registration/ports/owner-verification-email.port";
import { registerOwnerRegistrationRoutes } from "../src/modules/registration/routes";

class MutableCaptcha implements OwnerSignupCaptchaVerifier {
    result: OwnerSignupCaptchaResult = { status: "VALID" };
    calls = 0;

    async verify(): Promise<OwnerSignupCaptchaResult> {
        this.calls += 1;
        return this.result;
    }
}

class FakeEmailSender implements OwnerVerificationEmailSender {
    readonly messages: OwnerVerificationEmail[] = [];

    async sendVerificationEmail(message: OwnerVerificationEmail): Promise<void> {
        this.messages.push(message);
    }
}

const tag = `${Date.now().toString(36)}-${process.pid}`;
const prefix = `emp002-${tag}`;
const fingerprintPepper = "emp-002-fingerprint-pepper-with-at-least-32-characters";
let currentTime = new Date("2026-08-01T17:00:00.000Z");
const captcha = new MutableCaptcha();
const abuseService = new OwnerSignupAbuseService(captcha, {
    fingerprintPepper,
    ipLimit: 100,
    ipWindowMinutes: 60,
    emailLimit: 2,
    emailWindowMinutes: 1440,
    deviceLimit: 100,
    deviceWindowMinutes: 1440,
    now: () => currentTime,
});
const emailSender = new FakeEmailSender();
const registrationService = new OwnerRegistrationService(emailSender, {
    tokenPepper: "emp-002-registration-pepper-with-at-least-32-characters",
    verificationTtlMinutes: 30,
    trialProvisioningTtlMinutes: 60,
    termsVersion: "2026-08-01-test",
    bcryptRounds: 4,
    now: () => currentTime,
});
const reviewService = new SignupAbuseReviewService();
const router = Router();
registerOwnerRegistrationRoutes(router, registrationService, abuseService, reviewService);
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(router);
const server = app.listen(0, "127.0.0.1");
let baseUrl = "";
let platformToken = "";
let platformAdminId = "";
let platformUserId = 0;
let activeTrialTenantId = "";
let activeTrialUserId = 0;
let rejectionReference = "";

function fingerprint(dimension: string, value: string): string {
    return createHmac("sha256", fingerprintPepper)
        .update(`${dimension}:${value}`, "utf8")
        .digest("hex");
}

function email(label: string): string {
    return `${prefix}-${label}@example.test`;
}

function signupBody(label: string) {
    return {
        firstName: "Elena",
        lastName: "Operadora",
        email: email(label),
        password: "Segura-2026!Clave",
        businessName: `Negocio ${prefix}-${label}`,
        termsAccepted: true,
        captchaToken: `captcha-${label}`,
    };
}

async function request(path: string, options: {
    method?: string;
    body?: unknown;
    token?: string;
    deviceId?: string;
} = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...(options.deviceId ? { "x-signup-device-id": options.deviceId } : {}),
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: await response.json() as Record<string, any>,
    };
}

beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
        if (server.listening) return resolve();
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const role = await platformPrisma.role.findFirstOrThrow({ orderBy: { id: "asc" } });
    const platformUser = await platformPrisma.user.create({
        data: {
            firstName: "Soporte",
            lastName: "EMP002",
            email: email("support"),
            password: await bcrypt.hash("Segura-2026!Soporte", 4),
            roleId: role.id,
        },
    });
    platformUserId = platformUser.id;
    const platformAdmin = await platformPrisma.platformAdmin.create({
        data: { userId: platformUser.id },
    });
    platformAdminId = platformAdmin.id;
    platformToken = jwt.sign({
        scope: "platform",
        id: platformUser.id,
        email: platformUser.email,
        role: "PLATFORM_ADMIN",
        platformAdminId: platformAdmin.id,
        mfaAt: Math.floor(Date.now() / 1000),
    }, envs.JWT_SECRET, { expiresIn: "15m" });
});

afterAll(async () => {
    const emailFingerprints = [
        "captcha-rejected",
        "limited",
        "active-trial",
        "ip-first",
        "ip-second",
        "device-first",
        "device-second",
        "concurrent",
    ].map((label) => fingerprint("email", email(label)));
    const events = await platformPrisma.signupAbuseEvent.findMany({
        where: { emailFingerprint: { in: emailFingerprints } },
        select: { ipFingerprint: true, deviceFingerprint: true },
    }).catch(() => []);
    const registrationFingerprints = await platformPrisma.ownerRegistration.findMany({
        where: { email: { startsWith: prefix } },
        select: {
            signupEmailFingerprint: true,
            signupIpFingerprint: true,
            signupDeviceFingerprint: true,
        },
    }).catch(() => []);
    const bucketFingerprints = new Set<string>(emailFingerprints);
    for (const ipAddress of ["203.0.113.21", "203.0.113.31", "203.0.113.32"]) {
        bucketFingerprints.add(fingerprint("ip", ipAddress));
    }
    for (let index = 1; index <= 5; index += 1) {
        bucketFingerprints.add(fingerprint("ip", `203.0.113.${40 + index}`));
        bucketFingerprints.add(fingerprint("device", `device-emp002-concurrent-000${index}`));
    }
    for (const deviceId of [
        "device-emp002-ip-first",
        "device-emp002-ip-second",
        "device-emp002-shared-0001",
    ]) {
        bucketFingerprints.add(fingerprint("device", deviceId));
    }
    for (const row of [...events, ...registrationFingerprints]) {
        if (row.ipFingerprint) bucketFingerprints.add(row.ipFingerprint);
        if (row.deviceFingerprint) bucketFingerprints.add(row.deviceFingerprint);
        if ("signupEmailFingerprint" in row && row.signupEmailFingerprint) {
            bucketFingerprints.add(row.signupEmailFingerprint);
        }
    }

    await platformPrisma.signupAbuseEvent.deleteMany({
        where: { emailFingerprint: { in: emailFingerprints } },
    }).catch(() => undefined);
    await platformPrisma.signupRateLimitBucket.deleteMany({
        where: { fingerprint: { in: [...bucketFingerprints] } },
    }).catch(() => undefined);
    await platformPrisma.ownerRegistration.deleteMany({
        where: { email: { startsWith: prefix } },
    }).catch(() => undefined);
    if (activeTrialUserId) {
        await platformPrisma.tenantMembership.deleteMany({
            where: { userId: activeTrialUserId },
        }).catch(() => undefined);
    }
    if (activeTrialTenantId) {
        await platformPrisma.tenant.deleteMany({
            where: { id: activeTrialTenantId },
        }).catch(() => undefined);
    }
    if (activeTrialUserId) {
        await platformPrisma.user.deleteMany({
            where: { id: activeTrialUserId },
        }).catch(() => undefined);
    }
    if (platformAdminId) {
        await platformPrisma.platformAdmin.deleteMany({
            where: { id: platformAdminId },
        }).catch(() => undefined);
    }
    if (platformUserId) {
        await platformPrisma.user.deleteMany({
            where: { id: platformUserId },
        }).catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await platformPrisma.$disconnect().catch(() => undefined);
});

describe("EMP-002 controles de abuso", () => {
    it("valida CAPTCHA en backend y un rechazo no crea identidad ni tenant", async () => {
        captcha.result = { status: "INVALID" };
        const body = signupBody("captcha-rejected");
        const response = await request("/api/public/signup", {
            method: "POST",
            body,
            deviceId: "device-emp002-captcha-0001",
        });

        expect(response.status).toBe(400);
        expect(response.body.referenceId).toMatch(/^[0-9a-f-]{36}$/);
        expect(await platformPrisma.ownerRegistration.count({
            where: { email: body.email },
        })).toBe(0);
        expect(await platformPrisma.tenant.count({
            where: { name: body.businessName },
        })).toBe(0);

        const event = await platformPrisma.signupAbuseEvent.findUniqueOrThrow({
            where: { id: response.body.referenceId },
        });
        expect(event.reason).toBe("CAPTCHA_FAILED");
        expect(JSON.stringify(event)).not.toContain(body.email);
        expect(JSON.stringify(event)).not.toContain("device-emp002-captcha-0001");
        rejectionReference = event.id;
        captcha.result = { status: "VALID" };
    });

    it("persiste solo huellas HMAC y limita por correo entre solicitudes", async () => {
        const body = signupBody("limited");
        const deviceId = "device-emp002-limited-0001";
        const first = await request("/api/public/signup", {
            method: "POST",
            body,
            deviceId,
        });
        const second = await request("/api/public/signup", {
            method: "POST",
            body,
            deviceId,
        });
        const third = await request("/api/public/signup", {
            method: "POST",
            body,
            deviceId,
        });

        expect(first.status).toBe(202);
        expect(second.status).toBe(202);
        expect(third.status).toBe(429);
        expect(Number(third.retryAfter)).toBeGreaterThan(0);
        expect(third.body.referenceId).toMatch(/^[0-9a-f-]{36}$/);
        rejectionReference = third.body.referenceId;
        expect(await platformPrisma.ownerRegistration.count({
            where: { email: body.email },
        })).toBe(1);
        const registration = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: body.email },
        });
        expect(registration.signupEmailFingerprint).toBe(
            fingerprint("email", body.email),
        );
        expect(registration.signupDeviceFingerprint).not.toBe(deviceId);
    });

    it("aplica límites persistentes independientes por IP y dispositivo", async () => {
        const ipGuard = new OwnerSignupAbuseService(captcha, {
            fingerprintPepper,
            ipLimit: 1,
            ipWindowMinutes: 60,
            emailLimit: 100,
            emailWindowMinutes: 1440,
            deviceLimit: 100,
            deviceWindowMinutes: 1440,
            now: () => currentTime,
        });
        await expect(ipGuard.assess({
            email: email("ip-first"),
            ipAddress: "203.0.113.21",
            deviceId: "device-emp002-ip-first",
            captchaToken: "captcha-ip-first",
        })).resolves.toMatchObject({ allowed: true });
        const ipRejected = await ipGuard.assess({
            email: email("ip-second"),
            ipAddress: "203.0.113.21",
            deviceId: "device-emp002-ip-second",
            captchaToken: "captcha-ip-second",
        });
        expect(ipRejected).toMatchObject({ allowed: false, statusCode: 429 });
        if (ipRejected.allowed) throw new Error("Se esperaba rechazo por IP");
        expect((await platformPrisma.signupAbuseEvent.findUniqueOrThrow({
            where: { id: ipRejected.referenceId },
        })).reason).toBe("IP_RATE_LIMIT");

        const deviceGuard = new OwnerSignupAbuseService(captcha, {
            fingerprintPepper,
            ipLimit: 100,
            ipWindowMinutes: 60,
            emailLimit: 100,
            emailWindowMinutes: 1440,
            deviceLimit: 1,
            deviceWindowMinutes: 1440,
            now: () => currentTime,
        });
        await expect(deviceGuard.assess({
            email: email("device-first"),
            ipAddress: "203.0.113.31",
            deviceId: "device-emp002-shared-0001",
            captchaToken: "captcha-device-first",
        })).resolves.toMatchObject({ allowed: true });
        const deviceRejected = await deviceGuard.assess({
            email: email("device-second"),
            ipAddress: "203.0.113.32",
            deviceId: "device-emp002-shared-0001",
            captchaToken: "captcha-device-second",
        });
        expect(deviceRejected).toMatchObject({ allowed: false, statusCode: 429 });
        if (deviceRejected.allowed) throw new Error("Se esperaba rechazo por dispositivo");
        expect((await platformPrisma.signupAbuseEvent.findUniqueOrThrow({
            where: { id: deviceRejected.referenceId },
        })).reason).toBe("DEVICE_RATE_LIMIT");
    });

    it("serializa intentos simultáneos y agrega los rechazos sin crecer por solicitud", async () => {
        const concurrentGuard = new OwnerSignupAbuseService(captcha, {
            fingerprintPepper,
            ipLimit: 100,
            ipWindowMinutes: 60,
            emailLimit: 2,
            emailWindowMinutes: 1440,
            deviceLimit: 100,
            deviceWindowMinutes: 1440,
            now: () => currentTime,
        });
        const results = await Promise.all(Array.from({ length: 5 }, (_, offset) => {
            const index = offset + 1;
            return concurrentGuard.assess({
                email: email("concurrent"),
                ipAddress: `203.0.113.${40 + index}`,
                deviceId: `device-emp002-concurrent-000${index}`,
                captchaToken: `captcha-concurrent-${index}`,
            });
        }));
        expect(results.filter((result) => result.allowed)).toHaveLength(2);
        expect(results.filter((result) => !result.allowed)).toHaveLength(3);

        const events = await platformPrisma.signupAbuseEvent.findMany({
            where: {
                reason: "EMAIL_RATE_LIMIT",
                aggregationKey: fingerprint("email", email("concurrent")),
            },
        });
        expect(events).toHaveLength(1);
        expect(events[0]?.occurrences).toBe(3);
    });

    it("protege la revisión con JWT de plataforma y habilita una excepción auditada", async () => {
        expect((await request("/api/platform/signup-abuse/events")).status).toBe(401);

        const listed = await request(
            "/api/platform/signup-abuse/events?reviewStatus=UNREVIEWED",
            { token: platformToken },
        );
        expect(listed.status).toBe(200);
        const event = listed.body.data.find((row: any) => row.id === rejectionReference);
        expect(event).toBeDefined();
        expect(JSON.stringify(event)).not.toContain(email("limited"));

        const reviewed = await request(
            `/api/platform/signup-abuse/events/${rejectionReference}/review`,
            {
                method: "POST",
                token: platformToken,
                body: {
                    outcome: "FALSE_POSITIVE",
                    noteCode: "LEGITIMATE_CUSTOMER",
                    overrideHours: 24,
                },
            },
        );
        expect(reviewed.status).toBe(200);
        expect(reviewed.body.reviewStatus).toBe("FALSE_POSITIVE");

        const retried = await request("/api/public/signup", {
            method: "POST",
            body: signupBody("limited"),
            deviceId: "device-emp002-limited-0001",
        });
        expect(retried.status).toBe(202);
        const stored = await platformPrisma.signupAbuseEvent.findUniqueOrThrow({
            where: { id: rejectionReference },
        });
        expect(stored.reviewedByPlatformAdminId).toBe(platformAdminId);
        expect(stored.overrideUntil).not.toBeNull();
    });

    it("impide consumir otra identidad cuando el correo ya tiene un trial activo", async () => {
        const body = signupBody("active-trial");
        const [error, dto] = OwnerSignupDto.create(body);
        expect(error).toBeUndefined();
        await registrationService.signup(dto!);
        const token = emailSender.messages.at(-1)!.token;
        const verified = await registrationService.verifyEmail(token);

        const role = await platformPrisma.role.findFirstOrThrow({ orderBy: { id: "asc" } });
        const user = await platformPrisma.user.create({
            data: {
                firstName: "Trial",
                lastName: "Existente",
                email: body.email.toUpperCase(),
                password: await bcrypt.hash(body.password, 4),
                roleId: role.id,
            },
        });
        activeTrialUserId = user.id;
        const tenant = await platformPrisma.tenant.create({
            data: {
                slug: `${prefix}-active-trial`,
                name: `Trial ${prefix}`,
                kind: "TRIAL",
                status: "TRIAL",
                trialStartedAt: currentTime,
                trialEndsAt: new Date(currentTime.getTime() + 86_400_000),
            },
        });
        activeTrialTenantId = tenant.id;
        await platformPrisma.tenantMembership.create({
            data: {
                tenantId: tenant.id,
                userId: user.id,
                role: "OWNER",
                status: "ACTIVE",
                activatedAt: currentTime,
            },
        });

        await expect(registrationService.consumeVerifiedIdentity(
            verified.trialToken,
            async (identity) => identity.email,
        )).rejects.toBeInstanceOf(OwnerRegistrationTrialLimitError);
        const registration = await platformPrisma.ownerRegistration.findUniqueOrThrow({
            where: { email: body.email },
        });
        expect(registration.status).toBe("EMAIL_VERIFIED");
        expect(registration.consumedAt).toBeNull();
    });
});
