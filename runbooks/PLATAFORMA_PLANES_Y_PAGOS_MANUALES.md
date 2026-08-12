# Planes versionados y pagos manuales

## Regla de seguridad comercial

- Una transferencia o QR crea `ManualPaymentRequest` en `PENDING_REVIEW`.
- La solicitud nunca cambia el plan por sí sola.
- Solo `platform.payments.approve`, con MFA reciente, puede aprobarla.
- El monto verificado debe coincidir exactamente con la oferta almacenada.
- La referencia de operación aprobada no puede reutilizarse.
- Repetir la aprobación de la misma solicitud es idempotente.
- `BILLING_WEBHOOK_ENABLED=false` mantiene apagada la automatización futura.

## Publicar una versión

1. Crear un borrador desde `/platform/plans`.
2. Editar cuotas, precio y capacidades controladas.
3. Ejecutar la validación de impacto.
4. Iniciar una sesión con MFA y programar la vigencia indicando el motivo.
5. El scheduler activa versiones vencidas mediante un bloqueo asesor.
6. La política `NEW_CUSTOMERS` conserva el snapshot de empresas existentes.

Las versiones activas son inmutables. Para corregir una versión se crea otra;
no se edita historia ni se borran asignaciones.

## Atender un pago

1. Revisar empresa, plan, monto, medio y constancia.
2. Contrastar el abono fuera del ERP con la entidad bancaria o billetera.
3. Escribir referencia y nota interna.
4. Aprobar con MFA reciente o rechazar indicando motivo.
5. Verificar el evento en `/platform/audit` y la asignación en la empresa.

## Incidentes y reversión

- Si se aprobó la solicitud incorrecta, no se borra: se crea una asignación de
  corrección desde plataforma y se documenta el incidente.
- Si una versión programada es incorrecta, puede cancelarse antes de su
  vigencia. Si ya está activa, se publica una versión correctiva.
- Las cuotas nunca bloquean una corrección SUNAT de una venta previa. Trial sí
  permanece sin SUNAT.
