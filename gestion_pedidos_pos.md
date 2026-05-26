# 🟦 Documentación Backend — Gestión de Pedidos y POS

## 🎯 Objetivo

Documentar la implementación backend para la gestión de pedidos y el punto de venta (POS), incluyendo la creación de pedidos, control de stock, estados, reservaciones multitienda, picking y transferencia interna.

---

## 📁 Archivos clave

- `backend/src/presentation/order/controller.ts`
- `backend/src/presentation/order/router.ts`
- `backend/src/presentation/services/order.service.ts`
- `backend/src/domain/dtos/create-order.dto.ts`
- `backend/src/domain/dtos/list-order.dto.ts`
- `backend/src/domain/dtos/update-order-status.dto.ts`
- `backend/src/domain/dtos/assign-order-responsible.dto.ts`
- `backend/src/domain/dtos/update-order-picking.dto.ts`
- `backend/prisma/schema.prisma`

---

## 🔌 Rutas y Endpoints

Todas las rutas de pedido se exponen en `/api/orders` y están protegidas con JWT según `backend/src/presentation/routes.ts`.

### Endpoints principales

- `POST /api/orders`
  - Crear pedido desde POS o ecommerce.
- `GET /api/orders`
  - Listar pedidos con filtros de estado, tienda, responsable y rango de fechas.
- `GET /api/orders/:id`
  - Obtener pedido por ID con items, tiendas y responsables.
- `PATCH /api/orders/:id/status`
  - Actualizar estado del pedido.
- `PATCH /api/orders/:id/assign`
  - Asignar vendedor, picker o despachador.
- `GET /api/orders/remote-stock/:variantId?excludeStoreId=`
  - Consultar stock en otras tiendas.
- `POST /api/orders/:id/reserve-remote`
  - Reservar stock desde una tienda remota.

---

## 🧾 DTOs y validaciones

### `CreateOrderDto`

- `sourceStoreId` obligatorio.
- `items` obligatorio, al menos un item.
- `variantId`, `quantity` y `unitPrice` deben ser válidos.
- Valida email de cliente si se proporciona.

### `ListOrderDto`

- Permite filtrar por `status`, `storeId`, `responsibleUserId`, `startDate`, `endDate`, `page`, `limit`.

### `UpdateOrderStatusDto`

- Valida que el estado sea uno de los valores permitidos.
- Usa transiciones de estado válidas en el servicio de pedidos.

### `AssignOrderResponsibleDto`

- Valida rol entre `seller`, `picker`, `dispenser`.
- Valida existencia de usuario.

---

## 🧠 Lógica principal del servicio de pedidos

### `createOrder()`

- Valida existencia de tienda origen.
- Valida tienda de fulfillment si se indica.
- Valida existencia del vendedor si se indica.
- Valida existencia de variantes y stock disponible.
- Crea el pedido en estado `PENDING`.
- Genera código único (`ORD-YYYYMMDD-XXXXXX`).
- Calcula `subtotal`, `tax` e `total`.
- Crea `OrderItem` para cada item.
- Crea reservas automáticas (`Reservation`) y actualiza `reservedStock`.

### `getOrderById()`

- Devuelve pedido con relaciones: items, tiendas, usuarios responsables, picking, transferencias y reservas.
- Lanza error 404 si el pedido no existe.

### `listOrders()`

- Construye un `where` dinámico según filtros.
- Soporta búsqueda por tienda origen o fulfillment.
- Soporta filtro por responsable en seller/picker/dispenser.
- Devuelve paginación con total, página y totalPages.

### `updateOrderStatus()`

- Valida transición de estados con un mapa de estados válidos.
- Si el pedido se cancela, libera reservas y decrementa `reservedStock`.
- Si el pedido se entrega, descuenta stock físico (`stock`) y libera `reservedStock`.

### `assignResponsible()`

- Asigna `sellerUserId`, `pickerUserId` o `dispenserUserId` según el rol.
- Devuelve el pedido con los usuarios actualizados.

---

## 📦 Multitienda y stock remoto

### `getRemoteStock()`

- Consulta inventarios de la variante en otras tiendas activas.
- Excluye la tienda actual con `excludeStoreId`.
- Devuelve stock disponible real: `stock - reservedStock`.
- Ordena por cantidad disponible.

### `reserveRemoteStock()`

- Valida inventario remoto y cantidad disponible.
- Actualiza `fulfillmentStoreId` del pedido.
- Incrementa `reservedStock` en la tienda remota.
- Crea una reserva activa ligada al pedido.

---

## 🚚 Picking y transferencias

### Picking

- El sistema permite registrar el avance de picking con `PickingSession` y `PickingItem`.
- Los pedidos solo pueden entrar a picking si están en `CONFIRMED`.
- Al completar picking, el pedido puede avanzar a `READY`.

### Transferencias internas

- La reserva remota genera una relación entre pedido y transferencia interna.
- Los estados de transferencia permiten seguir `PENDING`, `PICKING`, `IN_TRANSIT`, `RECEIVED`, `CANCELLED`.
- El pedido mantiene trazabilidad de su origen y fulfillment.

---

## ✅ Estados de pedido soportados

- `PENDING`
- `CONFIRMED`
- `WAITING_TRANSFER`
- `PREPARING`
- `READY`
- `DELIVERED`
- `CANCELLED`
- `WAITING_STOCK`

---

## 🧪 Ejemplos de requests

### Crear pedido

```http
POST /api/orders
Content-Type: application/json
Authorization: Bearer <token>

{
  "sourceStoreId": 1,
  "fulfillmentStoreId": 1,
  "sellerUserId": 5,
  "clientName": "Juan García",
  "clientEmail": "juan@example.com",
  "clientPhone": "+34 600123456",
  "items": [
    {
      "variantId": 42,
      "quantity": 2,
      "unitPrice": 29.99
    }
  ],
  "note": "Entrega por la tarde"
}
```

### Cambiar estado

```http
PATCH /api/orders/123/status
Content-Type: application/json
Authorization: Bearer <token>

{
  "status": "CONFIRMED",
  "note": "Pedido validado por stock"
}
```

### Reservar stock remoto

```http
POST /api/orders/123/reserve-remote
Content-Type: application/json
Authorization: Bearer <token>

{
  "sourceStoreId": 2,
  "variantId": 42,
  "quantity": 1
}
```

---

## ▶️ Cómo ejecutar local

```bash
cd backend
npm install
npx prisma migrate dev
npx prisma generate
npm run dev
```

---

## 📝 Notas importantes

- El backend asume que los inventarios remotos y locales se modelan en `Inventory`.
- Las reservas se marcan como `ACTIVE`, `RELEASED` o `COMPLETED`.
- La lógica de stock se basa en `availableStock = stock - reservedStock`.
- Las rutas de pedido están protegidas por JWT.

## ⚠️ Brechas actuales

- No hay endpoints de picking implementados en `backend/src/presentation/order/controller.ts`.
- No existe un controlador de pedido para registrar avance de `PickingSession` / `PickingItem`.
- No hay endpoint específico para entregar un pedido aparte de cambio de estado genérico.
- El backend está importando `UpdateOrderPickingDto` sin usarlo, lo que confirma que el flujo de picking está incompleto.
- Falta un endpoint de detalle de pedido enriquecido para reservas, transferencias y movimientos asociados.
