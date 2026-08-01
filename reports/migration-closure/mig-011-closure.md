# Reporte de cierre MIG-011

- Generado: 2026-07-29T22:12:18.404Z
- Duración: 1002.99 ms
- Tenant: `00000000-0000-4000-8000-000000000001`
- JSON verificable: `mig-011-closure.json`
- Huella final: `653f0154c6b349e8a8d6b95cf4d9d8960f6ed4acc757b82ed3d0a4dcae23f6cf`
- Resultado: **READY**

## Cobertura origen/destino

| Lote | Tabla | Origen | Destino | Filas posteriores |
|---|---|---:|---:|---:|
| MIG-003 | Tenant | 1 | 1 | 0 |
| MIG-003 | User | 3 | 3 | 0 |
| MIG-003 | TenantMembership | 3 | 3 | 0 |
| MIG-003 | Role | 6 | 6 | 0 |
| MIG-003 | Permission | 47 | 47 | 0 |
| MIG-003 | RolePermission | 78 | 78 | 0 |
| MIG-004 | Category | 4 | 4 | 0 |
| MIG-004 | Color | 3 | 3 | 0 |
| MIG-004 | Size | 4 | 4 | 0 |
| MIG-004 | Product | 2 | 2 | 0 |
| MIG-004 | ProductImage | 8 | 8 | 0 |
| MIG-004 | ProductVariant | 13 | 13 | 0 |
| MIG-005 | Store | 2 | 2 | 0 |
| MIG-005 | Inventory | 5 | 5 | 0 |
| MIG-006 | InventoryMovement | 387 | 387 | 0 |
| MIG-006 | StockTransfer | 0 | 0 | 0 |
| MIG-006 | StockTransferItem | 0 | 0 | 0 |
| MIG-007 | Order | 42 | 42 | 0 |
| MIG-007 | OrderItem | 106 | 106 | 0 |
| MIG-007 | Reservation | 161 | 161 | 0 |
| MIG-007 | PickingSession | 14 | 14 | 0 |
| MIG-007 | PickingItem | 14 | 14 | 0 |
| MIG-007 | PickingSharedResponsibility | 0 | 0 | 0 |
| MIG-007 | PickingResponsibilityRequest | 0 | 0 | 0 |
| MIG-007 | PickingItemContribution | 1 | 1 | 0 |
| MIG-007 | PickingUnpickRequest | 0 | 0 | 0 |
| MIG-007 | PickingOrderItemDetail | 99 | 99 | 0 |
| MIG-008 | OrderReturn | 0 | 0 | 0 |
| MIG-008 | OrderReturnItem | 0 | 0 | 0 |
| MIG-009 | MarketplaceCustomer | 14 | 14 | 0 |
| MIG-009 | PaymentMethod | 6 | 6 | 0 |
| MIG-009 | SystemSetting | 18 | 18 | 0 |
| MIG-010 | AuditLog | 30418 | 30418 | 102 |
| MIG-010 | UserActivityLog | 509 | 509 | 0 |

## Integridad

- Tablas tenant con `tenantId NOT NULL`: 27
- Tablas tenant indexadas: 27
- Restricciones no validadas: 0
- Huérfanos: 0
- Relaciones cruzadas: 0
- Conflictos no explicados: 0

## Cuarentena aprobada

- Código: `QUARANTINED_LEGACY_PICKING_OVERFLOW`
- Origen: `PickingItem#8`
- Resolución: `ARCHIVED_OUTSIDE_OPERATIONAL_FLOW`
- Detalles relacionados preservados: 6
- Huella original: `04b6194b595f2320405b26111233a4fc17f1f4bb0129966a0ed643df694e6085`

## Secuencias

| Tabla | Máximo | Posición | Próximo ID seguro |
|---|---:|---:|---|
| AuditLog | 30661 | 30661 | sí |
| Category | 4 | 31 | sí |
| Color | 3 | 5 | sí |
| Inventory | 17 | 148 | sí |
| InventoryMovement | 1111 | 1195 | sí |
| MarketplaceCustomer | 26 | 34 | sí |
| Order | 1000 | 1152 | sí |
| OrderItem | 972 | 1088 | sí |
| OrderReturn | vacía | 18 | sí |
| OrderReturnItem | vacía | 14 | sí |
| PaymentMethod | 6 | 118 | sí |
| Permission | 2301 | 2959 | sí |
| PickingItem | 457 | 507 | sí |
| PickingItemContribution | 260 | 300 | sí |
| PickingOrderItemDetail | 926 | 1010 | sí |
| PickingResponsibilityRequest | vacía | 20 | sí |
| PickingSession | 465 | 517 | sí |
| PickingSharedResponsibility | vacía | 22 | sí |
| PickingUnpickRequest | vacía | 6 | sí |
| Product | 8 | 147 | sí |
| ProductImage | 40 | 46 | sí |
| ProductVariant | 19 | 156 | sí |
| Reservation | 969 | 1049 | sí |
| Role | 6 | 6 | sí |
| RolePermission | 78 | 1170 | sí |
| Size | 4 | 6 | sí |
| StockTransfer | vacía | 20 | sí |
| StockTransferItem | vacía | 12 | sí |
| Store | 2 | 41 | sí |
| SystemSetting | 720 | 1004 | sí |
| User | 3 | 21 | sí |
| UserActivityLog | 537 | 541 | sí |
