export type OrderResponsibleRole = 'seller' | 'picker' | 'dispenser';

export const ORDER_RESPONSIBLE_ROLES: OrderResponsibleRole[] = ['seller', 'picker', 'dispenser'];

export class AssignOrderResponsibleDto {
    private constructor(
        public readonly roleType: OrderResponsibleRole,
        public readonly userId: number,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, AssignOrderResponsibleDto | undefined] {
        const { roleType, userId } = object;
        const normalizedRoleType = typeof roleType === 'string' ? roleType.trim().toLowerCase() : '';
        const parsedUserId = typeof userId === 'string' ? Number(userId.trim()) : Number(userId);

        if (!ORDER_RESPONSIBLE_ROLES.includes(normalizedRoleType as OrderResponsibleRole)) {
            return ['El tipo de rol debe ser: seller, picker o dispenser', undefined];
        }

        if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
            return ['El usuario es obligatorio y debe ser un numero valido', undefined];
        }

        return [
            undefined,
            new AssignOrderResponsibleDto(
                normalizedRoleType as OrderResponsibleRole,
                parsedUserId,
            ),
        ];
    }
}
