# Proveedores de imágenes comerciales

## Principios

- Cloudinary y S3 implementan el mismo puerto de carga, consulta y borrado.
- La base guarda `secretRef`; nunca guarda API secrets o access keys legibles.
- El bucket comercial debe ser distinto del bucket privado SUNAT.
- Cambiar el proveedor solo afecta cargas nuevas. Los objetos antiguos conservan
  proveedor, object key y URL.
- No existe un botón ni endpoint de borrado masivo.

## Cambio controlado

1. Provisionar credenciales fuera del dashboard.
2. Registrar un perfil inactivo con ambiente, región, bucket/carpeta y CDN.
3. Ejecutar la prueba aislada. Debe completar carga, lectura y borrado.
4. Iniciar sesión con MFA, escribir el nombre exacto y el motivo.
5. Activar el perfil y observar errores/consumo.
6. Si falla, reactivar el perfil anterior; no migrar ni duplicar objetos.

## Cuotas

`CommercialAsset` registra tenant, propósito, propietario, proveedor, URL,
bytes, MIME, dimensiones, SHA-256 y estado. Una reserva `UPLOADING`, protegida
por bloqueo asesor por empresa, evita que cargas concurrentes excedan la cuota.
Al llegar al límite se bloquean cargas nuevas, no lecturas ni CPE SUNAT.

Cloudinary genera miniatura, catálogo y detalle con el perfil
`commercial-v1`. El adaptador S3 ya está disponible para la transición, pero
antes de activarlo en producción se debe validar CDN/transformación y contratos
en AWS staging.

## Variables S3

```env
AWS_REGION=
PRODUCT_IMAGE_S3_BUCKET=
PRODUCT_IMAGE_S3_PUBLIC_BASE_URL=https://cdn.example.com
```

Usar rol IAM en producción. `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` solo
se usan juntos cuando el entorno no ofrece credenciales de rol.
