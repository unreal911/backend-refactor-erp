const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

export type AuditLogMethod = (typeof ALLOWED_METHODS)[number];

export class ListAuditLogDto {
    private constructor(
        public readonly page: number = 1,
        public readonly limit: number = 20,
        public readonly search?: string,
        public readonly method?: AuditLogMethod,
        public readonly statusCode?: number,
        public readonly actorUserId?: number,
        public readonly path?: string,
        public readonly startDate?: Date,
        public readonly endDate?: Date,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, ListAuditLogDto | undefined] {
        const {
            page = 1,
            limit = 20,
            search,
            method,
            statusCode,
            actorUserId,
            path,
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

        let methodValue: AuditLogMethod | undefined;
        if (method !== undefined && method !== null && String(method).trim() !== '') {
            const normalizedMethod = String(method).trim().toUpperCase();
            if (!ALLOWED_METHODS.includes(normalizedMethod as AuditLogMethod)) {
                return [`El metodo debe ser uno de: ${ALLOWED_METHODS.join(', ')}`, undefined];
            }
            methodValue = normalizedMethod as AuditLogMethod;
        }

        let statusCodeValue: number | undefined;
        if (statusCode !== undefined && statusCode !== null && String(statusCode).trim() !== '') {
            statusCodeValue = Number(statusCode);
            if (!Number.isInteger(statusCodeValue) || statusCodeValue < 100 || statusCodeValue > 599) {
                return ['El statusCode debe estar entre 100 y 599', undefined];
            }
        }

        let actorUserIdValue: number | undefined;
        if (actorUserId !== undefined && actorUserId !== null && String(actorUserId).trim() !== '') {
            actorUserIdValue = Number(actorUserId);
            if (!Number.isInteger(actorUserIdValue) || actorUserIdValue < 1) {
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

        const pathText = typeof path === 'string' ? path.trim() : '';
        if (path !== undefined && path !== null && typeof path !== 'string') {
            return ['El parametro path no es valido', undefined];
        }

        return [
            undefined,
            new ListAuditLogDto(
                pageNumber,
                limitNumber,
                searchText || undefined,
                methodValue,
                statusCodeValue,
                actorUserIdValue,
                pathText || undefined,
                startDateObj,
                endDateObj,
            ),
        ];
    }
}
