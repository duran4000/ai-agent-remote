# Claude Remote Control Service Manager
# 支持开发环境(Dev)和生产环境(Prod)模式

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart")]
    [string]$Action = "restart",

    [Parameter(Position=1)]
    [ValidateSet("dev", "prod")]
    [string]$Env = "dev"
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_DIR = $SCRIPT_DIR  # Script is in project root, not a subdirectory
$SERVER_DIR = Join-Path $PROJECT_DIR "server"
$CLIENT_DIR = Join-Path $PROJECT_DIR "client"
$LOGS_DIR = Join-Path $PROJECT_DIR "logs"
$PORT = 65436

$SERVER_LOCK_FILE = Join-Path $SERVER_DIR "server.lock"
$MANAGER_LOCK_FILE = Join-Path $CLIENT_DIR "session-manager.lock"
$SERVER_LOG_FILE = Join-Path $LOGS_DIR "server.log"
$SERVER_ERR_FILE = Join-Path $LOGS_DIR "server-error.log"
$MANAGER_LOG_FILE = Join-Path $LOGS_DIR "session-manager.log"
$MANAGER_ERR_FILE = Join-Path $LOGS_DIR "session-manager-error.log"

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

function Ensure-LogsDir {
    if (-not (Test-Path $LOGS_DIR)) {
        New-Item -ItemType Directory -Path $LOGS_DIR -Force | Out-Null
        Write-Log "Created logs directory: $LOGS_DIR" "Green"
    }
}

function Stop-AllServices {
    Write-Log "Stopping all services..." "Yellow"

    # 停止 Server
    $netstatOutput = netstat -ano 2>$null | Select-String ":$PORT"
    if ($netstatOutput) {
        $processId = ($netstatOutput -split '\s+') | Select-Object -Last 1
        try {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            Write-Log "Server stopped (PID: $processId)" "Green"
        } catch {}
    }

    # 停止 Session Manager
    $managers = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*session-manager.js*" }
    foreach ($proc in $managers) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Log "Session Manager stopped (PID: $($proc.ProcessId))" "Green"
        } catch {}
    }

    # 清理锁文件
    if (Test-Path $SERVER_LOCK_FILE) { Remove-Item $SERVER_LOCK_FILE -Force -ErrorAction SilentlyContinue }
    if (Test-Path $MANAGER_LOCK_FILE) { Remove-Item $MANAGER_LOCK_FILE -Force -ErrorAction SilentlyContinue }

    Start-Sleep -Milliseconds 500
    Write-Log "All services stopped" "Green"
}

function Start-Server {
    Write-Log "Starting server..." "Yellow"

    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodePath) {
        Write-Log "ERROR: Node.js not found in PATH" "Red"
        exit 1
    }

    $scriptPath = Join-Path $SERVER_DIR "claude-remote-server.js"

    if ($Env -eq "prod") {
        # 生产环境：后台运行，日志写入文件
        Ensure-LogsDir
        Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $SERVER_DIR -WindowStyle Hidden -RedirectStandardOutput $SERVER_LOG_FILE -RedirectStandardError $SERVER_ERR_FILE
        Write-Log "Server started (background mode), log: $SERVER_LOG_FILE" "Green"
    } else {
        # 开发环境：弹出窗口显示日志
        Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $SERVER_DIR -WindowStyle Normal
        Write-Log "Server started (dev mode - visible window)" "Green"
    }
}

function Start-SessionManager {
    Write-Log "Starting Session Manager..." "Yellow"

    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    $scriptPath = Join-Path $CLIENT_DIR "session-manager.js"

    if ($Env -eq "prod") {
        # 生产环境：后台运行，日志写入文件
        Ensure-LogsDir
        Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $CLIENT_DIR -WindowStyle Hidden -RedirectStandardOutput $MANAGER_LOG_FILE -RedirectStandardError $MANAGER_ERR_FILE
        Write-Log "Session Manager started (background mode), log: $MANAGER_LOG_FILE" "Green"
    } else {
        # 开发环境：弹出窗口显示日志
        Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $CLIENT_DIR -WindowStyle Normal
        Write-Log "Session Manager started (dev mode - visible window)" "Green"
    }

    # 等待锁文件创建
    $waited = 0
    while (-not (Test-Path $MANAGER_LOCK_FILE) -and $waited -lt 3000) {
        Start-Sleep -Milliseconds 100
        $waited += 100
    }
}

function Show-Status {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan

    $serverRunning = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*claude-remote-server.js*" }
    $managerRunning = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*session-manager.js*" }

    Write-Host "Environment: " -NoNewline
    Write-Host $Env.ToUpper() -ForegroundColor $(if ($Env -eq "prod") { "Green" } else { "Yellow" })

    Write-Host "Server:      " -NoNewline
    if ($serverRunning) {
        Write-Host "Running (PID: $($serverRunning.ProcessId))" -ForegroundColor Green
    } else {
        Write-Host "Stopped" -ForegroundColor Red
    }

    Write-Host "Session Mgr: " -NoNewline
    if ($managerRunning) {
        Write-Host "Running (PID: $($managerRunning.ProcessId))" -ForegroundColor Green
    } else {
        Write-Host "Stopped" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Access URLs:" -ForegroundColor Cyan
    Write-Host "  Server:  http://127.0.0.1:$PORT"
    Write-Host "  Web App: http://localhost:$PORT/app"
    Write-Host ""

    if ($Env -eq "prod") {
        Write-Host "Log Files:" -ForegroundColor Cyan
        Write-Host "  Server:  $SERVER_LOG_FILE"
        Write-Host "  Manager: $MANAGER_LOG_FILE"
        Write-Host ""
    }
}

# 主逻辑
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Claude Remote Control - Service Manager" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Log "Action: $Action | Environment: $Env" "Cyan"
Write-Host ""

switch ($Action) {
    "stop" {
        Stop-AllServices
    }
    "start" {
        Stop-AllServices
        Start-Sleep -Seconds 1
        Start-Server
        Start-Sleep -Seconds 2
        Start-SessionManager
        Show-Status
    }
    "restart" {
        Stop-AllServices
        Start-Sleep -Seconds 1
        Start-Server
        Start-Sleep -Seconds 2
        Start-SessionManager
        Show-Status
    }
}

Write-Host ""
