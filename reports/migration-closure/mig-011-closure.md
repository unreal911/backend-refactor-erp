# Reporte de cierre MIG-011

- Generado: 2026-08-02T18:27:13.373Z
- Duración: 1390.16 ms
- Tenant: `00000000-0000-4000-8000-000000000001`
- JSON verificable: `mig-011-closure.json`
- Huella final: `b730d2aaad2742fcce0fa21c889703d99bc10d7a2c458d49e5af654ad6906e78`
- Resultado: **READY**

## Cobertura origen/destino

| Lote | Tabla | Origen | Destino | Filas posteriores |
|---|---|---:|---:|---:|
| MIG-003 | Tenant | 1 | 1 | 0 |
| MIG-003 | User | 3 | 3 | 151 |
| MIG-003 | TenantMembership | 3 | 3 | 91 |
| MIG-003 | Role | 6 | 6 | 0 |
| MIG-003 | Permission | 49 | 49 | 0 |
| MIG-003 | RolePermission | 78 | 78 | 0 |
| MIG-004 | Category | 4 | 4 | 1 |
| MIG-004 | Color | 3 | 3 | 0 |
| MIG-004 | Size | 4 | 4 | 0 |
| MIG-004 | Product | 2 | 2 | 1 |
| MIG-004 | ProductImage | 8 | 8 | 0 |
| MIG-004 | ProductVariant | 13 | 13 | 1 |
| MIG-005 | Store | 2 | 2 | 1 |
| MIG-005 | Inventory | 5 | 5 | 1 |
| MIG-006 | InventoryMovement | 387 | 387 | 0 |
| MIG-006 | StockTransfer | 0 | 0 | 0 |
| MIG-006 | StockTransferItem | 0 | 0 | 0 |
| MIG-007 | Order | 42 | 42 | 1 |
| MIG-007 | OrderItem | 106 | 106 | 1 |
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
| MIG-009 | MarketplaceCustomer | 14 | 14 | 1 |
| MIG-009 | PaymentMethod | 6 | 6 | 1 |
| MIG-009 | SystemSetting | 18 | 18 | 0 |
| MIG-010 | AuditLog | 30418 | 30418 | 215 |
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
| AuditLog | 30837 | 30862 | sí |
| Category | 90 | 427 | sí |
| Color | 3 | 21 | sí |
| Inventory | 357 | 1180 | sí |
| InventoryMovement | 1111 | 1752 | sí |
| MarketplaceCustomer | 47 | 141 | sí |
| Order | 1385 | 2273 | sí |
| OrderItem | 1254 | 1940 | sí |
| OrderReturn | vacía | 149 | sí |
| OrderReturnItem | vacía | 115 | sí |
| PaymentMethod | 18439 | 27565 | sí |
| Permission | 7073 | 7561 | sí |
| PickingItem | 457 | 835 | sí |
| PickingItemContribution | 260 | 552 | sí |
| PickingOrderItemDetail | 926 | 1528 | sí |
| PickingResponsibilityRequest | vacía | 146 | sí |
| PickingSession | 465 | 860 | sí |
| PickingSharedResponsibility | vacía | 168 | sí |
| PickingUnpickRequest | vacía | 48 | sí |
| Product | 370 | 1227 | sí |
| ProductImage | 40 | 94 | sí |
| ProductVariant | 376 | 1220 | sí |
| Reservation | 969 | 1579 | sí |
| Role | 6 | 70 | sí |
| RolePermission | 78 | 8736 | sí |
| Size | 4 | 22 | sí |
| StockTransfer | vacía | 167 | sí |
| StockTransferItem | vacía | 99 | sí |
| Store | 107 | 394 | sí |
| SystemSetting | 40952 | 60725 | sí |
| User | 355 | 361 | sí |
| UserActivityLog | 537 | 611 | sí |
