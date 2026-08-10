import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(),
    tokenFindFirst: vi.fn(),
    tokenFindUnique: vi.fn(),
    tokenCreate: vi.fn(),
    tokenDeleteMany: vi.fn(),
    tokenUpdateMany: vi.fn(),
    transaction: vi.fn(),
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
    };
    return { platformPrisma: client };
});

vi.mock("bcryptjs", () => ({
    default: { hash: mocks.bcryptHash },
}));

import { PasswordResetService, PasswordResetTokenError } from "../src/modules/auth/password-reset.service";

const sender = { sendPasswordResetEmail: vi.fn() };
const now = new Date("2026-08-10T20:00:00.000Z");

function createService() {
    return new PasswordResetService(sender, {
        tokenPepper: "password-reset-test-pepper-with-32-characters",
        ttlMinutes: 30,
        cooldownSeconds: 60,
        bcryptRounds: 4,
        now: () => now,
    });
}

describe("PasswordResetService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            data: expect.objectContaining({ userId: 7, expiresAt: new Date("2026-08-10T20:30:00.000Z") }),
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
});
