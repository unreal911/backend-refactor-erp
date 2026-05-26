# Guia completa para levantar el backend (paso a paso)

Esta guia esta pensada para alguien que no programo el sistema y solo quiere dejar la API funcionando.

## 1. Que vas a lograr

Al terminar esta guia vas a poder:

1. Levantar la API en tu computadora.
2. Crear el primer usuario administrador.
3. Iniciar sesion y obtener un JWT valido.
4. Probar una ruta protegida con ese token.

---

## 2. Requisitos minimos

Necesitas tener instalado:

1. Node.js 20 o superior.
2. npm (viene con Node.js).
3. PostgreSQL activo (local o remoto).

Verifica en PowerShell:

```powershell
node -v
npm -v
```

Si ambos comandos muestran version, estas listo para continuar.

---

## 3. Ubicarse en la carpeta correcta

Abre PowerShell y entra al proyecto:

```powershell
cd c:\Users\diego\Desktop\proyecto_tienda\backend-refactorizado
```

---

## 4. Crear archivo .env

Copia el ejemplo de desarrollo:

```powershell
Copy-Item .env.example .env
```

Si estas en `cmd` (no PowerShell), usa:

```bat
copy .env.example .env
```

Despues abre `.env` y completa estos valores:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tienda
JWT_SECRET=pon_un_secreto_largo_y_seguro
PUBLIC_PATH=public

CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

NODE_ENV=development

SEED_ENDPOINT_ENABLED=true
SEED_TRIGGER_KEY=opcional_clave_manual
SEED_INCLUDE_DEMO_USERS=true
SEED_DEMO_PASSWORD=password123

SEED_ADMIN_EMAIL=admin@tu-dominio.com
SEED_ADMIN_PASSWORD=una_password_admin_segura
SEED_ADMIN_FIRST_NAME=Admin
SEED_ADMIN_LAST_NAME=Principal
SEED_ADMIN_RESET_PASSWORD=false
```

Notas importantes:

1. `DATABASE_URL` debe apuntar a una base existente y accesible.
2. `CLOUDINARY_*` no puede quedar vacio porque el backend valida esas variables al arrancar.
3. `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` son clave para crear el primer admin.

---

## 5. Instalar dependencias

Ejecuta:

```powershell
npm install
```

---

## 6. Preparar base de datos

Aplica migraciones:

```powershell
npm run db:migrate:deploy
```

Si este paso falla, casi siempre es por:

1. `DATABASE_URL` incorrecta.
2. PostgreSQL apagado.
3. Usuario/password sin permisos.

---

## 7. Crear el primer admin (paso mas importante)

Ejecuta:

```powershell
npm run bootstrap:admin
```

Este comando:

1. Asegura roles y permisos base.
2. Crea o actualiza el usuario admin usando `SEED_ADMIN_*`.
3. No crea usuarios demo adicionales.

Este paso resuelve la duda clasica:

- No puedes tener JWT admin antes de tener al menos un usuario.
- Este comando crea ese primer usuario.

---

## 8. (Opcional) Cargar seed completo

Si quieres datos base extra y demos en desarrollo:

```powershell
npm run seed
```

Con `SEED_INCLUDE_DEMO_USERS=true` agrega usuarios demo como `admin@example.com` y `user@example.com`.

---

## 9. Levantar la API

Ejecuta:

```powershell
npm run dev
```

Si todo va bien, quedara escuchando normalmente en:

`http://localhost:3000`

Deja esta terminal abierta mientras uses la API.

---

## 10. Obtener JWT (login real)

Abre otra terminal y ejecuta:

```powershell
$body = @{
  email = "admin@tu-dominio.com"
  password = "una_password_admin_segura"
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/auth/login" `
  -ContentType "application/json" `
  -Body $body

$login
```

Si sale bien, veras un JSON con:

1. `token`
2. `user`

Guarda ese token para las rutas protegidas.

---

## 11. Probar una ruta protegida

Usa el token recibido:

```powershell
$token = "PEGA_AQUI_TU_TOKEN"

Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/api/auth/me" `
  -Headers @{ Authorization = "Bearer $token" }
```

Si responde datos del usuario, la API quedo lista.

---

## 12. Flujo corto para uso diario

Cada vez que vuelvas a trabajar:

1. Levanta PostgreSQL.
2. Entra a `backend-refactorizado`.
3. Ejecuta `npm run dev`.
4. Haz login en `/api/auth/login`.

Si solo quieres levantar el backend, aplica migraciones pendientes con:

```powershell
npm run db:migrate:deploy
```

Usa `npm run db:migrate:dev` solo cuando estes desarrollando cambios de esquema y quieras crear una migracion nueva.

---

## 13. Flujo para produccion (resumen)

Usa `.env.production.example` como base:

```powershell
Copy-Item .env.production.example .env
```

Si estas en `cmd` (no PowerShell), usa:

```bat
copy .env.production.example .env
```

Luego:

```powershell
npm install
npm run build
npm run db:migrate:deploy
npm run bootstrap:admin:prod
npm start
```

Recomendacion de seguridad en produccion:

1. `SEED_ENDPOINT_ENABLED=false`
2. `SEED_INCLUDE_DEMO_USERS=false`
3. Password admin fuerte
4. `JWT_SECRET` largo y unico

---

## 14. Problemas comunes y solucion rapida

### Error de conexion a DB

Mensaje tipico: no puede conectar a PostgreSQL.

Revisa:

1. Servicio de PostgreSQL encendido.
2. `DATABASE_URL` correcta.
3. Puerto abierto y credenciales validas.

### Error de credenciales invalidas en login

Posibles causas:

1. No corriste `npm run bootstrap:admin`.
2. Email/password no coincide con `.env`.
3. Usuario inactivo.

### Falta alguna variable de entorno

Si la app cae al iniciar, revisa `.env` y completa variables obligatorias.

### Puerto ocupado

Cambia `PORT` en `.env` a otro valor, por ejemplo `3001`.

---

## 15. Checklist final

Antes de dar por terminado:

1. `npm install` ejecutado.
2. `.env` completo.
3. `npm run db:migrate:deploy` sin error.
4. `npm run bootstrap:admin` sin error.
5. `npm run dev` activo.
6. Login en `/api/auth/login` devuelve token.
7. `/api/auth/me` responde con token Bearer.
