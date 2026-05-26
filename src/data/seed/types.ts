export type RoleSeedSummary = {
    roles: string[];
    roleByName: Map<string, { id: number; name: string }>;
};

export type UserSeedSummary = {
    created: string[];
    updated: string[];
    warnings: string[];
};

export type SeedRunSummary = {
    roles: string[];
    usersCreated: string[];
    usersUpdated: string[];
    warnings: string[];
    includeDemoUsers: boolean;
    ensureAdminFromEnv: boolean;
};

export type SeedRunOptions = {
    includeDemoUsers?: boolean;
    ensureAdminFromEnv?: boolean;
};
