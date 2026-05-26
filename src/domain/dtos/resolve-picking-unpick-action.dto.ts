export type PickingUnpickAction = 'APPROVE' | 'REJECT';

const PICKING_UNPICK_ACTIONS: PickingUnpickAction[] = ['APPROVE', 'REJECT'];

export class ResolvePickingUnpickActionDto {
    private constructor(
        public readonly action: PickingUnpickAction,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, ResolvePickingUnpickActionDto | undefined] {
        const rawAction = typeof object?.action === 'string' ? object.action.trim().toUpperCase() : '';
        const note = typeof object?.note === 'string' ? object.note.trim() : undefined;

        if (!PICKING_UNPICK_ACTIONS.includes(rawAction as PickingUnpickAction)) {
            return ['La accion debe ser APPROVE o REJECT', undefined];
        }

        return [
            undefined,
            new ResolvePickingUnpickActionDto(
                rawAction as PickingUnpickAction,
                note || undefined,
            ),
        ];
    }
}

