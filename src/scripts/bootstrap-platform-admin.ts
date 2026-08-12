import "dotenv/config";
import { platformPrisma } from "../data/platform-prisma";

async function main() {
    const configured = String(process.env.PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase();
    const email = configured || (process.env.NODE_ENV === "production" ? "" : "admin@example.com");
    if (!email) {
        console.log("Platform admin bootstrap skipped: PLATFORM_ADMIN_EMAIL no configurado");
        return;
    }
    const [user, role] = await Promise.all([
        platformPrisma.user.findUnique({ where: { email }, select: { id: true, email: true, isActive: true } }),
        platformPrisma.platformRole.findUnique({ where: { code: "SUPER_ADMIN" }, select: { id: true } }),
    ]);
    if (!user?.isActive) throw new Error("PLATFORM_ADMIN_EMAIL debe corresponder a un usuario activo existente");
    if (!role) throw new Error("Falta el rol SUPER_ADMIN; aplica migraciones primero");
    const admin = await platformPrisma.platformAdmin.upsert({
        where: { userId: user.id },
        create: { userId: user.id, roleId: role.id },
        update: { isActive: true },
        select: { id: true, isActive: true, role: { select: { code: true } } },
    });
    console.log("Platform admin bootstrap completed", { email: user.email, id: admin.id, role: admin.role.code, isActive: admin.isActive });
}

if (require.main === module) {
    main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => platformPrisma.$disconnect());
}
