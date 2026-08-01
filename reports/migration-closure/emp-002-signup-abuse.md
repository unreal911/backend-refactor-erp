# EMP-002 — Controles de abuso del registro público

Fecha de aceptación: 2026-08-01 (`America/Lima`)

Estado: `ACEPTADA`

## Controles implementados

- Cloudflare Turnstile validado exclusivamente en backend mediante Siteverify.
- Validación adicional de `action`, hostname, expiración/replay del proveedor
  y timeout cerrado.
- Contadores PostgreSQL compartidos por IP, correo normalizado y dispositivo o
  señal equivalente; el límite no depende de una instancia en memoria.
- Bloqueos asesores serializan solicitudes concurrentes y evitan exceder el
  límite por carreras.
- Un correo verificado es la identidad de trial: la credencial es de uso único
  y su consumo rechaza otra prueba activa, incluso con distinta capitalización.
- El 429 incluye `Retry-After` y una referencia opaca para soporte.

## Auditoría y privacidad

- `SignupAbuseEvent` almacena solo huellas HMAC-SHA-256 con clave independiente;
  nunca correo, IP, dispositivo ni CAPTCHA en claro.
- Los rechazos se agregan por hora y por la dimensión que disparó la regla para
  impedir que la propia auditoría sea un vector de crecimiento.
- Los contadores vencidos se purgan automáticamente y tienen índice temporal.
- El middleware HTTP redacta nombre, apellido, negocio, correo, contraseña,
  dispositivo y tokens; además omite IP y user-agent en rutas de alta.
- Soporte lista y revisa eventos solo con JWT de plataforma. Una declaración de
  falso positivo habilita una excepción de 1 a 168 horas y registra operador,
  fecha y un código predefinido sin texto libre.

## Resultado local

- PostgreSQL 16 desechable: 36 migraciones y 47 tablas de aplicación.
- `npm run migration:verify`: `READY`, sin DDL durante el arranque.
- Pruebas focalizadas EMP-001/EMP-002: 44 correctas.
- La integración concurrente EMP-002 se repitió tres veces: 18/18 correctas.
- Matriz tenant: 20 correctas, 1 omisión controlada y smoke HTTP `READY`.
- Suite completa: 269 correctas y 58 omisiones previstas.
- `npm run build`: correcto.
- `npm audit --omit=dev`: cero vulnerabilidades.

## Referencia del proveedor

El adaptador sigue la validación de servidor documentada por Cloudflare:
<https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>.

## CI

- PR borrador: [#3](https://github.com/unreal911/backend-refactor-erp/pull/3),
  apilado sobre `agent/emp-001-owner-registration`.
- Commit funcional validado: `e9bbf83649938821b8aa4dacc99c1c0daa8e4efb`.
- Ejecución: [Tenant isolation #30709227492](https://github.com/unreal911/backend-refactor-erp/actions/runs/30709227492).
- Job `postgres-isolation`: correcto en 1 min 12 s; todos los pasos terminaron
  satisfactoriamente sobre PostgreSQL 16 y Node.js 22.

EMP-002 queda `ACEPTADA`. El registro productivo permanece apagado hasta
completar TRI-001 y configurar las credenciales reales de Turnstile y correo.
