import { PickingResponsibilityMode } from './delegate-picking-responsibility.dto';

const PICKING_RESPONSIBILITY_MODES: PickingResponsibilityMode[] = ['SHARED', 'TRANSFER'];

export class RequestPickingResponsibilityDto {
    private constructor(
        public readonly mode: PickingResponsibilityMode,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, RequestPickingResponsibilityDto | undefined] {
        const rawMode = typeof object?.mode === 'string' ? object.mode.trim().toUpperCase() : 'SHARED';
        const note = typeof object?.note === 'string' ? object.note.trim() : undefined;

        if (!PICKING_RESPONSIBILITY_MODES.includes(rawMode as PickingResponsibilityMode)) {
            return ['El modo debe ser SHARED o TRANSFER', undefined];
        }

        return [
            undefined,
            new RequestPickingResponsibilityDto(
                rawMode as PickingResponsibilityMode,
                note || undefined,
            ),
        ];
    }
}

