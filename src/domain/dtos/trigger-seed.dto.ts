export class TriggerSeedDto {
    private constructor(
        public readonly key: string | null,
        public readonly includeDemoUsers?: boolean,
        public readonly ensureAdminFromEnv?: boolean,
    ) {}

    static create(object: { [key: string]: unknown }): [string | undefined, TriggerSeedDto | undefined] {
        const key = object?.key;
        const includeDemoUsers = object?.includeDemoUsers;
        const ensureAdminFromEnv = object?.ensureAdminFromEnv;

        if (key !== undefined && typeof key !== 'string') {
            return ['La clave debe ser una cadena de texto', undefined];
        }

        if (includeDemoUsers !== undefined && typeof includeDemoUsers !== 'boolean') {
            return ['includeDemoUsers debe ser booleano', undefined];
        }

        if (ensureAdminFromEnv !== undefined && typeof ensureAdminFromEnv !== 'boolean') {
            return ['ensureAdminFromEnv debe ser booleano', undefined];
        }

        const normalizedKey = typeof key === 'string' ? key.trim() : null;
        if (typeof key === 'string' && !normalizedKey) {
            return ['La clave no puede estar vacia', undefined];
        }

        return [
            undefined,
            new TriggerSeedDto(
                normalizedKey,
                includeDemoUsers as boolean | undefined,
                ensureAdminFromEnv as boolean | undefined,
            ),
        ];
    }
}
