# Documentación de API - Gestión de Productos

## Endpoints

### 1. Crear Producto
**POST** `/api/products`

**Descripción**: Crea un nuevo producto con variantes e imágenes.

**Body**:
```json
{
  "name": "string (requerido)",
  "categoryId": "number (requerido)",
  "description": "string (opcional)",
  "colorIds": [number] (requerido, mínimo 1),
  "sizeIds": [number] (requerido, mínimo 1),
  "imageUrls": ["string"] (opcional),
  "variants": [
    {
      "colorId": number,
      "sizeId": number,
      "price": number (> 0, requerido),
      "imageUrl": "string (opcional)"
    }
  ] (requerido, mínimo 1)
}
```

**Ejemplo Request**:
```json
{
  "name": "Camiseta Premium",
  "categoryId": 1,
  "description": "Camiseta de algodón 100%",
  "colorIds": [1, 2],
  "sizeIds": [1, 2, 3],
  "imageUrls": ["https://example.com/image1.jpg"],
  "variants": [
    {
      "colorId": 1,
      "sizeId": 1,
      "price": 29.99,
      "imageUrl": "https://example.com/variant1.jpg"
    },
    {
      "colorId": 1,
      "sizeId": 2,
      "price": 29.99
    }
  ]
}
```

**Response** (201 Created):
```json
{
  "product": {
    "id": 1,
    "name": "Camiseta Premium",
    "description": "Camiseta de algodón 100%",
    "categoryId": 1,
    "isActive": true,
    "createdAt": "2026-05-08T10:00:00Z",
    "updatedAt": "2026-05-08T10:00:00Z"
  },
  "variants": [
    {
      "id": 1,
      "sku": "PROD-00001-001-001",
      "price": 29.99,
      "colorId": 1,
      "sizeId": 1,
      "imageUrl": "https://example.com/variant1.jpg",
      "isActive": true
    }
  ],
  "images": ["https://example.com/image1.jpg"],
  "message": "Producto \"Camiseta Premium\" creado exitosamente con 2 variantes"
}
```

---

### 2. Generar Variantes Automáticamente
**POST** `/api/products/generate-variants`

**Descripción**: Genera todas las combinaciones posibles de variantes basadas en colores y tallas seleccionados.

**Body**:
```json
{
  "colorIds": [number] (requerido, mínimo 1),
  "sizeIds": [number] (requerido, mínimo 1)
}
```

**Ejemplo Request**:
```json
{
  "colorIds": [1, 2, 3],
  "sizeIds": [1, 2]
}
```

**Response** (200 OK):
```json
{
  "variants": [
    { "colorId": 1, "sizeId": 1 },
    { "colorId": 1, "sizeId": 2 },
    { "colorId": 2, "sizeId": 1 },
    { "colorId": 2, "sizeId": 2 },
    { "colorId": 3, "sizeId": 1 },
    { "colorId": 3, "sizeId": 2 }
  ],
  "count": 6,
  "message": "Se generaron 6 combinaciones de variantes"
}
```

---

### 3. Listar Productos
**GET** `/api/products`

**Parámetros Query**:
- `skip`: número de página (default: 1)
- `take`: cantidad de productos por página (default: 10)
- `search`: búsqueda parcial por nombre (opcional, case-insensitive)
- `isActive`: filtrar por estado activo/inactivo (default: true)

**Ejemplo Request**:
```
GET /api/products?skip=1&take=10&search=camiseta&isActive=true
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 1,
      "name": "Camiseta Premium",
      "description": "Camiseta de algodón 100%",
      "categoryId": 1,
      "isActive": true,
      "createdAt": "2026-05-08T10:00:00Z",
      "updatedAt": "2026-05-08T10:00:00Z",
      "category": {
        "id": 1,
        "name": "Ropa"
      },
      "variantCount": 6,
      "imageCount": 1,
      "variants": [...],
      "images": [...]
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "hasMore": false
}
```

---

### 4. Obtener Detalles de Producto
**GET** `/api/products/:id`

**Parámetros**:
- `id`: ID del producto (requerido)

**Ejemplo Request**:
```
GET /api/products/1
```

**Response** (200 OK):
```json
{
  "id": 1,
  "name": "Camiseta Premium",
  "description": "Camiseta de algodón 100%",
  "categoryId": 1,
  "isActive": true,
  "category": {
    "id": 1,
    "name": "Ropa"
  },
  "variants": [
    {
      "id": 1,
      "sku": "PROD-00001-001-001",
      "price": "29.99",
      "colorId": 1,
      "sizeId": 1,
      "imageUrl": null,
      "isActive": true,
      "color": {
        "id": 1,
        "name": "Rojo",
        "hex": "#FF0000"
      },
      "size": {
        "id": 1,
        "name": "S"
      }
    }
  ],
  "images": [
    {
      "id": 1,
      "url": "https://example.com/image1.jpg",
      "productId": 1,
      "createdAt": "2026-05-08T10:00:00Z"
    }
  ]
}
```

---

### 5. Actualizar Producto
**PATCH** `/api/products/:id`

**Parámetros**:
- `id`: ID del producto (requerido)

**Body** (todos los campos son opcionales):
```json
{
  "name": "string",
  "description": "string",
  "categoryId": "number",
  "isActive": "boolean"
}
```

**Ejemplo Request**:
```json
{
  "name": "Camiseta Premium Actualizada",
  "isActive": false
}
```

**Response** (200 OK):
```json
{
  "message": "Producto actualizado exitosamente",
  "product": {
    "id": 1,
    "name": "Camiseta Premium Actualizada",
    "description": "Camiseta de algodón 100%",
    "categoryId": 1,
    "isActive": false,
    "createdAt": "2026-05-08T10:00:00Z",
    "updatedAt": "2026-05-08T10:05:00Z"
  }
}
```

---

### 6. Eliminar Producto
**DELETE** `/api/products/:id`

**Parámetros**:
- `id`: ID del producto (requerido)

**Ejemplo Request**:
```
DELETE /api/products/1
```

**Response** (200 OK):
```json
{
  "message": "Producto eliminado exitosamente"
}
```

---

## Códigos de Error

| Código | Descripción |
|--------|-------------|
| 400 | Solicitud inválida (validación fallida) |
| 404 | Recurso no encontrado |
| 500 | Error interno del servidor |

---

## Validaciones de Negocio

### Crear Producto
- ✅ El nombre es obligatorio
- ✅ La categoría es obligatoria y debe existir
- ✅ Debe haber al menos un color seleccionado
- ✅ Debe haber al menos una talla seleccionada
- ✅ Debe haber al menos una variante
- ✅ Cada variante debe tener un precio > 0
- ✅ Los colores y tallas deben estar activos
- ✅ Los SKUs se generan automáticamente (PROD-{PRODUCTID}-{COLORID}-{SIZEID})

### Listar Productos
- ✅ Por defecto solo se muestran productos activos
- ✅ La búsqueda es parcial e insensible a mayúsculas/minúsculas
- ✅ Soporte para paginación
- ✅ Muestra cantidad de variantes e imágenes

---

## Ejemplo de Flujo Completo

### 1. Generar variantes primero (opcional, para ver combinaciones)
```bash
POST /api/products/generate-variants
{
  "colorIds": [1, 2],
  "sizeIds": [1, 2, 3]
}
```

### 2. Crear producto con variantes
```bash
POST /api/products
{
  "name": "Camiseta Premium",
  "categoryId": 1,
  "description": "Camiseta de algodón",
  "colorIds": [1, 2],
  "sizeIds": [1, 2, 3],
  "imageUrls": ["https://example.com/image.jpg"],
  "variants": [
    { "colorId": 1, "sizeId": 1, "price": 29.99 },
    { "colorId": 1, "sizeId": 2, "price": 29.99 },
    { "colorId": 1, "sizeId": 3, "price": 29.99 },
    { "colorId": 2, "sizeId": 1, "price": 29.99 },
    { "colorId": 2, "sizeId": 2, "price": 29.99 },
    { "colorId": 2, "sizeId": 3, "price": 29.99 }
  ]
}
```

### 3. Listar productos
```bash
GET /api/products?search=camiseta&isActive=true
```

### 4. Obtener detalle de producto
```bash
GET /api/products/1
```
