export class DelegateOrderReturnDto {
    private constructor(
        public readonly userId: number,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, DelegateOrderReturnDto | undefined] {
        const parsedUserId = typeof object?.userId === 'string'
            ? Number(object.userId.trim())
            : Number(object?.userId);
        const note = typeof object?.note === 'string' ? object.note.trim() : undefined;

        if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
            return ['El usuario responsable es obligatorio y debe ser un numero valido', undefined];
        }

        return [undefined, new DelegateOrderReturnDto(parsedUserId, note || undefined)];
    }
}
