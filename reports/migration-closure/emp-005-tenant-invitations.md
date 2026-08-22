# EMP-005 — Invitaciones y acceso multiempresa

Fecha de aceptación: 2026-08-02 (`America/Lima`)

Estado: `ACEPTADA`

## Contrato implementado

- `OWNER` y `ADMIN` pueden crear, listar y revocar invitaciones dentro de su
  empresa; los roles invitables son `ADMIN`, `SELLER` y `VIEWER`.
- Las invitaciones públicas se inspeccionan y aceptan mediante token. Solo se
  persiste su HMAC-SHA-256, tienen vencimiento y el consumo es idempotente.
- Una cuenta existente confirma su contraseña y recibe únicamente la nueva
  `TenantMembership`. Una persona nueva define una contraseña segura después
  de demostrar posesión del token y recién entonces se crea su cuenta.
- Se eliminó la creación directa de usuarios desde administración: el alta de
  colaboradores pasa exclusivamente por el flujo de invitaciones.

## Multiempresa y aislamiento

- El login global entra directamente con una sola membresía activa. Con varias
  devuelve `409` y las empresas mínimas permitidas para repetir el acceso con
  `tenantSlug`.
- El slug no concede acceso: solo selecciona una membresía activa ya asociada a
  la identidad. El JWT incluye tenant y membresía, que se revalidan en cada
  petición autenticada.
- `TenantInvitation` usa claves foráneas compuestas con `tenantId`, índice único
  parcial para invitaciones pendientes, RLS forzado y política del rol runtime.
- Las pruebas A/B confirman que otro tenant no puede leer ni consumir una
  invitación ajena, incluso con identificadores conocidos.

## Frontend

- Registro de propietario, verificación del correo y aprovisionamiento del trial.
- Aceptación pública de invitaciones y creación o vinculación de cuenta.
- Administración de invitaciones con rol, listado y revocación.
- Selector de empresa ante el `409` y empresa activa visible permanentemente.
- La creación directa desde la pantalla de usuarios fue reemplazada por
  «Invitar usuario».

## Resultado local

- Migración `20260802120000_add_tenant_invitations` aplicada correctamente;
  PostgreSQL 16 quedó con 48 tablas de aplicación.
- Suite backend: 53 archivos correctos, 1 omitido; 312 pruebas correctas y 28
  omisiones previstas. Las 6 pruebas focalizadas de EMP-005 terminaron verdes.
- `npm run migration:verify`, `tenant:verify`, `tenant:isolation:verify` y el
  smoke HTTP quedaron `READY`; build correcto y `npm audit --omit=dev` sin
  vulnerabilidades.
- Frontend: build correcto, 63 pruebas unitarias correctas y revisión visual
  local de registro, login y aceptación de invitación.
- Commit backend: `ce05c5a7b0dcbd6fdd36eb43a5a17dacc4f4ae8b`.
- Commit frontend: `7f9f7e9ef34fbcb0875153ceb406ccaf0ff1f081`.

## Configuración de despliegue

- Backend: definir `TENANT_INVITATION_ENABLED=true`, un
  `TENANT_INVITATION_TOKEN_PEPPER` exclusivo de al menos 32 caracteres, la URL
  HTTPS de aceptación, TTL y credenciales SMTP.
- Frontend: definir `NEXT_PUBLIC_TURNSTILE_SITE_KEY` para habilitar el registro
  público protegido por Turnstile.

EMP-005 queda `ACEPTADA`. El siguiente bloque recomendado es `INF-005`,
`SEC-003` y `SUN-001` a `SUN-011`.
