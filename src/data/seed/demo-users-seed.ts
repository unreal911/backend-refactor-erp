import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { envs } from "../../config/envs";
import { UserSeedSummary } from "./types";

type DemoUserDefinition = {
    email: string;
    firstName: string;
    lastName: string;
    roleName: "ADMIN" | "USER";
};

const DEMO_USERS: DemoUserDefinition[] = [
    {
        email: "admin@example.com",
        firstName: "Admin",
        lastName: "Demo",
        roleName: "ADMIN",
    },
    {
        email: "user@example.com",
        firstName: "Regular",
        lastName: "Demo",
        roleName: "USER",
    },
];

export async function seedDemoUsers(roleByName: Map<string, { id: number; name: string }>): Promise<UserSeedSummary> {
    const summary: UserSeedSummary = { created: [], updated: [], warnings: [] };

    const demoPassword = envs.SEED_DEMO_PASSWORD.trim();
    if (!demoPassword) {
        summary.warnings.push("SEED_DEMO_PASSWORD vacio. No se crearon usuarios demo.");
        return summary;
    }

    const hashedPassword = await bcrypt.hash(demoPassword, 10);

    for (const definition of DEMO_USERS) {
        const role = roleByName.get(definition.roleName);
        if (!role) {
            summary.warnings.push(`No existe rol ${definition.roleName}. Usuario demo ${definition.email} omitido.`);
            continue;
        }

        const existing = await prisma.user.findUnique({ where: { email: definition.email } });
        await prisma.user.upsert({
            where: { email: definition.email },
            update: {
                firstName: definition.firstName,
                lastName: definition.lastName,
                password: hashedPassword,
                roleId: role.id,
                isActive: true,
            },
            create: {
                firstName: definition.firstName,
                lastName: definition.lastName,
                email: definition.email,
                password: hashedPassword,
                roleId: role.id,
                isActive: true,
            },
        });

        if (existing) {
            summary.updated.push(definition.email);
        } else {
            summary.created.push(definition.email);
        }
    }

    return summary;
}
