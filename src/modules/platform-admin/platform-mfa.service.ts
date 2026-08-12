import { PlatformMfaStatus } from "@prisma/client";
import { envs } from "../../config/envs";
import { platformPrisma } from "../../data/platform-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { createRecoveryCodes, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, recoveryHash, verifyTotp } from "./platform-mfa-crypto";
import { PlatformAuditService } from "./platform-audit.service";

type Actor = { platformAdminId: string; correlationId: string | null };

export class PlatformMfaService {
    static async status(platformAdminId: string) {
        const admin = await platformPrisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId }, include: { role: { include: { permissions: true } } } });
        return { required: envs.PLATFORM_MFA_REQUIRED, status: admin.mfaStatus, enrolledAt: admin.mfaEnrolledAt, lockedUntil: admin.mfaLockedUntil, recoveryCodesRemaining: admin.recoveryCodeHashes.length, role: admin.role.code, permissions: admin.role.permissions.map((item) => item.permissionCode).sort() };
    }

    static async begin(actor: Actor) {
        const admin = await platformPrisma.platformAdmin.findUniqueOrThrow({ where: { id: actor.platformAdminId }, include: { user: { select: { email: true } } } });
        if (admin.mfaStatus === PlatformMfaStatus.ENABLED) throw CustomError.conflict("MFA ya está habilitado");
        const secret = generateTotpSecret();
        await platformPrisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaStatus: PlatformMfaStatus.PENDING, totpSecretEncrypted: encryptTotpSecret(secret), recoveryCodeHashes: [], mfaFailedAttempts: 0, mfaLockedUntil: null } });
        await PlatformAuditService.record({ actorPlatformAdminId: admin.id, action: "PLATFORM_MFA_ENROLLMENT_STARTED", entityType: "PlatformAdmin", entityId: admin.id, correlationId: actor.correlationId });
        const label = encodeURIComponent(`${envs.PLATFORM_MFA_ISSUER}:${admin.user.email}`); const issuer = encodeURIComponent(envs.PLATFORM_MFA_ISSUER);
        return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
    }

    static async confirm(code: string, actor: Actor) {
        const admin = await platformPrisma.platformAdmin.findUniqueOrThrow({ where: { id: actor.platformAdminId } });
        if (admin.mfaStatus !== PlatformMfaStatus.PENDING || !admin.totpSecretEncrypted) throw CustomError.conflict("No existe un enrolamiento MFA pendiente");
        if (!verifyTotp(decryptTotpSecret(admin.totpSecretEncrypted), code)) throw CustomError.badRequest("El código MFA no es válido");
        const recoveryCodes = createRecoveryCodes();
        await platformPrisma.$transaction(async (tx) => {
            await tx.platformAdmin.update({ where: { id: admin.id }, data: { mfaStatus: PlatformMfaStatus.ENABLED, recoveryCodeHashes: recoveryCodes.map(recoveryHash), mfaFailedAttempts: 0, mfaLockedUntil: null, mfaEnrolledAt: new Date() } });
            await tx.user.update({ where: { id: admin.userId }, data: { authVersion: { increment: 1 } } });
            await PlatformAuditService.record({ actorPlatformAdminId: admin.id, action: "PLATFORM_MFA_ENABLED", entityType: "PlatformAdmin", entityId: admin.id, correlationId: actor.correlationId }, tx);
        });
        return { recoveryCodes, sessionInvalidated: true };
    }

    static async verifyForLogin(adminId: string, code?: string, recoveryCode?: string): Promise<{ required: boolean; verifiedAt?: number }> {
        const admin = await platformPrisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
        if (admin.mfaStatus !== PlatformMfaStatus.ENABLED && admin.mfaStatus !== PlatformMfaStatus.LOCKED) return { required: envs.PLATFORM_MFA_REQUIRED };
        if (admin.mfaLockedUntil && admin.mfaLockedUntil > new Date()) throw new Error("MFA temporalmente bloqueado");
        if (!code && !recoveryCode) return { required: true };
        let valid = false; let usedHash: string | null = null;
        if (code && admin.totpSecretEncrypted) valid = verifyTotp(decryptTotpSecret(admin.totpSecretEncrypted), code);
        if (!valid && recoveryCode) { usedHash = recoveryHash(recoveryCode); valid = admin.recoveryCodeHashes.includes(usedHash); }
        if (!valid) {
            const attempts = admin.mfaFailedAttempts + 1;
            await platformPrisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaFailedAttempts: attempts >= 5 ? 0 : attempts, ...(attempts >= 5 ? { mfaLockedUntil: new Date(Date.now() + 5 * 60 * 1000), mfaStatus: PlatformMfaStatus.LOCKED } : {}) } });
            throw new Error("Código MFA inválido");
        }
        await platformPrisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaFailedAttempts: 0, mfaLockedUntil: null, mfaStatus: PlatformMfaStatus.ENABLED, ...(usedHash ? { recoveryCodeHashes: admin.recoveryCodeHashes.filter((item) => item !== usedHash) } : {}) } });
        return { required: true, verifiedAt: Math.floor(Date.now() / 1000) };
    }
}
