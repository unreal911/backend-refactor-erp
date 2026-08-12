# Acceso de plataforma, RBAC y MFA

## Roles iniciales

- `SUPER_ADMIN`: todos los permisos; nunca puede retirarse el último activo.
- `PRODUCT`: planes, borradores y publicación.
- `BILLING`: medios de cobro y aprobación manual.
- `OPERATIONS`: empresas y proveedores.
- `SUPPORT`: consulta limitada de empresas.
- `AUDITOR`: lectura y exportación futura de auditoría.

El backend resuelve permisos persistidos en cada solicitud. Ocultar navegación
no reemplaza la autorización de API. Un cambio de rol incrementa `authVersion`
y revoca los JWT emitidos anteriormente.

## Enrolamiento MFA

1. Entrar a `/platform/security`.
2. Copiar el secreto/URI `otpauth` en un autenticador TOTP.
3. Confirmar un código de seis dígitos.
4. Guardar los ocho códigos de recuperación fuera del sistema.
5. Volver a iniciar sesión con MFA.

El secreto TOTP usa AES-256-GCM con `PLATFORM_MFA_ENC_KEY`. Los códigos de
recuperación solo se guardan como hash y cada uno se consume una vez. Cinco
fallos bloquean MFA durante cinco minutos.

En producción:

```env
PLATFORM_MFA_REQUIRED=true
PLATFORM_MFA_ENC_KEY=<Base64 de 32 bytes>
PLATFORM_MFA_ISSUER=Tienda ERP Plataforma
```

Publicar planes, cambiar proveedor, aprobar/rechazar pagos o administrar
accesos exige MFA verificado en los últimos diez minutos.

## Primer administrador

Crear primero el usuario por el procedimiento normal, configurar
`PLATFORM_ADMIN_EMAIL` y ejecutar `npm run bootstrap:platform-admin:prod`. El
script no crea ni restablece contraseñas y solo asegura el vínculo inicial.
