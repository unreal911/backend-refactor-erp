# MIG-012: ensayo y rollback

## Preparación

- Responsable de migración, responsable de negocio y contacto de infraestructura.
- Backup inmutable identificado, restaurado en una base cuyo nombre incluya
  `rehearsal`, `restore`, `staging` o `ensayo`.
- Fuente en solo lectura durante la captura de huellas inicial/final.
- Ventana objetivo: registrar el valor acordado antes del ensayo; el reporte
  mide la duración real y no decide el margen por sí solo.

## Ejecución reanudable

Definir `MIG012_DATABASE_URL`, `MIG012_BACKUP_ID`, `MIG012_RUN_ID` y
`MIG012_CONFIRM=RESTORED_TARGET_ONLY`. Ejecutar `npm run migration:rehearsal`.
El estado queda en `reports/mig-012`; no contiene la conexión.
`durationMs` suma el tiempo activo de las etapas vigentes; el tiempo calendario,
incluidas pausas entre reanudaciones, queda en `wallClockDurationMs`.
Tras restaurar, el procedimiento reaplica de forma idempotente los grants del
rol runtime; no depende de que el backup conserve ACL entre proveedores.

Forzar y reanudar tres cortes usando el mismo run ID/state:

1. `MIG012_FAIL_AFTER=inventory`
2. `MIG012_FAIL_AFTER=migrations`
3. `MIG012_FAIL_AFTER=sunat_reconcile`
4. Sin `MIG012_FAIL_AFTER`, completar.

Cada reanudación omite pasos aprobados y conserva duración/salida sanitizada.
Si el código cambia durante el ensayo, repetir solo las etapas afectadas con
`MIG012_RERUN_STEPS=functional_suite,build`, usando el mismo backup, destino y
run ID. La solicitud queda registrada dentro del checkpoint.
La suite funcional cubre login, RBAC, catálogo, inventario, transferencias,
POS, pedidos, picking, devoluciones, marketplace, configuración y auditoría;
el bloque de aislamiento cubre dos tenants y ausencia de contexto.

## Rollback ensayado

1. Mantener cerradas las escrituras del destino.
2. Detener API, worker y scheduler nuevos y drenar conexiones.
3. Restaurar la configuración de frontends/API hacia el origen inmutable.
4. Ejecutar health, login, lectura y una operación sintética autorizada.
5. Comparar huella del origen antes/después; debe ser idéntica hasta reabrir.
6. Conservar destino fallido y evidencia; no mezclar escrituras entre bases.

Para verificar localmente el regreso de servicio, usar una URL al origen que
imponga `default_transaction_read_only=on`, definir `ROLLBACK_CONFIRM=READ_ONLY_SOURCE`,
`ROLLBACK_RESPONSIBLE` y las credenciales de smoke, y ejecutar
`npm run ops:rollback:verify`. El comando comprueba health, readiness, login,
lectura autenticada y marketplace, y compara la huella de todas las tablas
antes/despues. El acta JSON queda en `reports/mig-012/rollback-*.json` sin URL ni
credenciales. Esto prueba el mecanismo local; Railway/Neon deben repetirlo con
el origen real antes de aceptar `MIG-012`.

Punto de no retorno de MIG-013 (fuera de este ensayo): abrir escrituras en el
destino después del delta final. Antes de ese punto, rollback es configuración.

## Acta GO | NO-GO

- Backup/restore y hashes: ___
- Duración / ventana / margen: ___
- Tres reanudaciones: ___
- AWS staging, CloudTrail y KMS: ___
- Backup/restore Neon: ___
- Smokes de dos tenants: ___
- Responsable migración: ___  Negocio: ___  Infraestructura: ___
- Decisión: `GO | NO-GO`  Fecha: ___
