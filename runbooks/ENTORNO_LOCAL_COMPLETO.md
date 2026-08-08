# Entorno local completo

Esta guia levanta y prueba la plataforma completa sin depender de servicios cloud.

## Servicios y puertos

| Servicio | URL o puerto |
| --- | --- |
| API | http://localhost:3000/api |
| Administracion | http://localhost:3001/login |
| Marketplace | http://localhost:3003/marketplace |
| Mailpit | http://localhost:8025 |
| PostgreSQL | localhost:5432 |
| Moto (S3/KMS local) | http://localhost:5000 |

Requisitos: Docker Desktop en ejecucion y Node.js con npm.

## Primera preparacion

Ejecutar desde PowerShell. Los `Copy-Item` solo son necesarios cuando todavia no existe el archivo local correspondiente.

```powershell
Set-Location backend-refactorizado
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm run local:prepare

Set-Location ..\frontend-next
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm install

Set-Location ..\frontend-marketplace-next
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm install
```

`local:prepare` inicia PostgreSQL, Moto y Mailpit; espera sus healthchecks; aplica migraciones y permisos RLS; crea el bucket y la clave KMS locales; y carga los datos demo. Es seguro repetirlo: no elimina el volumen de PostgreSQL.

## Levantar la aplicacion

Despues de reiniciar Windows, el arranque completo puede hacerse con un solo comando. Es idempotente: restaura Docker si hace falta, prepara la infraestructura, evita duplicar procesos, valida los endpoints y ejecuta el scheduler.

```powershell
Set-Location backend-refactorizado
npm run local:start
```

Como alternativa, para observar cada proceso en una terminal distinta durante el desarrollo, usar los comandos siguientes.

Usar terminales separadas desde la raiz del proyecto:

```powershell
# Terminal 1: API
Set-Location backend-refactorizado
npm run dev
```

```powershell
# Terminal 2: worker de trabajos asincronos
Set-Location backend-refactorizado
npm run worker
```

```powershell
# Terminal 3: administracion
Set-Location frontend-next
npm run dev
```

```powershell
# Terminal 4: marketplace
Set-Location frontend-marketplace-next
npm run dev
```

El scheduler se ejecuta una vez cuando se necesite disparar los trabajos programados:

```powershell
Set-Location backend-refactorizado
npm run scheduler
```

Para comprobar una sola iteracion del worker sin dejar otro proceso abierto:

```powershell
Set-Location backend-refactorizado
npm run worker:once
```

Usuario demo de administracion:

- Correo: `admin@example.com`
- Contrasena: `password123`
- Empresa/tenant: `legacy-main`

Los correos de registro, invitacion y avisos se reciben en Mailpit; no salen a Internet.

## Verificacion

Con la aplicacion levantada:

```powershell
Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing
Invoke-WebRequest http://localhost:3000/api/ready -UseBasicParsing
Invoke-WebRequest http://localhost:3001/login -UseBasicParsing
Invoke-WebRequest http://localhost:3003/marketplace -UseBasicParsing
Invoke-WebRequest http://localhost:8025/api/v1/info -UseBasicParsing
```

Pruebas automatizadas:

```powershell
Set-Location backend-refactorizado
npm run local:verify

Set-Location ..\frontend-next
npm run lint
npm run test:unit
npm run test:e2e
npm run test:e2e:local
npm run build

Set-Location ..\frontend-marketplace-next
npm run lint
npm run build
```

La verificacion del backend crea y reutiliza una base separada con sufijo `_test`. Las pruebas no escriben en la base demo que usa la interfaz.

`test:e2e:local` comprueba el login real, el dashboard, el catalogo demo con siete productos y Mailpit. Requiere que API, administracion y marketplace ya esten ejecutandose.

## Detener infraestructura

```powershell
Set-Location backend-refactorizado
npm run local:infra:down
```

Este comando conserva los datos de PostgreSQL. No usar `docker compose down -v` salvo que se quiera borrar y reconstruir de forma irreversible toda la base local.

## Alcance pendiente para despliegue

Este entorno sustituye S3/KMS por Moto, el correo externo por Mailpit y PostgreSQL administrado por el contenedor local. La migracion posterior a AWS, Neon y los proveedores definitivos debe documentarse por separado junto con secretos, redes, backups, observabilidad y procedimiento de rollback.
