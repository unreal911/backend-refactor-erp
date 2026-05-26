import { prisma } from "../data/prisma";
import { runSeed } from "../data/seed";

async function main() {
    const summary = await runSeed({
        includeDemoUsers: false,
        ensureAdminFromEnv: true,
    });

    console.log("Admin bootstrap completed", {
        usersCreated: summary.usersCreated,
        usersUpdated: summary.usersUpdated,
        warnings: summary.warnings,
    });
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
