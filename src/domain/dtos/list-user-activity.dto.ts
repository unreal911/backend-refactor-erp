export class ListUserActivityDto {
    private constructor(
        public readonly page: number = 1,
        public readonly limit: number = 20,
        public readonly search?: string,
        public readonly userId?: number,
        public readonly module?: string,
        public readonly actionType?: string,
        public readonly entityType?: string,
        public readonly startDate?: Date,
        public readonly endDate?: Date,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, ListUserActivityDto | undefined] {
        const {
            page = 1,
            limit = 20,
            search,
            userId,
            module,
            actionType,
            entityType,
            startDate,
            endDate,
        } = object;

        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
            return ['La pagina debe ser un numero mayor a 0', undefined];
        }

        if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
            return ['El limite debe estar entre 1 y 100', undefined];
        }

        let userIdValue: number | undefined;
        if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
            userIdValue = Number(userId);
            if (!Number.isInteger(userIdValue) || userIdValue < 1) {
                return ['El usuario debe ser un numero valido', undefined];
            }
        }

        let startDateObj: Date | undefined;
        if (startDate) {
            startDateObj = new Date(startDate);
            if (isNaN(startDateObj.getTime())) {
                return ['La fecha de inicio no es valida', undefined];
            }
            if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
                startDateObj.setHours(0, 0, 0, 0);
            }
        }

        let endDateObj: Date | undefined;
        if (endDate) {
            endDateObj = new Date(endDate);
            if (isNaN(endDateObj.getTime())) {
                return ['La fecha de fin no es valida', undefined];
            }
            if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                endDateObj.setHours(23, 59, 59, 999);
            }
        }

        if (startDateObj && endDateObj && startDateObj > endDateObj) {
            return ['La fecha de inicio debe ser anterior a la fecha de fin', undefined];
        }

        const searchText = typeof search === 'string' ? search.trim() : '';
        if (search !== undefined && search !== null && typeof search !== 'string') {
            return ['El parametro de busqueda no es valido', undefined];
        }

        const moduleText = typeof module === 'string' ? module.trim().toUpperCase() : '';
        if (module !== undefined && module !== null && typeof module !== 'string') {
            return ['El modulo no es valido', undefined];
        }

        const actionTypeText = typeof actionType === 'string' ? actionType.trim().toUpperCase() : '';
        if (actionType !== undefined && actionType !== null && typeof actionType !== 'string') {
            return ['El tipo de accion no es valido', undefined];
        }

        const entityTypeText = typeof entityType === 'string' ? entityType.trim().toUpperCase() : '';
        if (entityType !== undefined && entityType !== null && typeof entityType !== 'string') {
            return ['El tipo de entidad no es valido', undefined];
        }

        return [
            undefined,
            new ListUserActivityDto(
                pageNumber,
                limitNumber,
                searchText || undefined,
                userIdValue,
                moduleText || undefined,
                actionTypeText || undefined,
                entityTypeText || undefined,
                startDateObj,
                endDateObj,
            ),
        ];
    }
}
