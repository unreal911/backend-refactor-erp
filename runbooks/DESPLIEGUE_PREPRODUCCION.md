# Despliegue de preproducción

Objetivos mínimos antes de contratar/activar producción: RPO de base de datos
menor o igual a 15 minutos y RTO menor o igual a 120 minutos. Deben comprobarse
con las capacidades reales del plan Neon; documentarlos aquí no sustituye el
simulacro. Para artefactos SUNAT se mantienen versionado y al menos 90 días de
versiones no vigentes, ajustables por política legal aprobada.

1. Crear Neon `development`, `staging` y `production` separados. Usar rol de
   migración directo y rol runtime sin `BYPASSRLS` mediante pool.
2. Desplegar el stack AWS con `Environment=staging`; guardar outputs en Railway.
3. Crear tres servicios desde la misma imagen/commit: API
   (`railway.api.toml`), worker (`railway.worker.toml`) y scheduler diario
   (`railway.scheduler.toml`). Solo API ejecuta el pre-deploy de migraciones.
4. Configurar `.env.production.example`; `DIRECT_DATABASE_URL` se limita al
   release y no se comparte con el runtime si la plataforma permite separarlo.
5. Desplegar admin y marketplace como proyectos Vercel separados. Previews
   apuntan a staging o quedan sin URL productiva.
6. Validar `/api/health`, `/api/ready`, `/api/platform/metrics`, migraciones,
   RLS, contratos AWS, dos tenants, worker y URLs. Configurar
   `OPS_ALERT_CHANNEL` y ejecutar una alerta sintética según
   `OPS_002_MONITORIZACION_Y_ALERTAS.md`.

Mantener `SUNAT_LEGACY_BASE64_FALLBACK_ENABLED=true` durante la observación del
cutover documental. Cambiarlo a `false` solo después de reconciliar hashes,
aprobar el backup y completar el período acordado.

Rollback: bloquear escrituras, volver a la imagen anterior compatible, restaurar
variables previas y ejecutar smokes. Moto no se despliega fuera del entorno local.
