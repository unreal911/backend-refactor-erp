import { describe, expect, it } from 'vitest';
import { getDefaultPermissionsByRole } from '../src/presentation/auth/permission-catalog';

const PICKING_PERMISSIONS = [
  'picking.view',
  'picking.start',
  'picking.update',
  'picking.complete',
];

describe('permisos de preparación y despacho por rol', () => {
  it.each(['MANAGER', 'WAREHOUSE', 'PICKER'])(
    '%s puede ejecutar el ciclo completo de picking',
    (role) => {
      expect(getDefaultPermissionsByRole(role)).toEqual(
        expect.arrayContaining(PICKING_PERMISSIONS),
      );
    },
  );

  it.each(['SELLER', 'USER'])(
    '%s no recibe permisos de picking por defecto',
    (role) => {
      const permissions = getDefaultPermissionsByRole(role);
      for (const permission of PICKING_PERMISSIONS) {
        expect(permissions).not.toContain(permission);
      }
    },
  );

  it('mantiene pedidos y tareas propias separados de la operación de almacén', () => {
    const seller = getDefaultPermissionsByRole('SELLER');
    const user = getDefaultPermissionsByRole('USER');

    expect(seller).toEqual(expect.arrayContaining(['orders.view', 'tasks.view.own']));
    expect(user).toContain('tasks.view.own');
    expect(user).not.toContain('orders.view');
  });

  it('conserva el comodín del administrador sin duplicar permisos', () => {
    expect(getDefaultPermissionsByRole('ADMIN')).toEqual(['*']);
  });
});
