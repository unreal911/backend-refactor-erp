# TEN-007 — Aislamiento SUNAT por empresa

- Estado: READY
- Migracion: `20260729230000_tenant_scope_sunat`
- Tablas SUNAT con tenantId NOT NULL: 7/7
- Restricciones tenant validadas: 16/16
- Indices fiscales por empresa: 6/6
- Referencias cruzadas: 0
- Claves fiscales duplicadas: 0

## Datos historicos reconciliados

| Tabla | Filas | IDs | Total de control |
|---|---:|---|---:|
| ComprobanteSerie | 3 | 1, 2, 3 | 17 |
| Comprobante | 10 | 1, 2, 3, 4, 12, 13, 15, 16, 17, 18 | 49 |
| ComprobanteItem | 10 | 1, 2, 3, 4, 12, 13, 15, 16, 17, 18 | 14.000 |
| SunatDispatch | 6 | 1, 2, 3, 4, 10, 11 | 0 |
| ResumenDiario | 2 | 1, 2 | 3 |
| ComunicacionBaja | 1 | 1 | 1 |
| SunatEmisorConfig | 0 | — | 0 |
