export type PickingResponsibilityMode = 'SHARED' | 'TRANSFER';

const PICKING_RESPONSIBILITY_MODES: PickingResponsibilityMode[] = ['SHARED', 'TRANSFER'];

export class DelegatePickingResponsibilityDto {
    private constructor(
        public readonly userId: number,
        public readonly mode: PickingResponsibilityMode,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, DelegatePickingResponsibilityDto | undefined] {
        const parsedUserId = typeof object?.userId === 'string'
            ? Number(object.userId.trim())
            : Number(object?.userId);

        const rawMode = typeof object?.mode === 'string' ? object.mode.trim().toUpperCase() : 'TRANSFER';
        const note = typeof object?.note === 'string' ? object.note.trim() : undefined;

        if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
            return ['El usuario destino es obligatorio y debe ser un numero valido', undefined];
        }

        if (!PICKING_RESPONSIBILITY_MODES.includes(rawMode as PickingResponsibilityMode)) {
            return ['El modo debe ser SHARED o TRANSFER', undefined];
        }

        return [
            undefined,
            new DelegatePickingResponsibilityDto(
                parsedUserId,
                rawMode as PickingResponsibilityMode,
                note || undefined,
            ),
        ];
    }
}

