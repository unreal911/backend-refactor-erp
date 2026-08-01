# TEN-010 — Matriz automática de aislamiento

Fecha: 2026-07-29 (`America/Lima`)

Estado: `LISTA_PARA_VALIDAR`

## Cobertura

- Empresas A/B reales sobre PostgreSQL y RLS forzado.
- Catálogo, inventario, ventas, usuarios, marketplace, configuración,
  trazabilidad y SUNAT.
- Listar/leer, crear relación, actualizar, eliminar y rechazar cruces.
- Acceso directo por `tenantPrisma`.
- HTTP autenticado y público.
- Contexto ausente, empresa suspendida y membresía inactiva.

## Resultado local

- `npm run tenant:isolation:test`: 21 pruebas activas correctas y smoke `READY`.
- Suite general heredada: 261 activas correctas, 28 opcionales omitidas.
- Base vacía temporal: 34 migraciones, matriz correcta y 231 pruebas generales
  activas correctas; 58 conciliaciones históricas no aplicables omitidas.
- `npm run build`: correcto.
- `npm audit --omit=dev`: cero vulnerabilidades.

Revalidación del 1 de agosto de 2026 sobre PostgreSQL 16 desechable:

- Se reprodujo la secuencia del workflow desde `npm ci`.
- La matriz ejecutó 20 pruebas correctas y 1 omisión controlada; el smoke HTTP
  terminó `READY` y rechazó tenant cruzado, tenant suspendido y membresía
  inactiva.
- La suite completa ejecutó 234 pruebas correctas y omitió 55 conciliaciones o
  escenarios no aplicables a la base vacía.
- `npm run build` terminó correctamente.
- Se añadió `npm run db:generate` antes del bootstrap: Prisma 7 no deja el
  cliente generado después de la instalación limpia usada por CI.

## CI

El workflow `.github/workflows/tenant-isolation.yml` usa PostgreSQL 16 y ejecuta
migraciones, bootstrap, verificadores, matriz, suite y build.

Pendiente único: publicar la rama y registrar la primera ejecución verde del job
`postgres-isolation` para pasar TEN-010 a `ACEPTADA`.
