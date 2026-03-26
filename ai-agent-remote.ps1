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

# 从 config.json 读取端口配置
$ConfigFile = Join-Path $PROJECT_DIR "config.json"
if (Test-Path $ConfigFile) {
    $Config = Get-Content $ConfigFile | ConvertFrom-Json
    $PORT = $Config.server.port
} else {
    $PORT = 41491  # 默认端口（config.json 不存在时使用）
}

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

function Save-Pids {
    param([int]$ServerPid, [int]$ManagerPid)
    Ensure-LogsDir  # .pids 放在 logs/ 目录
    $pidFilePath = Join-Path $LOGS_DIR "service.pids"
    "${ServerPid},${ManagerPid}" | Out-File -FilePath $pidFilePath -Encoding utf8 -NoNewline
}

function Read-Pids {
    $pidFilePath = Join-Path $LOGS_DIR "service.pids"
    if (-not (Test-Path $pidFilePath)) { return $null }
    $content = Get-Content $pidFilePath -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return $null }
    $parts = $content.Trim() -split ","
    return @{ Server = [int]$parts[0]; Manager = [int]$parts[1] }
}

function Stop-ProcessIfExists {
    param([int]$ProcessId, [string]$Label)
    if ($ProcessId -le 0) { return }
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
            Write-Log "$Label stopped (PID: $ProcessId)" "Green"
        }
    } catch {}
}

function Stop-AllServices {
    Write-Log "Stopping all services..." "Yellow"

    # 1. 优先通过 PID 文件停止
    $pids = Read-Pids
    if ($pids) {
        Stop-ProcessIfExists -ProcessId $pids.Manager -Label "Session Manager"
        Stop-ProcessIfExists -ProcessId $pids.Server -Label "Server"
        # 清理 PID 文件
        $pidFilePath = Join-Path $LOGS_DIR "service.pids"
        if (Test-Path $pidFilePath) { Remove-Item $pidFilePath -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 500
    }

    # 2. 兜底：通过命令行匹配残留 node 进程（排除自身）
    $strayProcesses = Get-WmiObject Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "node.exe" -and ($_.CommandLine -like "*claude-remote-server.js*" -or $_.CommandLine -like "*session-manager.js*") }
    foreach ($proc in $strayProcesses) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            $label = if ($proc.CommandLine -like "*session-manager.js*") { "Session Manager" } else { "Server" }
            Write-Log "$label stopped via command line match (PID: $($proc.ProcessId))" "Green"
        } catch {}
    }

    # 3. 兜底：通过端口查找占用进程（处理 CommandLine 为空的孤儿进程）
    $portOwner = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -First 1
    if ($portOwner) {
        Stop-ProcessIfExists -ProcessId $portOwner -Label "Server (port $PORT)"
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
        $proc = Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $SERVER_DIR -WindowStyle Hidden -RedirectStandardOutput $SERVER_LOG_FILE -RedirectStandardError $SERVER_ERR_FILE -PassThru
        Write-Log "Server started (PID: $($proc.Id), background mode), log: $SERVER_LOG_FILE" "Green"
    } else {
        # 开发环境：弹出窗口显示日志
        $proc = Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $SERVER_DIR -WindowStyle Normal -PassThru
        Write-Log "Server started (PID: $($proc.Id), dev mode - visible window)" "Green"
    }

    return $proc.Id
}

function Start-SessionManager {
    Write-Log "Starting Session Manager..." "Yellow"

    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    $scriptPath = Join-Path $CLIENT_DIR "session-manager.js"

    if ($Env -eq "prod") {
        # 生产环境：后台运行，日志写入文件
        Ensure-LogsDir
        $proc = Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $CLIENT_DIR -WindowStyle Hidden -RedirectStandardOutput $MANAGER_LOG_FILE -RedirectStandardError $MANAGER_ERR_FILE -PassThru
        Write-Log "Session Manager started (PID: $($proc.Id), background mode), log: $MANAGER_LOG_FILE" "Green"
    } else {
        # 开发环境：弹出窗口显示日志
        $proc = Start-Process -FilePath $nodePath -ArgumentList $scriptPath -WorkingDirectory $CLIENT_DIR -WindowStyle Normal -PassThru
        Write-Log "Session Manager started (PID: $($proc.Id), dev mode - visible window)" "Green"
    }

    # 等待锁文件创建
    $waited = 0
    while (-not (Test-Path $MANAGER_LOCK_FILE) -and $waited -lt 3000) {
        Start-Sleep -Milliseconds 100
        $waited += 100
    }

    return $proc.Id
}

function Show-Status {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan

    # 优先通过 PID 文件判断
    $pids = Read-Pids
    if ($pids) {
        $serverAlive = $false
        $managerAlive = $false
        try { if (Get-Process -Id $pids.Server -ErrorAction SilentlyContinue) { $serverAlive = $true } } catch {}
        try { if (Get-Process -Id $pids.Manager -ErrorAction SilentlyContinue) { $managerAlive = $true } } catch {}
    } else {
        $serverAlive = $false
        $managerAlive = $false
    }

    Write-Host "Environment: " -NoNewline
    Write-Host $Env.ToUpper() -ForegroundColor $(if ($Env -eq "prod") { "Green" } else { "Yellow" })

    Write-Host "Server:      " -NoNewline
    if ($serverAlive) {
        Write-Host "Running (PID: $($pids.Server))" -ForegroundColor Green
    } else {
        Write-Host "Stopped" -ForegroundColor Red
    }

    Write-Host "Session Mgr: " -NoNewline
    if ($managerAlive) {
        Write-Host "Running (PID: $($pids.Manager))" -ForegroundColor Green
    } else {
        Write-Host "Stopped" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Access URLs:" -ForegroundColor Cyan
    Write-Host "  Server:  http://127.0.0.1:$PORT"
    Write-Host "  Web App: http://localhost:$PORT/"
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
        $serverPid = Start-Server
        Start-Sleep -Seconds 2
        $managerPid = Start-SessionManager
        Save-Pids -ServerPid $serverPid -ManagerPid $managerPid
        Start-Sleep -Seconds 2
        Show-Status
    }
    "restart" {
        Stop-AllServices
        Start-Sleep -Seconds 1
        $serverPid = Start-Server
        Start-Sleep -Seconds 2
        $managerPid = Start-SessionManager
        Save-Pids -ServerPid $serverPid -ManagerPid $managerPid
        Start-Sleep -Seconds 2
        Show-Status
    }
}

Write-Host ""
