import { prisma } from "../prisma";
import { envs } from "../../config/envs";
import { bootstrapAdminUser } from "./admin-bootstrap";
import { seedDemoUsers } from "./demo-users-seed";
import { seedBaseRolesAndPermissions } from "./roles-seed";
import { SeedRunOptions, SeedRunSummary } from "./types";

export async function runSeed(options: SeedRunOptions = {}): Promise<SeedRunSummary> {
    const includeDemoUsers = options.includeDemoUsers ?? envs.SEED_INCLUDE_DEMO_USERS;
    const ensureAdminFromEnv = options.ensureAdminFromEnv ?? true;

    const rolesSummary = await seedBaseRolesAndPermissions();

    const usersCreated = new Set<string>();
    const usersUpdated = new Set<string>();
    const warnings: string[] = [];

    if (ensureAdminFromEnv) {
        const adminSummary = await bootstrapAdminUser(rolesSummary.roleByName);
        adminSummary.created.forEach((email) => usersCreated.add(email));
        adminSummary.updated.forEach((email) => usersUpdated.add(email));
        warnings.push(...adminSummary.warnings);
    }

    if (includeDemoUsers) {
        const demoSummary = await seedDemoUsers(rolesSummary.roleByName);
        demoSummary.created.forEach((email) => usersCreated.add(email));
        demoSummary.updated.forEach((email) => usersUpdated.add(email));
        warnings.push(...demoSummary.warnings);
    }

    return {
        roles: rolesSummary.roles,
        usersCreated: Array.from(usersCreated),
        usersUpdated: Array.from(usersUpdated),
        warnings,
        includeDemoUsers,
        ensureAdminFromEnv,
    };
}

async function main() {
    const summary = await runSeed();
    console.log("Seed completed", summary);
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
