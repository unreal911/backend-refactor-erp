# MIG-012: resultado del ensayo local

## Resultado

- Estado técnico local: `READY_FOR_GO_NO_GO`.
- Decisión de salida productiva: `NO-GO_EXTERNAL`.
- Base destino aislada: `tienda_rehearsal`.
- Backup restaurado: `reports/mig-012/mig012-current.dump`.
- SHA-256 del backup:
  `535D511C5F0E285AB898212355955B22F7CF0107CAA32DC49D6AF80A4794E5E2`.
- Tiempo activo medido de las etapas vigentes: `190261 ms` (3 min 10.261 s).
- Evidencia reanudable: `reports/mig-012/local-current-20260802.json`.

El backup corresponde al estado local de desarrollo capturado el 2 de agosto de
2026. No sustituye el backup final e inmutable del origen productivo.

## Validaciones aprobadas

- 43 migraciones formales y grants del rol runtime.
- Backfills `MIG-003` a `MIG-011`, reconciliación SUNAT y cierre de secuencias.
- RLS habilitado y forzado en 44/44 tablas; acceso sin tenant y cruce A/B
  rechazados en HTTP, Prisma y jobs.
- Migración documental contra Moto: 1 tenant, 9 filas heredadas y 36 artefactos
  S3 verificados por hash. El origen Base64 se conservó.
- Migrador de secretos KMS ejecutado: el backup no contenía configuraciones
  heredadas que recifrar (`0` secretos); los contratos v1/v2 y aislamiento KMS
  se validaron en las suites automatizadas.
- 335 pruebas activas aprobadas; 46 pruebas externas omitidas por configuración.
- 28/28 contratos Moto aprobados.
- Backend y ambos frontends compilaron para producción.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Fallos inyectados y reanudados después de `inventory`, `migrations` y
  `sunat_reconcile`.
- Exportación lógica tenant con manifiesto y SHA-256, sin secretos; disponible
  también durante solo lectura desde la pantalla Empresa y plan.
- Purga de trials por tenant y lotes, idempotente y reanudable, con borrado de
  identidad huérfana y conservación de trazabilidad mínima.
- Observabilidad local para API, DB, cola, SUNAT, S3 y KMS, correlation ID,
  detección de trials ruidosos y política de alertas documentada.
- Rollback local contra el origen en modo PostgreSQL read-only: health,
  readiness, login y lecturas aprobadas; 54 tablas conservaron la huella
  `4bbe5127de4981b2f6c888956f8af46581b114acb90e5fc00462dea3de056591`.

## Incidencias encontradas y corregidas

- Grants del rol runtime ausentes después de restaurar un dump sin ACL.
- Pruebas que todavía trataban un tenant suspendido como escribible.
- Checkpoint de identidad que podía perder los identificadores sellados.
- Carrera en la primera reserva de correlativo SUNAT.
- Posible sobrescritura S3 ante carreras con bytes distintos.
- Tickets SUNAT pendientes consumían intentos de error.
- Procesos de migración no cerraban clientes S3/KMS y recorrían tenants sin
  evidencia heredada.
- Un restore PostgreSQL podía conservar metadatos S3 cuyos objetos no habían
  sido restaurados; el migrador ahora rehidrata desde el origen heredado y
  vuelve a verificar hash sin duplicar filas.
- Los jobs CLI de migración documental podían desbordar `maxAttempts` tras
  varias reanudaciones; cada ejecución durable reinicia su intento actual.
- La huella histórica de MIG-010 ahora excluye el nuevo correlation ID aleatorio
  y MIG-011 distingue crecimiento RBAC posterior de faltantes de la línea base.

## Bloqueos para un GO real

- Desplegar y probar AWS staging real: S3 con SSE-KMS, dos claves KMS,
  CloudTrail, IAM mínimo y rotación/revocación.
- Restaurar un backup en Neon staging y comprobar RPO/RTO contratados.
- Desplegar API, worker y scheduler en Railway y ambos frontends en Vercel.
- Ejecutar canario AWS, alertas y observación de lectura S3 antes de retirar
  Base64 o la llave v1.
- Acordar ventana de mantenimiento, margen, responsables, contactos y punto de
  no retorno.
- Ensayar el rollback sobre los servicios desplegados manteniendo el origen
  productivo inmutable.
- Repetir MIG-012 desde el backup productivo final.

La imagen Docker no pudo completarse en este equipo porque Docker Desktop cortó
cuatro veces la descarga de npm/`@prisma/engines` con `ECONNRESET`; el build nativo de
TypeScript/Prisma sí quedó aprobado. Esta incidencia debe repetirse en CI o en
una red estable antes del despliegue Railway.
