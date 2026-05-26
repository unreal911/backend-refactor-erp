import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { envs } from "../../config/envs";
import { UserSeedSummary } from "./types";

export async function bootstrapAdminUser(roleByName: Map<string, { id: number; name: string }>): Promise<UserSeedSummary> {
    const summary: UserSeedSummary = { created: [], updated: [], warnings: [] };

    const adminRole = roleByName.get("ADMIN");
    if (!adminRole) {
        summary.warnings.push("No existe rol ADMIN, se omite bootstrap de administrador.");
        return summary;
    }

    const email = envs.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = envs.SEED_ADMIN_PASSWORD?.trim();

    if (!email || !password) {
        summary.warnings.push("SEED_ADMIN_EMAIL o SEED_ADMIN_PASSWORD no definidos. No se creo administrador por entorno.");
        return summary;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    const shouldResetPassword = envs.SEED_ADMIN_RESET_PASSWORD;
    const hashedPassword = shouldResetPassword || !existing
        ? await bcrypt.hash(password, 10)
        : undefined;

    if (existing) {
        await prisma.user.update({
            where: { id: existing.id },
            data: {
                firstName: envs.SEED_ADMIN_FIRST_NAME,
                lastName: envs.SEED_ADMIN_LAST_NAME,
                roleId: adminRole.id,
                isActive: true,
                ...(hashedPassword ? { password: hashedPassword } : {}),
            },
        });

        summary.updated.push(email);
        return summary;
    }

    await prisma.user.create({
        data: {
            firstName: envs.SEED_ADMIN_FIRST_NAME,
            lastName: envs.SEED_ADMIN_LAST_NAME,
            email,
            password: hashedPassword!,
            roleId: adminRole.id,
            isActive: true,
        },
    });

    summary.created.push(email);
    return summary;
}
