import { OrderStatusEnum } from './update-order-status.dto';

export type OrderChannelFilter = 'POS' | 'ECOMMERCE' | 'INTERNAL';

export class ListOrderDto {
    private constructor(
        public readonly page: number = 1,
        public readonly limit: number = 10,
        public readonly status?: OrderStatusEnum,
        public readonly storeId?: number,
        public readonly responsibleUserId?: number,
        public readonly startDate?: Date,
        public readonly endDate?: Date,
        public readonly search?: string,
        public readonly channel?: OrderChannelFilter,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, ListOrderDto | undefined] {
        const {
            page = 1,
            limit = 10,
            status,
            storeId,
            responsibleUserId,
            startDate,
            endDate,
            search,
            channel,
        } = object;

        const pageNumber = Number(page);
        const limitNumber = Number(limit);
        const hasStoreId = storeId !== undefined && storeId !== null && String(storeId).trim() !== '';
        const hasResponsibleUserId =
            responsibleUserId !== undefined && responsibleUserId !== null && String(responsibleUserId).trim() !== '';
        const storeIdNumber = hasStoreId ? Number(storeId) : undefined;
        const responsibleUserIdNumber = hasResponsibleUserId ? Number(responsibleUserId) : undefined;

        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
            return ['La pagina debe ser un numero mayor a 0', undefined];
        }

        if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
            return ['El limite debe estar entre 1 y 100', undefined];
        }

        if (status && !Object.values(OrderStatusEnum).includes(String(status) as OrderStatusEnum)) {
            return [
                `El estado debe ser uno de: ${Object.values(OrderStatusEnum).join(', ')}`,
                undefined,
            ];
        }

        if (hasStoreId && (!Number.isInteger(storeIdNumber) || (storeIdNumber as number) < 1)) {
            return ['La tienda debe ser un numero valido', undefined];
        }

        if (hasResponsibleUserId && (!Number.isInteger(responsibleUserIdNumber) || (responsibleUserIdNumber as number) < 1)) {
            return ['El usuario responsable debe ser un numero valido', undefined];
        }

        const searchText = typeof search === 'string' ? search.trim() : '';
        if (search !== undefined && search !== null && typeof search !== 'string') {
            return ['El parametro de busqueda no es valido', undefined];
        }

        let channelValue: OrderChannelFilter | undefined;
        if (channel !== undefined && channel !== null && String(channel).trim() !== '') {
            const normalizedChannel = String(channel).trim().toUpperCase();
            if (!['POS', 'ECOMMERCE', 'INTERNAL'].includes(normalizedChannel)) {
                return ['El canal debe ser POS, ECOMMERCE o INTERNAL', undefined];
            }
            channelValue = normalizedChannel as OrderChannelFilter;
        }

        let startDateObj: Date | undefined;
        let endDateObj: Date | undefined;

        if (startDate) {
            startDateObj = new Date(startDate);
            if (isNaN(startDateObj.getTime())) {
                return ['La fecha de inicio no es valida', undefined];
            }
            if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
                startDateObj.setHours(0, 0, 0, 0);
            }
        }

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

        return [
            undefined,
            new ListOrderDto(
                pageNumber,
                limitNumber,
                status ? (String(status) as OrderStatusEnum) : undefined,
                storeIdNumber,
                responsibleUserIdNumber,
                startDateObj,
                endDateObj,
                searchText || undefined,
                channelValue,
            ),
        ];
    }
}
