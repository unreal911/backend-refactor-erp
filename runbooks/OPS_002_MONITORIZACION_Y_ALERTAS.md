# Monitorizacion y alertas de preproduccion

La API asigna `x-correlation-id` UUID a cada request y lo conserva en
`AuditLog`. Los jobs registran JSON estructurado con `tenantId` interno,
`correlationId` e `idempotencyKey`. Nunca deben utilizarse RUC, correo o nombre
comercial como etiqueta de metrica.

## Consulta

`GET /api/platform/metrics` requiere un JWT de `PLATFORM_ADMIN`. La respuesta
cubre API, conectividad DB, cola durable, despachos SUNAT, artefactos S3 y
operaciones S3/KMS observadas por el proceso. `noisyTrials` solo devuelve UUID
interno y razones de consumo. `GET /api/health` es liveness y `GET /api/ready`
comprueba PostgreSQL.

## Umbrales y canal

- API: advertencia con error rate >= 5 % y al menos 20 requests.
- DB: critica cuando no responde o tarda >= 1000 ms.
- Cola: advertencia con pendiente >= 300 s; critica con al menos un job `DEAD`.
- S3/KMS/SUNAT: advertencia al observar errores en el proceso.
- Canal: `OPS_ALERT_CHANNEL`; en preproduccion puede ser
  `preproduction-console`, y antes de produccion debe apuntar al canal de guardia.

## Respuesta

1. Copiar codigo de alerta, timestamp y correlation ID, sin copiar payloads.
2. Confirmar `/api/ready`, estado de Railway/Neon y profundidad de cola.
3. Buscar el job por correlation/idempotency key; no abrir XML, PFX ni Clave SOL.
4. Si DB no responde, congelar escrituras y seguir el runbook de backup/restore.
5. Si hay jobs `DEAD`, corregir la dependencia y reencolar de forma idempotente.
6. Para S3/KMS, verificar CloudTrail y el contrato AWS staging antes de reintentar.

La redaccion elimina contrasenas, tokens, autorizacion, PFX/P12, XML y cadenas de
conexion. Un hallazgo de alguno de esos valores en logs se trata como incidente.
