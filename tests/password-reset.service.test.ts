import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(),
    tokenFindFirst: vi.fn(),
    tokenFindUnique: vi.fn(),
    tokenCreate: vi.fn(),
    tokenDeleteMany: vi.fn(),
    tokenUpdateMany: vi.fn(),
    transaction: vi.fn(),
    queryRaw: vi.fn(),
    bcryptHash: vi.fn(),
}));

vi.mock("../src/data/platform-prisma", () => {
    const client = {
        user: {
            findUnique: mocks.userFindUnique,
            update: mocks.userUpdate,
        },
        passwordResetToken: {
            findFirst: mocks.tokenFindFirst,
            findUnique: mocks.tokenFindUnique,
            create: mocks.tokenCreate,
            deleteMany: mocks.tokenDeleteMany,
            updateMany: mocks.tokenUpdateMany,
        },
        $transaction: mocks.transaction,
        $queryRaw: mocks.queryRaw,
    };
    return { platformPrisma: client };
});

vi.mock("bcryptjs", () => ({
    default: { hash: mocks.bcryptHash },
}));

import { PasswordResetService, PasswordResetTokenError } from "../src/modules/auth/password-reset.service";

const sender = { sendPasswordResetEmail: vi.fn() };
const now = new Date("2026-08-10T20:00:00.000Z");

function createService(overrides: Record<string, unknown> = {}) {
    return new PasswordResetService(sender, {
        tokenPepper: "password-reset-test-pepper-with-32-characters",
        ttlMinutes: 30,
        cooldownSeconds: 60,
        bcryptRounds: 4,
        now: () => now,
        ...overrides,
    });
}

describe("PasswordResetService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.queryRaw.mockResolvedValue([{
            passwordResetEmailEnabled: true,
            passwordResetWhatsappEnabled: false,
        }]);
        mocks.transaction.mockImplementation(async (callback) => callback({
            user: { update: mocks.userUpdate },
            passwordResetToken: { updateMany: mocks.tokenUpdateMany },
        }));
    });

    it("responde sin enviar correo cuando la cuenta no existe", async () => {
        mocks.userFindUnique.mockResolvedValue(null);

        await createService().request("nadie@example.test");

        expect(mocks.tokenCreate).not.toHaveBeenCalled();
        expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("crea y envía un enlace temporal para una cuenta activa", async () => {
        mocks.userFindUnique.mockResolvedValue({
            id: 7,
            email: "ana@example.test",
            firstName: "Ana",
            isActive: true,
        });
        mocks.tokenFindFirst.mockResolvedValue(null);
        mocks.tokenCreate.mockResolvedValue({ id: "reset-1" });

        await createService().request("ANA@example.test");

        expect(mocks.tokenCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: 7,
                expiresAt: new Date("2026-08-10T20:30:00.000Z"),
                failedAttempts: 0,
            }),
        }));
        expect(sender.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: "ana@example.test",
            userName: "Ana",
        }));
    });

    it("no duplica correos dentro del tiempo de espera", async () => {
        mocks.userFindUnique.mockResolvedValue({
            id: 7,
            email: "ana@example.test",
            firstName: "Ana",
            isActive: true,
        });
        mocks.tokenFindFirst.mockResolvedValue({ id: "recent" });

        await createService().request("ana@example.test");

        expect(mocks.tokenCreate).not.toHaveBeenCalled();
        expect(sender.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("cambia la contraseña, invalida sesiones y consume los enlaces", async () => {
        mocks.tokenFindUnique.mockResolvedValue({
            id: "reset-1",
            userId: 7,
            expiresAt: new Date("2026-08-10T20:30:00.000Z"),
            usedAt: null,
        });
        mocks.tokenFindFirst.mockResolvedValue({ id: "reset-1" });
        mocks.bcryptHash.mockResolvedValue("new-password-hash");
        mocks.tokenUpdateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 2 });
        mocks.userUpdate.mockResolvedValue({ id: 7 });

        await createService().confirm("valid-reset-token-value-with-more-than-40-chars", "Nueva!Clave2026");

        expect(mocks.userUpdate).toHaveBeenCalledWith({
            where: { id: 7, isActive: true },
            data: {
                password: "new-password-hash",
                authVersion: { increment: 1 },
            },
        });
        expect(mocks.tokenUpdateMany).toHaveBeenCalledTimes(2);
    });

    it("rechaza un enlace vencido o ya utilizado", async () => {
        mocks.tokenFindUnique.mockResolvedValue({
            id: "reset-1",
            userId: 7,
            expiresAt: new Date("2026-08-10T19:59:59.000Z"),
            usedAt: null,
        });

        await expect(
            createService().confirm("expired-reset-token-value-with-more-than-40-chars", "Nueva!Clave2026"),
        ).rejects.toBeInstanceOf(PasswordResetTokenError);
        expect(mocks.userUpdate).not.toHaveBeenCalled();
    });

    it("genera OTP de 6 dígitos con vigencia corta para WhatsApp", async () => {
        mocks.queryRaw.mockResolvedValue([{
            passwordResetEmailEnabled: true,
            passwordResetWhatsappEnabled: true,
        }]);
        mocks.userFindUnique.mockResolvedValue({
            id: 7,
            phone: "+51999888777",
            email: null,
            firstName: "Ana",
            isActive: true,
        });
        mocks.tokenFindFirst.mockResolvedValue(null);
        mocks.tokenCreate.mockResolvedValue({ id: "reset-otp" });

        await createService({
            whatsappOtpTtlMinutes: 10,
            createWhatsappOtp: () => "428193",
        }).request("+51999888777", "whatsapp");

        expect(mocks.tokenCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: 7,
                expiresAt: new Date("2026-08-10T20:10:00.000Z"),
                failedAttempts: 0,
                tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
        }));
        expect(sender.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
            token: "428193",
            channel: "whatsapp",
        }));
        expect(mocks.tokenCreate.mock.calls[0]?.[0]?.data?.tokenHash).not.toContain("428193");
    });

    it("liga el OTP al teléfono para evitar colisiones entre cuentas", async () => {
        mocks.queryRaw.mockResolvedValue([{
            passwordResetEmailEnabled: true,
            passwordResetWhatsappEnabled: true,
        }]);
        mocks.tokenFindFirst.mockResolvedValue(null);
        mocks.tokenCreate.mockResolvedValue({ id: "reset-otp" });
        mocks.userFindUnique
            .mockResolvedValueOnce({ id: 7, phone: "+51999888777", email: null, firstName: "Ana", isActive: true })
            .mockResolvedValueOnce({ id: 8, phone: "+51999777666", email: null, firstName: "Eva", isActive: true });
        const service = createService({ createWhatsappOtp: () => "428193" });

        await service.request("+51999888777", "whatsapp");
        await service.request("+51999777666", "whatsapp");

        const firstHash = mocks.tokenCreate.mock.calls[0]?.[0]?.data?.tokenHash;
        const secondHash = mocks.tokenCreate.mock.calls[1]?.[0]?.data?.tokenHash;
        expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
        expect(secondHash).toMatch(/^[a-f0-9]{64}$/);
        expect(firstHash).not.toBe(secondHash);
    });

    it("registra intentos OTP fallidos y bloquea antes de cambiar la contraseña", async () => {
        mocks.userFindUnique.mockResolvedValue({ id: 7 });
        mocks.tokenFindFirst.mockResolvedValue({
            id: "reset-otp",
            userId: 7,
            tokenHash: "a".repeat(64),
            expiresAt: new Date("2026-08-10T20:10:00.000Z"),
            usedAt: null,
            failedAttempts: 0,
        });
        mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });

        await expect(createService({ whatsappOtpMaxAttempts: 5 }).confirm(
            "428193",
            "Nueva!Clave2026",
            "+51999888777",
        )).rejects.toBeInstanceOf(PasswordResetTokenError);

        expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({
            where: {
                id: "reset-otp",
                usedAt: null,
                failedAttempts: { lt: 5 },
            },
            data: { failedAttempts: { increment: 1 } },
        });
        expect(mocks.bcryptHash).not.toHaveBeenCalled();
    });

    it("acepta el OTP correcto ligado al teléfono e invalida las sesiones", async () => {
        const phone = "+51999888777";
        const otp = "428193";
        const tokenHash = createHmac(
            "sha256",
            "password-reset-test-pepper-with-32-characters",
        ).update(`whatsapp:${phone}:${otp}`).digest("hex");
        mocks.userFindUnique.mockResolvedValue({ id: 7 });
        mocks.tokenFindFirst
            .mockResolvedValueOnce({
                id: "reset-otp",
                userId: 7,
                tokenHash,
                expiresAt: new Date("2026-08-10T20:10:00.000Z"),
                usedAt: null,
                failedAttempts: 0,
            })
            .mockResolvedValueOnce({ id: "reset-otp" });
        mocks.bcryptHash.mockResolvedValue("new-password-hash");
        mocks.tokenUpdateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 1 });

        await createService({ whatsappOtpMaxAttempts: 5 }).confirm(
            otp,
            "Nueva!Clave2026",
            phone,
        );

        expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7, isActive: true },
            data: expect.objectContaining({ authVersion: { increment: 1 } }),
        }));
    });
});
