# TRI-001 — Aprovisionamiento atómico de trial

Fecha de aceptación: 2026-08-01 (`America/Lima`)

Estado: `ACEPTADA`

## Contrato implementado

- `POST /api/public/signup/trial` recibe únicamente una credencial de
  aprovisionamiento emitida después de verificar el correo.
- El servidor calcula `trialStartedAt` y `trialEndsAt` con una duración exacta
  de 15 días; fechas o slugs adicionales enviados por el cliente se ignoran.
- Una sola transacción consume la identidad y crea `User`,
  `Tenant(kind=TRIAL, status=TRIAL, databaseMode=SHARED)`,
  `TenantMembership(OWNER, ACTIVE)`, métodos de pago y configuración inicial.
- El nombre comercial y correo verificado alimentan la configuración inicial
  sin duplicar una base, esquema o proyecto Neon.
- El slug se normaliza en servidor y un bloqueo asesor serializa colisiones
  para producir sufijos estables sin carreras.

## Idempotencia y seguridad

- La identidad consumida queda enlazada de forma única al usuario y tenant
  aprovisionados.
- Durante la vigencia de la credencial, un replay devuelve esos mismos IDs con
  `200`; la primera creación devuelve `201`.
- Dos consumos concurrentes producen un único usuario, tenant y membresía.
- Solo se conserva HMAC-SHA-256 de la credencial, nunca el token en claro.
- Un fallo después de reclamar la identidad revierte también usuario, tenant,
  membresía y configuración.
- La ruta se trata como sensible en auditoría y no persiste IP ni user-agent.

## Aislamiento

- `Tenant.kind` distingue `TRIAL`, `CUSTOMER` e `INTERNAL`; los registros
  heredados se reconciliaron y PostgreSQL exige `kind=TRIAL` al crear un tenant
  con estado inicial `TRIAL`.
- Los dos trials creados por la prueba negativa no pueden leer el tenant, la
  membresía ni los métodos de pago del otro bajo el rol runtime con RLS.
- El aprovisionamiento fija siempre `databaseMode=SHARED` y no integra ninguna
  operación de infraestructura Neon.

## Resultado local

- PostgreSQL 16: 37 migraciones y 47 tablas de aplicación.
- `npm run migration:verify`, `tenant:verify`, `tenant:rls:verify` y
  `tenant:prisma:verify`: `READY`.
- Pruebas focalizadas finales: 29 correctas; TRI-001 cubre creación, replay
  secuencial y concurrente, rollback, colisión de slug y aislamiento A/B.
- `npm run tenant:isolation:test`: 21 correctas y smoke HTTP `READY`.
- Suite completa: 306 correctas y 28 omisiones previstas.
- `npm run build`, `npx prisma validate` y `git diff --check`: correctos.
- `npm audit --omit=dev`: cero vulnerabilidades.

## CI

- PR borrador: [#4](https://github.com/unreal911/backend-refactor-erp/pull/4),
  apilado sobre `agent/emp-002-signup-abuse-controls`.
- Commit funcional validado: `be79c082580ff0bdc205850b88c98fe40f307c76`.
- Ejecución: [Tenant isolation #30710363438](https://github.com/unreal911/backend-refactor-erp/actions/runs/30710363438).
- Job `postgres-isolation`: correcto en 1 min 17 s; migraciones, bootstrap,
  arquitectura Prisma, aislamiento, suite completa y build terminaron verdes.

TRI-001 queda `ACEPTADA`. El siguiente bloque es EMP-005 para completar
invitaciones y acceso inicial por empresa.
