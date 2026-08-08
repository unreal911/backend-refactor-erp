[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$backendRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $backendRoot
$adminRoot = Join-Path $workspaceRoot 'frontend-next'
$marketplaceRoot = Join-Path $workspaceRoot 'frontend-marketplace-next'
$runtimeRoot = Join-Path $backendRoot '.local-runtime'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

function Test-DockerEngine {
    & docker info *> $null
    return $LASTEXITCODE -eq 0
}

function Wait-Until {
    param(
        [Parameter(Mandatory)] [scriptblock] $Condition,
        [Parameter(Mandatory)] [string] $Description,
        [int] $TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) {
            return
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    throw "Tiempo agotado esperando: $Description"
}

function Test-PortListening {
    param([Parameter(Mandatory)] [int] $Port)

    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Start-NpmService {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $WorkingDirectory,
        [Parameter(Mandatory)] [string] $NpmScript,
        [int] $Port = 0,
        [string] $ProcessPattern = ''
    )

    $alreadyRunning = if ($Port -gt 0) {
        Test-PortListening -Port $Port
    } elseif ($ProcessPattern) {
        [bool](Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -match $ProcessPattern
        } | Select-Object -First 1)
    } else {
        $false
    }

    if ($alreadyRunning) {
        Write-Host "[local] $Name ya esta ejecutandose."
        return
    }

    $stdout = Join-Path $runtimeRoot "$Name.out.log"
    $stderr = Join-Path $runtimeRoot "$Name.err.log"
    $process = Start-Process `
        -FilePath $npm `
        -ArgumentList @('run', $NpmScript) `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[local] $Name iniciado (PID $($process.Id))."
}

if (-not (Test-DockerEngine)) {
    $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $dockerDesktop)) {
        throw 'Docker no esta disponible y Docker Desktop no fue encontrado.'
    }

    Write-Host '[local] Iniciando Docker Desktop...'
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    Wait-Until -Description 'Docker Desktop' -TimeoutSeconds 180 -Condition { Test-DockerEngine }
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

Write-Host '[local] Preparando PostgreSQL, Moto, Mailpit, migraciones y seed...'
Push-Location $backendRoot
try {
    & $npm run local:prepare
    if ($LASTEXITCODE -ne 0) {
        throw "local:prepare termino con codigo $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

Start-NpmService -Name 'api' -WorkingDirectory $backendRoot -NpmScript 'dev' -Port 3000
Start-NpmService -Name 'worker' -WorkingDirectory $backendRoot -NpmScript 'worker' -ProcessPattern 'sunat-worker\.ts'
Start-NpmService -Name 'admin' -WorkingDirectory $adminRoot -NpmScript 'dev' -Port 3001
Start-NpmService -Name 'marketplace' -WorkingDirectory $marketplaceRoot -NpmScript 'dev' -Port 3003

$checks = @(
    @{ Name = 'API health'; Url = 'http://127.0.0.1:3000/api/health' },
    @{ Name = 'API ready'; Url = 'http://127.0.0.1:3000/api/ready' },
    @{ Name = 'Administracion'; Url = 'http://127.0.0.1:3001/login' },
    @{ Name = 'Marketplace'; Url = 'http://127.0.0.1:3003/marketplace' },
    @{ Name = 'Mailpit'; Url = 'http://127.0.0.1:8025/api/v1/info' }
)

foreach ($check in $checks) {
    $url = $check.Url
    Wait-Until -Description $check.Name -TimeoutSeconds 120 -Condition {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            return $response.StatusCode -eq 200
        } catch {
            return $false
        }
    }
    Write-Host "[local] OK: $($check.Name) ($url)"
}

Push-Location $backendRoot
try {
    & $npm run scheduler
    if ($LASTEXITCODE -ne 0) {
        throw "scheduler termino con codigo $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Entorno local listo:'
Write-Host '  Administracion: http://localhost:3001/login'
Write-Host '  Marketplace:    http://localhost:3003/marketplace'
Write-Host '  Mailpit:         http://localhost:8025'
Write-Host '  Usuario demo:    admin@example.com / password123'
