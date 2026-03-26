# Claude Remote Control - Windows 安装脚本
# 用法: 右键 -> 使用 PowerShell 运行
# 或在 PowerShell 中执行: ./install.ps1

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SERVER_DIR = Join-Path $SCRIPT_DIR "server"
$CLIENT_DIR = Join-Path $SCRIPT_DIR "client"
$CONFIG_FILE = Join-Path $SCRIPT_DIR "config.json"
$CONFIG_EXAMPLE = Join-Path $SCRIPT_DIR "config.example.json"

# 从 config.json 读取端口（如果存在）
if (Test-Path $CONFIG_FILE) {
    $Config = Get-Content $CONFIG_FILE | ConvertFrom-Json
    $PORT = $Config.server.port
} else {
    $PORT = 41491  # 默认端口
}

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

function Check-NodeJS {
    Write-Log "Checking Node.js..." "Cyan"
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodePath) {
        Write-Log "ERROR: Node.js not found!" "Red"
        Write-Log "Please install Node.js from https://nodejs.org/" "Yellow"
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }

    $nodeVersion = node -v
    Write-Log "Node.js found: $nodeVersion at $nodePath" "Green"
}

function Install-Dependencies {
    Write-Log "Installing dependencies..." "Cyan"

    # 安装 server 依赖
    Write-Log "Installing server dependencies..." "Yellow"
    Push-Location $SERVER_DIR
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ERROR: Failed to install server dependencies" "Red"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Log "Server dependencies installed" "Green"

    # 安装 client 依赖
    Write-Log "Installing client dependencies..." "Yellow"
    Push-Location $CLIENT_DIR
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ERROR: Failed to install client dependencies" "Red"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Log "Client dependencies installed" "Green"
}

function Setup-Config {
    Write-Log "Setting up configuration..." "Cyan"

    if (Test-Path $CONFIG_FILE) {
        Write-Log "config.json already exists" "Green"
        return
    }

    if (Test-Path $CONFIG_EXAMPLE) {
        Copy-Item $CONFIG_EXAMPLE $CONFIG_FILE
        Write-Log "Created config.json from config.example.json" "Green"
        Write-Log "Please edit config.json and set your token and password" "Yellow"
    } else {
        Write-Log "WARNING: config.example.json not found" "Yellow"
    }
}

function Install-ScheduledTask {
    $TASK_NAME = "ClaudeRemoteControl"
    $BAT_PATH = Join-Path $SCRIPT_DIR "start.bat"

    Write-Log "Setting up scheduled task..." "Cyan"

    # 检查管理员权限，不足则自动提权
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Log "需要管理员权限来注册计划任务，正在提权..." "Yellow"
        try {
            Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"
                Unregister-ScheduledTask -TaskName '$TASK_NAME' -Confirm:`$false -ErrorAction SilentlyContinue
                schtasks /Create /TN '$TASK_NAME' /TR 'cmd.exe /c \`"$BAT_PATH\`"' /SC ONLOGON /RL HIGHEST /F
            `""
            $verify = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
            if ($verify) {
                Write-Log "Scheduled task '$TASK_NAME' registered (runs at user logon)" "Green"
            } else {
                Write-Log "WARNING: Failed to register scheduled task" "Red"
            }
        } catch {
            Write-Log "WARNING: UAC elevation was denied, task not registered" "Red"
        }
        return
    }

    # 管理员权限下直接注册
    $existing = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Log "Scheduled task '$TASK_NAME' already exists, updating..." "Yellow"
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    }

    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $action = New-ScheduledTaskAction `
        -Execute "cmd.exe" `
        -Argument "/c `"$BAT_PATH`"" `
        -WorkingDirectory $SCRIPT_DIR
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Days 0)

    Register-ScheduledTask `
        -TaskName $TASK_NAME `
        -Trigger $trigger `
        -Action $action `
        -Settings $settings `
        -Description "Auto-start Claude Remote Control at user logon" `
        -Force | Out-Null

    Write-Log "Scheduled task '$TASK_NAME' registered (runs at user logon)" "Green"
}

# 主流程
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Claude Remote Control - Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Check-NodeJS
Write-Host ""

Install-Dependencies
Write-Host ""

Setup-Config
Write-Host ""

Install-ScheduledTask
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Edit config.json (set token and password)" -ForegroundColor White
Write-Host "  2. Run start.bat to start services" -ForegroundColor White
Write-Host "  3. Open http://localhost:$PORT in browser" -ForegroundColor White
Write-Host "  4. Services will auto-start on next user login" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"
