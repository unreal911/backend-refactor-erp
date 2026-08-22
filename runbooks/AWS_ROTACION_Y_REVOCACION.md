# AWS SUNAT: rotación y revocación

## Principios

- API y worker asumen roles distintos y nunca usan credenciales root.
- Staging y producción usan stacks, buckets y claves KMS distintos.
- El bucket solo admite `tenants/*`, TLS y SSE-KMS del ambiente.
- Staging nunca recibe PFX, Clave SOL ni comprobantes productivos.

## Rotación normal

1. Crear la nueva clave KMS sin retirar la anterior.
2. Actualizar `SUNAT_KMS_KEY_ID` en worker y ejecutar
   `npm run sunat:secrets:migrate-v2 -- --tenant <uuid>` por tenant.
3. Verificar apertura v2, conteos y backup; luego actualizar la API.
4. Para S3, cambiar el cifrado predeterminado y copiar cada objeto sobre sí
   mismo conservando versión, SHA-256 y metadata.
5. Ejecutar `npm run test:aws:staging` y el canario ficticio.
6. Deshabilitar la clave anterior; observar CloudTrail 24 horas antes de
   programar su eliminación, fuera de la ventana de rollback.

## Revocación por incidente

1. Revocar el principal comprometido y retirarlo de la trust policy.
2. Bloquear escrituras SUNAT sin borrar evidencia.
3. Consultar CloudTrail por ARN, clave, bucket, prefijo y periodo.
4. Rotar ExternalId y secretos de Railway; desplegar roles nuevos.
5. Reconciliar hashes S3/BD y secretos por tenant antes de reabrir.
6. Registrar incidente, actores, horas, alcance y aprobación de cierre.

Evidencia: change set/stack ID, ARNs no secretos, contratos AWS, eventos de
`PutObject`, `GetObject`, `GenerateDataKey` y `Decrypt`, y reporte de recifrado.
