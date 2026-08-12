import { platformPrisma } from "../../data/platform-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { PlatformAuditService } from "./platform-audit.service";

type Actor = { platformAdminId: string; correlationId: string | null };

export class PlatformAccessService {
    static async list() {
        const [admins, roles] = await Promise.all([
            platformPrisma.platformAdmin.findMany({
                include: { user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } }, role: { select: { id: true, code: true, name: true, version: true } } },
                orderBy: { createdAt: "asc" },
            }),
            platformPrisma.platformRole.findMany({ where: { isActive: true }, include: { permissions: { select: { permissionCode: true } } }, orderBy: { name: "asc" } }),
        ]);
        return { admins: admins.map((admin) => ({ ...admin, totpSecretEncrypted: undefined, recoveryCodeHashes: undefined })), roles: roles.map((role) => ({ ...role, permissions: role.permissions.map((item) => item.permissionCode).sort() })) };
    }

    static async grant(input: Record<string, unknown>, actor: Actor) {
        const email = String(input.email || "").trim().toLowerCase(); const roleCode = String(input.roleCode || "").trim().toUpperCase();
        if (!email) throw CustomError.badRequest("El correo es obligatorio");
        const [user, role] = await Promise.all([
            platformPrisma.user.findUnique({ where: { email }, include: { platformAdmin: true } }),
            platformPrisma.platformRole.findUnique({ where: { code: roleCode } }),
        ]);
        if (!user?.isActive) throw CustomError.notFound("No existe un usuario activo con ese correo");
        if (!role?.isActive) throw CustomError.badRequest("El rol no está disponible");
        if (user.platformAdmin?.isActive) throw CustomError.conflict("El usuario ya tiene acceso de plataforma");
        const admin = await platformPrisma.$transaction(async (tx) => {
            const result = user.platformAdmin
                ? await tx.platformAdmin.update({ where: { id: user.platformAdmin.id }, data: { isActive: true, roleId: role.id, mfaStatus: "DISABLED", totpSecretEncrypted: null, recoveryCodeHashes: [] } })
                : await tx.platformAdmin.create({ data: { userId: user.id, roleId: role.id } });
            await tx.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
            await PlatformAuditService.record({ actorPlatformAdminId: actor.platformAdminId, action: "PLATFORM_ACCESS_GRANTED", entityType: "PlatformAdmin", entityId: result.id, reason: String(input.reason || "Acceso autorizado"), correlationId: actor.correlationId, after: { userId: user.id, email: user.email, role: role.code } }, tx);
            return result;
        });
        return { id: admin.id, email: user.email, role: role.code };
    }

    static async update(id: string, input: Record<string, unknown>, actor: Actor) {
        const before = await platformPrisma.platformAdmin.findUnique({ where: { id }, include: { user: true, role: true } });
        if (!before) throw CustomError.notFound("El administrador no existe");
        const requestedActive = typeof input.isActive === "boolean" ? input.isActive : before.isActive;
        const roleCode = input.roleCode ? String(input.roleCode).toUpperCase() : before.role.code;
        const role = await platformPrisma.platformRole.findUnique({ where: { code: roleCode } });
        if (!role?.isActive) throw CustomError.badRequest("El rol no está disponible");
        const removesSuper = before.isActive && before.role.code === "SUPER_ADMIN" && (!requestedActive || role.code !== "SUPER_ADMIN");
        if (removesSuper) {
            const remaining = await platformPrisma.platformAdmin.count({ where: { id: { not: before.id }, isActive: true, role: { code: "SUPER_ADMIN" } } });
            if (remaining === 0) throw CustomError.conflict("No se puede retirar al último SUPER_ADMIN activo");
        }
        const reason = String(input.reason || "").trim(); if (reason.length < 8) throw CustomError.badRequest("Explica el motivo del cambio");
        const after = await platformPrisma.$transaction(async (tx) => {
            const result = await tx.platformAdmin.update({ where: { id }, data: { roleId: role.id, isActive: requestedActive } });
            await tx.user.update({ where: { id: before.userId }, data: { authVersion: { increment: 1 } } });
            await PlatformAuditService.record({ actorPlatformAdminId: actor.platformAdminId, action: "PLATFORM_ACCESS_UPDATED", entityType: "PlatformAdmin", entityId: id, reason, correlationId: actor.correlationId, before: { email: before.user.email, role: before.role.code, isActive: before.isActive }, after: { email: before.user.email, role: role.code, isActive: requestedActive } }, tx);
            return result;
        });
        return { id: after.id, email: before.user.email, role: role.code, isActive: after.isActive };
    }
}
