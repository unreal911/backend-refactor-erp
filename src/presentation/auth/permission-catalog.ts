export type PermissionCode = string;

export type PermissionCatalogItemDefinition = {
    code: PermissionCode;
    name: string;
    module: string;
    description: string | null;
};

const WILDCARD_PERMISSION = '*';

export const PERMISSION_CATALOG: PermissionCatalogItemDefinition[] = [
    { code: 'dashboard.view', name: 'Ver dashboard', module: 'dashboard', description: 'Permite ver panel principal' },

    { code: 'users.view', name: 'Ver usuarios', module: 'users', description: 'Permite listar usuarios' },
    { code: 'users.create', name: 'Crear usuarios', module: 'users', description: 'Permite crear usuarios' },
    { code: 'users.update', name: 'Editar usuarios', module: 'users', description: 'Permite editar usuarios' },
    { code: 'users.change_password', name: 'Cambiar password usuarios', module: 'users', description: 'Permite cambiar passwords' },
    { code: 'users.disable', name: 'Desactivar usuarios', module: 'users', description: 'Permite desactivar usuarios' },

    { code: 'roles.view', name: 'Ver roles', module: 'roles', description: 'Permite listar roles' },
    { code: 'roles.create', name: 'Crear roles', module: 'roles', description: 'Permite crear roles' },
    { code: 'roles.update', name: 'Editar roles', module: 'roles', description: 'Permite editar roles' },
    { code: 'roles.permissions', name: 'Gestionar permisos de roles', module: 'roles', description: 'Permite asignar permisos por rol' },

    { code: 'products.view', name: 'Ver productos', module: 'products', description: 'Permite listar productos' },
    { code: 'products.create', name: 'Crear productos', module: 'products', description: 'Permite crear productos' },
    { code: 'products.update', name: 'Editar productos', module: 'products', description: 'Permite editar productos' },
    { code: 'products.disable', name: 'Desactivar productos', module: 'products', description: 'Permite desactivar productos' },

    { code: 'categories.manage', name: 'Gestionar categorias', module: 'categories', description: 'Permite administrar categorias' },
    { code: 'colors.manage', name: 'Gestionar colores', module: 'colors', description: 'Permite administrar colores' },
    { code: 'sizes.manage', name: 'Gestionar tallas', module: 'sizes', description: 'Permite administrar tallas' },

    { code: 'stores.view', name: 'Ver tiendas', module: 'stores', description: 'Permite listar tiendas' },
    { code: 'stores.create', name: 'Crear tiendas', module: 'stores', description: 'Permite crear tiendas' },
    { code: 'stores.update', name: 'Editar tiendas', module: 'stores', description: 'Permite editar tiendas' },
    { code: 'stores.disable', name: 'Desactivar tiendas', module: 'stores', description: 'Permite desactivar tiendas' },

    { code: 'inventory.view', name: 'Ver inventario', module: 'inventory', description: 'Permite listar inventario' },
    { code: 'inventory.movement.create', name: 'Registrar movimientos', module: 'inventory', description: 'Permite registrar movimientos de inventario' },
    { code: 'inventory.adjustment.create', name: 'Registrar ajustes', module: 'inventory', description: 'Permite ajustar inventario' },
    { code: 'inventory.history.view', name: 'Ver historial de inventario', module: 'inventory', description: 'Permite consultar historial de inventario' },

    { code: 'transfers.view', name: 'Ver transferencias', module: 'transfers', description: 'Permite listar transferencias' },
    { code: 'transfers.create', name: 'Crear transferencias', module: 'transfers', description: 'Permite crear transferencias' },
    { code: 'transfers.dispatch', name: 'Despachar transferencias', module: 'transfers', description: 'Permite despachar transferencias' },
    { code: 'transfers.receive', name: 'Recibir transferencias', module: 'transfers', description: 'Permite recibir transferencias' },
    { code: 'transfers.cancel', name: 'Cancelar transferencias', module: 'transfers', description: 'Permite cancelar transferencias' },

    { code: 'orders.view', name: 'Ver ordenes', module: 'orders', description: 'Permite listar ordenes' },
    { code: 'orders.detail.view', name: 'Ver detalle de ordenes', module: 'orders', description: 'Permite ver detalle de ordenes' },
    { code: 'orders.status.update', name: 'Actualizar estado de ordenes', module: 'orders', description: 'Permite cambiar estado de ordenes' },
    { code: 'orders.cancel', name: 'Cancelar ordenes', module: 'orders', description: 'Permite cancelar ordenes' },
    { code: 'orders.print', name: 'Imprimir ordenes', module: 'orders', description: 'Permite imprimir ordenes' },

    { code: 'pos.view', name: 'Ver POS', module: 'pos', description: 'Permite abrir POS' },
    { code: 'pos.sell', name: 'Vender en POS', module: 'pos', description: 'Permite registrar ventas' },
    { code: 'pos.charge', name: 'Cobrar en POS', module: 'pos', description: 'Permite cobrar ventas' },
    { code: 'pos.cancel_sale', name: 'Cancelar venta en POS', module: 'pos', description: 'Permite cancelar ventas' },
    { code: 'pos.discount.apply', name: 'Aplicar descuento en POS', module: 'pos', description: 'Permite aplicar descuentos' },

    { code: 'picking.view', name: 'Ver picking', module: 'picking', description: 'Permite ver tablero de picking' },
    { code: 'picking.start', name: 'Iniciar picking', module: 'picking', description: 'Permite iniciar picking' },
    { code: 'picking.update', name: 'Actualizar picking', module: 'picking', description: 'Permite actualizar picking' },
    { code: 'picking.complete', name: 'Completar picking', module: 'picking', description: 'Permite completar picking' },

    { code: 'payment_methods.manage', name: 'Gestionar metodos de pago', module: 'payment_methods', description: 'Permite crear, editar y activar metodos de pago' },
    { code: 'settings.manage', name: 'Gestionar configuraciones', module: 'settings', description: 'Permite activar o desactivar reglas operativas globales' }
];

export const ROLE_PERMISSION_MATRIX: Record<string, PermissionCode[]> = {
    ADMIN: [WILDCARD_PERMISSION],
    MANAGER: [
        'dashboard.view',
        'users.view',
        'users.create',
        'users.update',
        'users.change_password',
        'roles.view',
        'products.view',
        'products.create',
        'products.update',
        'products.disable',
        'categories.manage',
        'colors.manage',
        'sizes.manage',
        'stores.view',
        'stores.create',
        'stores.update',
        'stores.disable',
        'inventory.view',
        'inventory.history.view',
        'inventory.movement.create',
        'inventory.adjustment.create',
        'transfers.view',
        'transfers.create',
        'transfers.dispatch',
        'transfers.receive',
        'transfers.cancel',
        'orders.view',
        'orders.detail.view',
        'orders.status.update',
        'orders.cancel',
        'orders.print',
        'pos.view',
        'pos.sell',
        'pos.charge',
        'pos.cancel_sale',
        'pos.discount.apply',
        'picking.view',
        'picking.start',
        'picking.update',
        'picking.complete',
        'payment_methods.manage',
        'settings.manage'
    ],
    SELLER: [
        'dashboard.view',
        'products.view',
        'orders.view',
        'orders.detail.view',
        'orders.print',
        'pos.view',
        'pos.sell',
        'pos.charge',
        'pos.cancel_sale',
        'pos.discount.apply'
    ],
    WAREHOUSE: [
        'dashboard.view',
        'products.view',
        'stores.view',
        'inventory.view',
        'inventory.history.view',
        'inventory.movement.create',
        'inventory.adjustment.create',
        'transfers.view',
        'transfers.create',
        'transfers.dispatch',
        'transfers.receive',
        'transfers.cancel',
        'orders.view',
        'orders.detail.view',
        'picking.view',
        'picking.start',
        'picking.update',
        'picking.complete'
    ],
    PICKER: [
        'dashboard.view',
        'orders.view',
        'orders.detail.view',
        'picking.view',
        'picking.start',
        'picking.update',
        'picking.complete'
    ],
    USER: ['dashboard.view']
};

export function normalizePermissionCode(permission: string | null | undefined): string {
    return String(permission || '').trim().toLowerCase();
}

export function normalizeRoleName(roleName: string | null | undefined): string {
    return String(roleName || '').trim().toUpperCase();
}

export function getDefaultPermissionsByRole(roleName: string | null | undefined): PermissionCode[] {
    const normalizedRole = normalizeRoleName(roleName);
    return ROLE_PERMISSION_MATRIX[normalizedRole] || [];
}

export function isWildcardPermission(permission: string | null | undefined): boolean {
    return normalizePermissionCode(permission) === WILDCARD_PERMISSION;
}
