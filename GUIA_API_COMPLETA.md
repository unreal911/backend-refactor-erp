# GUIA API COMPLETA (BACKEND-REFACTORIZADO)

Esta guia describe toda la API disponible en el backend:

1. Endpoints
2. Metodo HTTP
3. Autenticacion requerida
4. Permisos requeridos
5. Campos obligatorios y opcionales
6. Ejemplos de request
7. Ejemplos de response

## 1. Convenciones generales

Base URL local:

```txt
http://localhost:3000
```

Tipos de token:

1. `Backoffice JWT`: se obtiene en `POST /api/auth/login`.
2. `Marketplace customer JWT`: se obtiene en `POST /api/public/auth/login` o `POST /api/public/auth/register`.

Header para rutas protegidas:

```http
Authorization: Bearer <TOKEN>
```

Nota importante sobre respuestas de error:

1. Algunos endpoints responden errores como `{ "message": "..." }`.
2. Otros responden errores como `{ "error": "..." }`.

## 2. Autenticacion y permisos

### 2.1 Login backoffice

### `POST /api/auth/login`

Auth: publica.

Ejemplo request (body):

```json
{
    "email":  "string, obligatorio",
    "password":  "string, obligatorio"
}
````r`n`r`nEjemplo request:

```json
{
  "email": "admin@tu-dominio.com",
  "password": "tu_password"
}
```

Ejemplo response `200`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "firstName": "Admin",
    "lastName": "Principal",
    "email": "admin@tu-dominio.com",
    "role": "ADMIN",
    "permissions": ["*"]
  }
}
```

### `GET /api/auth/me`

Auth: `Backoffice JWT`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "user": {
    "id": 1,
    "firstName": "Admin",
    "lastName": "Principal",
    "email": "admin@tu-dominio.com",
    "role": "ADMIN",
    "permissions": ["*"]
  }
}
```

### `POST /api/auth/logout`

Auth: publica.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "message": "Sesion cerrada exitosamente"
}
```

### 2.2 Catalogo global de permisos

### `GET /api/permissions`

Auth: `Backoffice JWT`.
Permiso: `roles.permissions`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
[
  {
    "code": "users.view",
    "name": "Ver usuarios",
    "module": "users",
    "description": "Permite listar usuarios",
    "isActive": true
  }
]
```

## 3. Modulo usuarios (`/api/users`)

Todas estas rutas requieren `Backoffice JWT`.

### `POST /api/users`

Permiso: `users.create`.

Ejemplo request (body):

```json
{
    "firstName":  "string, obligatorio",
    "lastName":  "string, obligatorio",
    "email":  "string, obligatorio",
    "password":  "string, obligatorio",
    "roleId":  "number, obligatorio",
    "isActive":  "boolean, opcional, default `true`"
}
````r`n`r`nEjemplo response `201`: objeto usuario (sin password).

### `GET /api/users`

Permiso: `users.view`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: arreglo de usuarios (sin password).

### `GET /api/users/:id`

Permiso: `users.view`.

Ejemplo request (path params):

```json
{
    "id":  "number, obligatorio"
}
````r`n`r`nEjemplo response `200`: usuario (sin password).

### `PUT /api/users/:id`

Permiso: `users.update`.

Ejemplo request (body, todo opcional):

```json
{
    "firstName":  "string",
    "lastName":  "string",
    "email":  "string",
    "roleId":  "number",
    "isActive":  "boolean"
}
````r`n`r`nEjemplo response `200`: usuario actualizado.

### `DELETE /api/users/:id`

Permiso: `users.disable`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "message": "Usuario eliminado exitosamente"
}
```

### `POST /api/users/:id/change-password`

Permiso: `users.change_password`.

Ejemplo request (body):

```json
{
    "newPassword":  "string, obligatorio"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "message": "Contrasena actualizada exitosamente"
}
```

## 4. Modulo roles (`/api/roles`)

Todas estas rutas requieren `Backoffice JWT`.

### `GET /api/roles/permissions`

Permiso: `roles.permissions`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: catalogo de permisos.

### `POST /api/roles`

Permiso: `roles.create`.

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "description":  "string, opcional",
    "isActive":  "boolean, opcional, default `true`"
}
````r`n`r`nEjemplo response `201`: rol creado.

### `GET /api/roles`

Permiso: `roles.view`.

Ejemplo request (query opcionales):

```json
{
    "search":  "string",
    "isActive":  "`true`/`false`"
}
````r`n`r`nEjemplo response `200`: arreglo de roles.

### `GET /api/roles/:id`

Permiso: `roles.view`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: rol con usuarios asociados.

### `PUT /api/roles/:id`

Permiso: `roles.update`.

Ejemplo request (body opcional):

```json
{
    "name":  "string",
    "description":  "string",
    "isActive":  "boolean"
}
````r`n`r`nEjemplo response `200`: rol actualizado.

### `PATCH /api/roles/:id`

Permiso: `roles.update`.

Ejemplo request (body opcional):

```json
{
    "name":  "string",
    "description":  "string",
    "isActive":  "boolean"
}
````r`n`r`nEjemplo response `200`: rol actualizado.

### `PATCH /api/roles/:id/status`

Permiso: `roles.update`.

Ejemplo request (body):

```json
{
    "isActive":  "boolean, obligatorio"
}
````r`n`r`nEjemplo response `200`: rol actualizado.

### `DELETE /api/roles/:id`

Permiso: `roles.update`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "message": "Rol desactivado exitosamente"
}
```

### `GET /api/roles/:id/permissions`

Permiso: `roles.permissions`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "roleId": 2,
  "permissions": ["orders.view", "orders.detail.view"]
}
```

### `PUT /api/roles/:id/permissions`

Permiso: `roles.permissions`.

Ejemplo request (body):

```json
{
    "permissions":  "array de string, obligatorio"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "roleId": 2,
  "permissions": ["orders.view", "orders.detail.view"]
}
```

## 5. Seed endpoint (`/api/seed`)

Esta ruta solo existe si `SEED_ENDPOINT_ENABLED=true`.

### `POST /api/seed`

Auth: `Backoffice JWT`.
Rol requerido: `ADMIN`.

Ejemplo request (body opcional):

```json
{
    "key":  "(string): obligatorio solo si `SEED_TRIGGER_KEY` esta configurado.",
    "includeDemoUsers":  "(boolean): override del comportamiento default.",
    "ensureAdminFromEnv":  "(boolean): fuerza bootstrap de admin desde env."
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "message": "Seed ejecutado correctamente",
  "data": {
    "roles": ["ADMIN", "MANAGER", "SELLER", "WAREHOUSE", "PICKER", "USER"],
    "usersCreated": ["admin@tu-dominio.com"],
    "usersUpdated": [],
    "warnings": [],
    "includeDemoUsers": false,
    "ensureAdminFromEnv": true
  }
}
```

## 6. Catalogos basicos

Nota: categorias usa prefijo `/api/categorie` (asi esta implementado actualmente).

### 6.1 Categorias (`/api/categorie`)

Auth: `Backoffice JWT`.

### `POST /api/categorie`

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "isActive":  "boolean, opcional, default `true`"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/categorie`

Ejemplo request (query):

```json
{
    "skip":  "number, opcional, default `1`",
    "take":  "number, opcional, default `10`",
    "isActive":  "boolean string, opcional"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 10
}
```

### `GET /api/categorie/search`

Ejemplo request (query):

```json
{
    "name":  "string, obligatorio",
    "isActive":  "boolean string, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PUT /api/categorie/:id`

Ejemplo request (body):

```json
{
    "name":  "string, opcional",
    "isActive":  "boolean, opcional"
}
````r`n`r`nDebe enviar al menos uno.

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### 6.2 Colores (`/api/color`)

Auth: `Backoffice JWT`.

### `POST /api/color`

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "hex":  "string, opcional",
    "isActive":  "boolean, opcional, default `true`"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/color`

Ejemplo request (query opcional):

```json
{
    "skip":  "number",
    "take":  "number",
    "isActive":  "`true`/`false`"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/color/search`

Ejemplo request (query):

```json
{
    "name":  "string, obligatorio",
    "isActive":  "boolean string, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PUT /api/color/:id`

Ejemplo request (body opcional):

```json
{
    "name":  "string",
    "hex":  "string",
    "isActive":  "boolean"
}
````r`n`r`nDebe enviar al menos uno.

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### 6.3 Tallas (`/api/size`)

Auth: `Backoffice JWT`.

### `POST /api/size`

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "isActive":  "boolean, opcional, default `true`"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/size`

Ejemplo request (query opcional):

```json
{
    "skip":  "number",
    "take":  "number",
    "isActive":  "`true`/`false`"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/size/search`

Ejemplo request (query):

```json
{
    "name":  "string, obligatorio",
    "isActive":  "boolean string, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PUT /api/size/:id`

Ejemplo request (body opcional):

```json
{
    "name":  "string",
    "isActive":  "boolean"
}
````r`n`r`nDebe enviar al menos uno.

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### 6.4 Tiendas (`/api/stores`)

Auth: `Backoffice JWT`.

### `POST /api/stores`

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "code":  "string, obligatorio",
    "type":  "`STORE` o `WAREHOUSE`, obligatorio",
    "address":  "string, opcional",
    "isActive":  "boolean, opcional"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/stores`

Ejemplo request (query opcional):

```json
{
    "skip":  "number, default `1`",
    "take":  "number, default `100`",
    "search":  "string",
    "type":  "`STORE` o `WAREHOUSE`",
    "includeInactive":  "`true`/`false`, default `false`"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PUT /api/stores/:id`

Ejemplo request (body opcional):

```json
{
    "name":  "string",
    "code":  "string",
    "type":  "`STORE` o `WAREHOUSE`",
    "address":  "string",
    "isActive":  "boolean"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/stores/:id/deactivate`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: tienda con `isActive=false`.

## 7. Productos (`/api/products`)

Auth: `Backoffice JWT`.

### `POST /api/products`

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "categoryId":  "number, obligatorio",
    "description":  "string, opcional",
    "variantMode":  "`MATRIX` | `SIMPLE` | `SIZE_ONLY`, opcional, default `MATRIX`",
    "colorIds":  "number[], obligatorio segun modo",
    "sizeIds":  "number[], obligatorio segun modo",
    "imageUrls":  "string[], opcional",
    "imageFiles":  "array `{ filename, data(base64) }`, opcional",
    "variants":  "array, obligatorio"
}
````r`n`r`nReglas clave:

1. `MATRIX`: requiere colorIds y sizeIds.
2. `SIZE_ONLY`: requiere sizeIds.
3. `SIMPLE`: requiere exactamente 1 variante.

Ejemplo response `201`:

```json
{
  "product": {
    "id": 1,
    "name": "Producto demo",
    "variantCount": 2,
    "imageCount": 1,
    "variantMode": "MATRIX"
  },
  "variants": [],
  "images": [],
  "message": "Producto \"Producto demo\" creado exitosamente con 2 variantes"
}
```

### `POST /api/products/generate-variants`

Ejemplo request (body):

```json
{
    "colorIds":  "number[], obligatorio",
    "sizeIds":  "number[], obligatorio"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "variants": [
    { "colorId": 1, "sizeId": 1 }
  ],
  "count": 1,
  "message": "Se generaron 1 combinaciones de variantes"
}
```

### `DELETE /api/products/image/:publicId`

Elimina imagen en cloudinary por `publicId`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/products`

Ejemplo request (query):

```json
{
    "skip":  "number, default `1`",
    "take":  "number, default `10`",
    "search":  "string, opcional",
    "isActive":  "`true`/`false`, default `true`"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 10,
  "hasMore": false
}
```

### `GET /api/products/:id`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: detalle completo de producto, variantes e imagenes.

### `PATCH /api/products/:id`

Ejemplo request (body opcional):

```json
{
    "name":  "string, opcional",
    "description":  "string, opcional",
    "categoryId":  "number, opcional",
    "isActive":  "boolean, opcional",
    "variantMode":  "`MATRIX|SIMPLE|SIZE_ONLY`, opcional",
    "colorIds":  "number[], opcional",
    "sizeIds":  "number[], opcional",
    "imageUrls":  "string[], opcional",
    "imageFiles":  "array `{ filename, data(base64) }`, opcional",
    "variants":  "array, opcional"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "message": "Producto actualizado exitosamente",
  "product": {}
}
```

### `DELETE /api/products/:id`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "message": "Producto eliminado exitosamente"
}
```

## 8. Inventario (`/api/inventory`)

Auth: `Backoffice JWT`.

### `GET /api/inventory`

Ejemplo request (query opcional):

```json
{
    "skip":  "number, opcional",
    "take":  "number, opcional",
    "storeId":  "number, opcional",
    "variantId":  "number, opcional",
    "search":  "string, opcional",
    "includeZero":  "`true`/`false`"
}
````r`n`r`nEjemplo response `200`: arreglo de inventarios con `availableStock`.

### `GET /api/inventory/movements`

Ejemplo request (query opcional):

```json
{
    "inventoryId":  "number, opcional",
    "transferId":  "number, opcional",
    "reservationId":  "number, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/inventory/transfers`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: transferencias con tiendas, items y usuarios.

### `GET /api/inventory/reservations`

Ejemplo request (query opcional):

```json
{
    "inventoryId":  "number, opcional",
    "storeId":  "number, opcional",
    "variantId":  "number, opcional",
    "orderId":  "number, opcional",
    "status":  "csv, ejemplo `ACTIVE,COMPLETED`"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `POST /api/inventory/movements`

Ejemplo request (body):

```json
{
    "storeId":  "number, obligatorio",
    "variantId":  "number, obligatorio",
    "type":  "(obligatorio): `IN | OUT | ADJUSTMENT | TRANSFER_OUT | TRANSFER_IN | RESERVED | UNRESERVED`",
    "quantity":  "number, obligatorio, no cero",
    "note":  "string, opcional",
    "transferId":  "number, opcional",
    "reservationId":  "number, opcional"
}
````r`n`r`nEjemplo response `201`:

```json
{
  "inventory": {
    "id": 10,
    "stock": 20,
    "reservedStock": 2,
    "availableStock": 18
  },
  "movement": {
    "id": 99,
    "type": "IN",
    "quantity": 5
  }
}
```

### `POST /api/inventory/transfers`

Ejemplo request (body):

```json
{
    "fromStoreId":  "number, obligatorio",
    "toStoreId":  "number, obligatorio, distinto de fromStoreId",
    "items":  "(obligatorio): array de `{ variantId:number, quantity:number\u003e0 }`",
    "note":  "string, opcional"
}
````r`n`r`nEjemplo response `201`: transferencia creada.

### `PATCH /api/inventory/transfers/:id/receive`

Marca transferencia como recibida y actualiza inventarios destino.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "transfer": {},
  "inventories": []
}
```

### `POST /api/inventory/reservations`

Ejemplo request (body):

```json
{
    "inventoryId":  "number, obligatorio",
    "quantity":  "number, obligatorio \u003e 0",
    "orderId":  "number, opcional"
}
````r`n`r`nEjemplo response `201`:

```json
{
  "reservation": {},
  "inventory": {}
}
```

### `POST /api/inventory/reconcile-reserved`

Ejemplo request (body opcional):

```json
{
    "inventoryIds":  "number[]"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "adjustedCount": 1,
  "unchangedCount": 4,
  "items": [],
  "requestedInventoryCount": 5,
  "processedInventoryCount": 5
}
```

## 9. Pedidos privados (`/api/orders`)

Auth: `Backoffice JWT`.

### 9.1 Crear y consultar pedidos

### `POST /api/orders`

Ejemplo request (body):

```json
{
    "sourceStoreId":  "number, obligatorio",
    "fulfillmentStoreId":  "number, opcional",
    "sellerUserId":  "number, opcional",
    "applyIgv":  "boolean, opcional",
    "clientName":  "string, opcional",
    "clientEmail":  "string, opcional, formato email",
    "clientPhone":  "string, opcional",
    "items":  "(obligatorio, minimo 1): `{ variantId:number, quantity:number\u003e0, unitPrice:number\u003e=0 }`",
    "note":  "string, opcional"
}
````r`n`r`nEjemplo response `201`:

```json
{
  "success": true,
  "data": {},
  "message": "Pedido creado exitosamente"
}
```

### `GET /api/orders`

Ejemplo request (query opcional):

```json
{
    "page":  "number, default 1",
    "limit":  "number 1..100, default 10",
    "status":  "`PENDING|CONFIRMED|WAITING_TRANSFER|PREPARING|READY|DELIVERED|RETURN_PENDING|CANCELLED|WAITING_STOCK`",
    "storeId":  "number",
    "responsibleUserId":  "number",
    "startDate":  "fecha",
    "endDate":  "fecha",
    "search":  "string",
    "channel":  "`POS|ECOMMERCE|INTERNAL`"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 0,
    "totalPages": 0
  }
}
```

### `GET /api/orders/:id`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
```

### `PATCH /api/orders/:id/status`

Ejemplo request (body):

```json
{
    "status":  "obligatorio, enum de estados",
    "note":  "string, opcional"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": {},
  "message": "Estado del pedido actualizado exitosamente"
}
```

### `PATCH /api/orders/:id/assign`

Ejemplo request (body):

```json
{
    "roleType":  "(obligatorio): `seller | picker | dispenser`",
    "userId":  "number, obligatorio"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### 9.2 Stock y reservas

### `GET /api/orders/variant-stock`

Ejemplo request (query):

```json
{
    "storeId":  "number, obligatorio",
    "variantIds":  "string csv obligatorio, ejemplo `10,11,12`"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/orders/remote-stock/:variantId`

Ejemplo request (query):

```json
{
    "excludeStoreId":  "number, obligatorio"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": [
    {
      "storeId": 2,
      "storeName": "Sucursal 2",
      "storeType": "STORE",
      "availableStock": 8,
      "reservedStock": 1
    }
  ]
}
```

### `GET /api/orders/:id/reservations`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: reservas de la orden.

### `POST /api/orders/:id/reserve-remote`

Ejemplo request (body):

```json
{
    "sourceStoreId":  "number, obligatorio",
    "variantId":  "number, obligatorio",
    "quantity":  "number, obligatorio"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Stock remoto reservado exitosamente"
  }
}
```

### 9.3 Devoluciones

### `PATCH /api/orders/:id/return-responsibility/delegate`

Ejemplo request (body):

```json
{
    "userId":  "number, obligatorio",
    "note":  "string, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/orders/:id/return-responsibility/accept`

Sin body obligatorio.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### 9.4 Picking

### `GET /api/orders/:id/picking`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {
    "orderId": 1,
    "orderCode": "ORD-...",
    "orderStatus": "PREPARING",
    "pickingSession": {},
    "summary": {
      "totalRequested": 5,
      "totalPicked": 2,
      "progress": 40,
      "completed": false
    },
    "items": []
  }
}
```

### `POST /api/orders/:id/picking/start`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {},
  "message": "Picking iniciado exitosamente"
}
```

### `PATCH /api/orders/:id/picking/complete`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {},
  "message": "Picking finalizado exitosamente"
}
```

### `PATCH /api/orders/:id/picking`

Ejemplo request (body):

```json
{
    "items":  "(obligatorio, minimo 1): `{ variantId:number, pickedQuantity:number\u003e=0 }`"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/orders/picking/items/:itemId`

Ejemplo request (body):

```json
{
    "pickedQuantity":  "number entero \u003e= 0, obligatorio"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/orders/:id/picking/order-items/:orderItemId`

Ejemplo request (body):

```json
{
    "pickedQuantity":  "number entero \u003e= 0, obligatorio"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `POST /api/orders/:id/picking/responsibility/request`

Ejemplo request (body opcional):

```json
{
    "mode":  "`SHARED` o `TRANSFER`, default `SHARED`",
    "note":  "string"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/orders/:id/picking/responsibility/delegate`

Ejemplo request (body):

```json
{
    "userId":  "number, obligatorio",
    "mode":  "`SHARED` o `TRANSFER`, obligatorio en practica; default `TRANSFER`",
    "note":  "string, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/orders/:id/picking/responsibility/requests/:requestId`

Ejemplo request (body):

```json
{
    "action":  "`APPROVE` o `REJECT`, obligatorio",
    "note":  "string, opcional"
}
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `POST /api/orders/:id/picking/items/:itemId/unpick-request`

Ejemplo request (body):

```json
{
    "quantity":  "number entero \u003e 0, obligatorio",
    "note":  "string, opcional"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/orders/:id/picking/unpick-requests/:requestId`

Ejemplo request (body):

```json
{
    "action":  "`APPROVE` o `REJECT`, obligatorio",
    "note":  "string, opcional"
}
````r`n`r`n## 10. Metodos de pago (`/api/payment-methods`)

Auth: `Backoffice JWT`.

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/payment-methods/active`

Sin permiso especial adicional.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "data": [
    {
      "id": 1,
      "name": "Efectivo",
      "code": "EFECTIVO",
      "displayOrder": 10,
      "isActive": true
    }
  ]
}
```

### `GET /api/payment-methods`

Permiso: `payment_methods.manage`.

Ejemplo request (query opcional):

```json
{
    "skip":  "number, default 1",
    "take":  "number 1..200, default 50",
    "isActive":  "`true`/`false`",
    "search":  "string"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 50
}
```

### `POST /api/payment-methods`

Permiso: `payment_methods.manage`.

Ejemplo request (body):

```json
{
    "name":  "string, obligatorio",
    "code":  "string, opcional",
    "isActive":  "boolean, opcional, default `true`"
}
```

Ejemplo response `201`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PUT /api/payment-methods/:id`
Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `PATCH /api/payment-methods/:id`

Permiso: `payment_methods.manage`.

Ejemplo request (body):

```json
{
    "name":  "string, opcional",
    "isActive":  "boolean, opcional"
}
````r`n`r`nDebe enviar al menos uno.

## 11. Configuracion de sistema (`/api/system-config`)

Auth: `Backoffice JWT`.

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/system-config/order-workflow`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "data": {
    "returnResponsibilityManagementEnabled": true,
    "pickingResponsibilityFlowEnabled": false,
    "marketplacePaymentMethodsEnabled": false,
    "marketplacePaymentMethodIds": [1, 2],
    "marketplaceIncludeIgv": true,
    "marketplaceAutoReserveStock": false
  }
}
```

### `PATCH /api/system-config/order-workflow`

Permiso: `settings.manage`.

Ejemplo request (body opcional, al menos uno):

```json
{
    "returnResponsibilityManagementEnabled":  "boolean",
    "pickingResponsibilityFlowEnabled":  "boolean",
    "marketplacePaymentMethodsEnabled":  "boolean",
    "marketplacePaymentMethodIds":  "number[]",
    "marketplaceIncludeIgv":  "boolean",
    "marketplaceAutoReserveStock":  "boolean"
}
````r`n`r`n## 12. Trazabilidad y auditoria

## 12.1 Audit logs (`/api/audit-logs`)

Auth: `Backoffice JWT`.
Permiso: `settings.manage`.

Ejemplo response `200`:

```json
{
  "success": true,
  "data": {}
}
````r`n`r`n### `GET /api/audit-logs`

Ejemplo request (query opcional):

```json
{
    "page":  "1..n",
    "limit":  "1..100",
    "search":  "string",
    "method":  "`GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD`",
    "statusCode":  "100..599",
    "actorUserId":  "number",
    "path":  "string",
    "startDate":  "fecha ISO opcional (`YYYY-MM-DD` o datetime ISO)",
    "endDate":  "fecha ISO opcional (`YYYY-MM-DD` o datetime ISO)"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

## 12.2 User activity logs (`/api/user-activities`)

Auth: `Backoffice JWT`.
Permiso: `settings.manage`.

### `GET /api/user-activities`

Ejemplo request (query opcional):

```json
{
    "page":  "1..n",
    "limit":  "1..100",
    "search":  "string",
    "userId":  "number",
    "module":  "string",
    "actionType":  "string",
    "entityType":  "string",
    "startDate":  "fecha ISO opcional (`YYYY-MM-DD` o datetime ISO)",
    "endDate":  "fecha ISO opcional (`YYYY-MM-DD` o datetime ISO)"
}
````r`n`r`nEjemplo response `200`: mismo formato paginado con `success`, `data`, `pagination`.

## 13. API publica marketplace (`/api/public`)

Estas rutas no usan JWT de backoffice.

### 13.1 Auth cliente marketplace

### `POST /api/public/auth/register`

Ejemplo request (body):

```json
{
    "firstName":  "string, obligatorio",
    "lastName":  "string, obligatorio",
    "email":  "string, obligatorio",
    "phone":  "string, obligatorio",
    "address":  "string, opcional",
    "password":  "string, obligatorio, min 6"
}
````r`n`r`nEjemplo response `201`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "firstName": "Juan",
    "lastName": "Perez",
    "email": "juan@mail.com",
    "phone": "999999999",
    "address": null
  }
}
```

### `POST /api/public/auth/login`

Ejemplo request (body):

```json
{
    "email":  "string, obligatorio",
    "password":  "string, obligatorio"
}
````r`n`r`nEjemplo response `200`: `{ token, user }`.

### `GET /api/public/auth/me`

Auth: `Marketplace customer JWT`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "user": {
    "id": 1,
    "firstName": "Juan",
    "lastName": "Perez",
    "email": "juan@mail.com",
    "phone": "999999999",
    "address": null
  }
}
```

### `PATCH /api/public/auth/profile`

Auth: `Marketplace customer JWT`.

Ejemplo request (body, al menos uno):

```json
{
    "firstName":  "string",
    "lastName":  "string",
    "phone":  "string",
    "address":  "string o `null`"
}
````r`n`r`nEjemplo response `200`: `{ user: ... }`.

### 13.2 Catalogo publico y checkout

### `GET /api/public/products`

Ejemplo request (query opcional):

```json
{
    "skip":  "number, default 1",
    "take":  "number, 1..200, default 24",
    "search":  "string",
    "categoryId":  "number",
    "colorId":  "number",
    "sizeId":  "number",
    "inStock":  "`true`/`false`",
    "allowBackorder":  "`true`/`false`"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 24,
  "hasMore": false
}
```

### `GET /api/public/products/:id`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: detalle de producto publico con variantes, stock agregado y precios min/max.

### `GET /api/public/stores`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "data": []
}
```

### `GET /api/public/checkout-payment-methods`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "data": {
    "enabled": true,
    "includeIgv": true,
    "igvRate": 0.18,
    "methods": [
      { "id": 1, "name": "Efectivo", "code": "EFECTIVO" }
    ]
  }
}
```

### 13.3 Pedidos marketplace

### `POST /api/public/orders`

Ejemplo request (body):

```json
{
    "sourceStoreId":  "number, obligatorio",
    "deliveryType":  "`PICKUP` | `DELIVERY`, opcional, default `PICKUP`",
    "clientName":  "string, obligatorio",
    "clientPhone":  "string, obligatorio",
    "clientEmail":  "string, opcional",
    "companyName":  "string, opcional",
    "ruc":  "string, opcional",
    "pickupStoreId":  "number, opcional",
    "deliveryAddress":  "string, obligatorio si `deliveryType=DELIVERY`",
    "deliveryReference":  "string, opcional",
    "paymentMethodId":  "number, opcional",
    "note":  "string, opcional",
    "items":  "(obligatorio, minimo 1): `{ variantId:number, quantity:number, unitPrice?:number, colorName?:string, sizeName?:string, displayVariantId?:number }`"
}
````r`n`r`nEjemplo response `201`:

```json
{
  "success": true,
  "data": {},
  "message": "Pedido registrado. Nuestro equipo confirmara disponibilidad."
}
```

### `GET /api/public/orders/track`

Ejemplo request (query):

```json
{
    "code":  "string, obligatorio",
    "phone":  "string, obligatorio"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": {
    "code": "MK-...",
    "status": "PENDING",
    "publicStatus": "Pedido recibido",
    "items": [],
    "hasPending": true
  }
}
```

### `GET /api/public/orders/:code`

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`: detalle resumido publico del pedido.

### `GET /api/public/orders/my`

Ejemplo request (query):

```json
{
    "phone":  "string, obligatorio",
    "email":  "string, opcional",
    "take":  "number, opcional, 1..50, default 20"
}
````r`n`r`nEjemplo response `200`:

```json
{
  "success": true,
  "data": []
}
```

### `GET /api/public/orders/my-auth`

Auth: `Marketplace customer JWT`.

Ejemplo request:

```txt
Sin body (solo headers/auth si aplica).
```

Ejemplo response `200`:

```json
{
  "success": true,
  "data": []
}
```

## 14. Errores frecuentes

Ejemplos comunes:

1. `400`: validacion de payload, query o params.
2. `401`: token ausente/invalido o credenciales invalidas.
3. `403`: token valido pero sin permiso.
4. `404`: recurso no encontrado.
5. `500`: error interno.

Ejemplos de payload de error:

```json
{ "message": "Token invalido" }
```

```json
{ "error": "ID invalido" }
```

## 15. Resumen rapido de endpoints

Total de grupos:

1. Auth backoffice
2. Usuarios
3. Roles y permisos
4. Seed
5. Catalogos (categoria, color, size, stores)
6. Productos
7. Inventario
8. Pedidos internos
9. Metodos de pago
10. Configuracion del sistema
11. Audit logs
12. User activity logs
13. Marketplace publico (auth, catalogo, pedidos)

Si quieres una version OpenAPI/Swagger (`openapi.json`) tambien te la puedo generar en el siguiente paso.`r`n`r`n
