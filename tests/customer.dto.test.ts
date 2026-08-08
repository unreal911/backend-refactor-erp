import { describe, expect, it } from 'vitest';
import { ListCustomerDto, SaveCustomerDto } from '../src/domain/dtos/customer.dto';
import { CreateOrderDto } from '../src/domain/dtos/create-order.dto';

describe('Customer DTOs', () => {
    it('normaliza una ficha con DNI', () => {
        const [error, dto] = SaveCustomerDto.create({
            name: '  Maria Perez  ',
            documentType: '1',
            documentNumber: '74859621',
            email: ' MARIA@EXAMPLE.COM ',
        });
        expect(error).toBeUndefined();
        expect(dto).toMatchObject({
            name: 'Maria Perez',
            documentType: '1',
            documentNumber: '74859621',
            email: 'maria@example.com',
            isActive: true,
        });
    });

    it('rechaza DNI y RUC con longitud incorrecta', () => {
        expect(SaveCustomerDto.create({ name: 'Maria', documentType: '1', documentNumber: '123' })[0])
            .toContain('8 digitos');
        expect(SaveCustomerDto.create({ name: 'Empresa SAC', documentType: '6', documentNumber: '2012' })[0])
            .toContain('11 digitos');
    });

    it('acepta busqueda paginada y estado activo', () => {
        const [error, dto] = ListCustomerDto.create({ page: '2', limit: '8', search: ' 7485 ', isActive: 'true' });
        expect(error).toBeUndefined();
        expect(dto).toMatchObject({ page: 2, limit: 8, search: '7485', isActive: true });
    });

    it('valida customerId al crear una venta', () => {
        const base = { sourceStoreId: 1, items: [{ variantId: 1, quantity: 1, unitPrice: 10 }] };
        expect(CreateOrderDto.create({ ...base, customerId: 12 })[1]?.customerId).toBe(12);
        expect(CreateOrderDto.create({ ...base, customerId: 0 })[0]).toContain('customerId');
    });
});
