export type PickingResponsibilityRequestAction = 'APPROVE' | 'REJECT';

const PICKING_RESPONSIBILITY_REQUEST_ACTIONS: PickingResponsibilityRequestAction[] = ['APPROVE', 'REJECT'];

export class ResolvePickingResponsibilityRequestDto {
    private constructor(
        public readonly action: PickingResponsibilityRequestAction,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, ResolvePickingResponsibilityRequestDto | undefined] {
        const rawAction = typeof object?.action === 'string' ? object.action.trim().toUpperCase() : '';
        const note = typeof object?.note === 'string' ? object.note.trim() : undefined;

        if (!PICKING_RESPONSIBILITY_REQUEST_ACTIONS.includes(rawAction as PickingResponsibilityRequestAction)) {
            return ['La accion debe ser APPROVE o REJECT', undefined];
        }

        return [
            undefined,
            new ResolvePickingResponsibilityRequestDto(
                rawAction as PickingResponsibilityRequestAction,
                note || undefined,
            ),
        ];
    }
}

