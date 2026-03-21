$ErrorActionPreference = "Stop"

$PROJECT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PORT = 9527

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Claude Remote Control - Restart Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/6] Checking port $PORT..." -ForegroundColor Yellow
$netstatOutput = netstat -ano | Select-String ":$PORT"
if ($netstatOutput) {
    $processId = ($netstatOutput -split '\s+') | Select-Object -Last 1
    Write-Host "Found process: PID=$processId" -ForegroundColor Red
    Write-Host "Stopping process..." -ForegroundColor Yellow
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host "Process stopped" -ForegroundColor Green
} else {
    Write-Host "Port $PORT is free" -ForegroundColor Green
}
Write-Host ""

Write-Host "[2/6] Stopping old Session Manager processes..." -ForegroundColor Yellow
$stopped = $false
$maxAttempts = 3
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $oldManagers = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*session-manager.js*" }
    if ($oldManagers) {
        foreach ($proc in $oldManagers) {
            Write-Host "Stopping Session Manager (PID: $($proc.ProcessId))..." -ForegroundColor Yellow
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    } else {
        $stopped = $true
        break
    }
}
if ($stopped -or $attempt -ge $maxAttempts) {
    Write-Host "Old Session Manager processes stopped" -ForegroundColor Green
} else {
    Write-Host "Warning: Some processes may still be running" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "[3/6] Cleaning lock files..." -ForegroundColor Yellow
$serverLock = Join-Path $PROJECT_DIR "server\server.lock"
$managerLock = Join-Path $PROJECT_DIR "client\session-manager.lock"

if (Test-Path $serverLock) {
    Remove-Item -Path $serverLock -Force
    Write-Host "Deleted: server.lock" -ForegroundColor Green
}
if (Test-Path $managerLock) {
    Remove-Item -Path $managerLock -Force
    Write-Host "Deleted: session-manager.lock" -ForegroundColor Green
}
Write-Host ""

Write-Host "[4/6] Starting server..." -ForegroundColor Yellow
$existingServer = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*claude-remote-server.js*" }
if ($existingServer) {
    Write-Host "Server already running (PID: $($existingServer.ProcessId)), skipping..." -ForegroundColor Yellow
} else {
    $nodePath = (Get-Command node).Source
    $serverDir = Join-Path $PROJECT_DIR "server"
    $scriptPath = Join-Path $serverDir "claude-remote-server.js"
    Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $serverDir -WindowStyle Normal
    Write-Host "Server started" -ForegroundColor Green
}
Start-Sleep -Seconds 2
Write-Host ""

Write-Host "[5/6] Starting Session Manager..." -ForegroundColor Yellow
$existingManagers = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*session-manager.js*" }
if ($existingManagers) {
    Write-Host "Session Manager already running (PID: $($existingManagers[0].ProcessId)), skipping..." -ForegroundColor Yellow
} else {
    $nodePath = (Get-Command node).Source
    $clientDir = Join-Path $PROJECT_DIR "client"
    $scriptPath = Join-Path $clientDir "session-manager.js"
    Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $clientDir -WindowStyle Normal
    Write-Host "Waiting for Session Manager to initialize..."
    $lockFile = Join-Path $clientDir "session-manager.lock"
    $waited = 0
    while (-not (Test-Path $lockFile) -and $waited -lt 5000) {
        Start-Sleep -Milliseconds 200
        $waited += 200
    }
    if (Test-Path $lockFile) {
        Write-Host "Session Manager started and lock file created" -ForegroundColor Green
    } else {
        Write-Host "Warning: Lock file not created within 5 seconds" -ForegroundColor Yellow
    }
}
Start-Sleep -Seconds 2
Write-Host ""

Write-Host "[6/6] Verifying services..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Services started successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Server: http://127.0.0.1:$PORT" -ForegroundColor Cyan
Write-Host "Web App: http://localhost:$PORT/app" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note:" -ForegroundColor Yellow
Write-Host "- Services are running in separate windows" -ForegroundColor White
Write-Host "- Access Web App in browser to test" -ForegroundColor White
Write-Host "- Closing this window will not stop services" -ForegroundColor White
Write-Host ""
# Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
