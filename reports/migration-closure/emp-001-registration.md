# EMP-001 — Registro del propietario con correo verificado

Fecha de aceptación: 2026-08-01 (`America/Lima`)

Estado: `ACEPTADA`

## Contrato implementado

- `POST /api/public/signup` crea solo una `OwnerRegistration` global pendiente.
- `POST /api/public/signup/verify` verifica el correo y entrega una credencial
  opaca que `TRI-001` puede consumir una sola vez dentro de una transacción.
- El registro no crea `User`, `Tenant` ni `TenantMembership`.
- La aceptación registra fecha y versión de términos definida por el servidor.
- Las solicitudes repetidas conservan las credenciales y el enlace vigente;
  solo renuevan un enlace ausente o vencido.
- Correos existentes reciben la misma respuesta HTTP genérica y no generan
  una identidad pendiente.

## Seguridad

- Contraseñas de 12 caracteres como mínimo, complejidad obligatoria, límite
  de 72 bytes y bcrypt con factor 12.
- Tokens aleatorios de 256 bits; solo se persiste su HMAC-SHA-256 con una clave
  independiente de al menos 32 caracteres.
- Enlaces y credenciales de aprovisionamiento con vencimiento y consumo único.
- El registro queda apagado por defecto y el arranque falla de forma cerrada
  si faltan SMTP, URL segura, versión de términos o la clave HMAC.
- Un fallo de entrega invalida el token y no registra correo, token ni
  contraseña en el log.

## Resultado local

- PostgreSQL 16 desechable: 35 migraciones aplicadas y 45 tablas de aplicación.
- `npm run migration:verify`: `READY`, sin DDL durante el arranque.
- Pruebas EMP-001: 21 correctas; la carrera de alta simultánea se repitió
  cinco veces (105/105 casos correctos).
- Matriz tenant: 20 correctas, 1 omisión controlada y smoke HTTP `READY`.
- Suite completa: 252 correctas y 58 omisiones previstas.
- `npm run build`: correcto.
- `npm audit --omit=dev`: cero vulnerabilidades.
- Base temporal eliminada al finalizar.

## CI

- PR borrador: [#2](https://github.com/unreal911/backend-refactor-erp/pull/2),
  apilado sobre `agent/tenant-isolation-saas-foundation`.
- Commit funcional validado: `ced4fe49f0d5558933ab721efd37a1833e3811bb`.
- Ejecución: [Tenant isolation #30708133746](https://github.com/unreal911/backend-refactor-erp/actions/runs/30708133746).
- Job `postgres-isolation`: correcto en 1 min 15 s; migraciones, generación
  Prisma, bootstrap, aislamiento tenant, suite completa y build terminaron
  satisfactoriamente sobre PostgreSQL 16 y Node.js 22.

EMP-001 queda `ACEPTADA`. El registro productivo permanece apagado hasta
completar EMP-002, TRI-001 y configurar el proveedor real de correo.
