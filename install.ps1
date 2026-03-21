# Claude Remote Control - Windows 安装脚本
# 用法: 右键 -> 使用 PowerShell 运行
# 或在 PowerShell 中执行: ./install.ps1

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SERVER_DIR = Join-Path $SCRIPT_DIR "server"
$CLIENT_DIR = Join-Path $SCRIPT_DIR "client"
$CONFIG_FILE = Join-Path $SCRIPT_DIR "config.json"
$CONFIG_EXAMPLE = Join-Path $SCRIPT_DIR "config.example.json"

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

Write-Host "========================================" -ForegroundColor Green
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Edit config.json (set token and password)" -ForegroundColor White
Write-Host "  2. Run start.bat to start services" -ForegroundColor White
Write-Host "  3. Open http://localhost:9527 in browser" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"
