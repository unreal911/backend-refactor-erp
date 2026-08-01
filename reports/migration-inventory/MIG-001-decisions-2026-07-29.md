# Decisiones de cierre MIG-001

- Fecha de aprobación: 2026-07-29, `America/Lima`.
- Línea base: `legacy-baseline-2026-07-29T06-34-28-407Z.json`.
- Aprobación: propietario del proyecto, mediante la instrucción de continuar con
  las decisiones recomendadas.

## Hallazgos aprobados

### `invalid:picking_quantity_invalid`

**Decisión:** `QUARANTINE`.

`PickingItem.id=8` se preserva como evidencia heredada y no se corrige ni se
descarta silenciosamente. El backfill lo excluirá del flujo normalizado y
registrará su identificador, motivo, huella y resolución en la cuarentena de
migración antes de cerrar `MIG-011`.

### `media:external-references`

**Decisión:** `MIGRATE`.

Las 21 referencias Cloudinary se migrarán conservando su URL actual y una huella
en el manifiesto de medios. No se descargan en `MIG-001`; su copia a S3 y la
reconciliación pertenecen a `SUN-003` y `SUN-004`.

### `unstructured:payment-in-order-note`

**Decisión:** `TRANSFORM`.

Los 18 pedidos conservarán íntegramente `Order.note`. Cuando exista el modelo de
pago destino, el backfill extraerá método y referencia en columnas estructuradas,
mantendrá la nota original y conciliará conteo y huella antes de retirar cualquier
representación heredada.

## Resultado

Las tres decisiones están aprobadas. `MIG-001` puede cerrarse como `ACEPTADA`;
ningún dato fue modificado durante el inventario.
