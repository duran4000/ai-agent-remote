# Claude Remote Control Process Manager
# 用于安全地管理Claude Remote Control相关进程

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("list", "stop-server", "stop-manager", "stop-all", "stop-session", "status", "cleanup-lock")]
    [string]$Action,
    
    [string]$SessionId
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SERVER_DIR = Join-Path $SCRIPT_DIR "server"
$CLIENT_DIR = Join-Path $SCRIPT_DIR "client"
$SERVER_LOCK_FILE = Join-Path $SERVER_DIR "server.lock"
$MANAGER_LOCK_FILE = Join-Path $CLIENT_DIR "session-manager.lock"

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

function Get-ClaudeProcesses {
    try {
        $processes = Get-WmiObject Win32_Process | Where-Object {
            $_.Name -eq "node.exe" -and 
            $_.CommandLine -like "*ai-agent-server.js*" -or
            $_.CommandLine -like "*session-manager.js*" -or
            $_.CommandLine -like "*ai-agent-pty-wrapper.js*"
        }
        
        $result = @()
        foreach ($proc in $processes) {
            $type = "Unknown"
            if ($proc.CommandLine -like "*ai-agent-server.js*") { 
                $type = "Server" 
            } elseif ($proc.CommandLine -like "*session-manager.js*") { 
                $type = "SessionManager" 
            } elseif ($proc.CommandLine -like "*ai-agent-pty-wrapper.js*") { 
                $type = "Wrapper"
                
                if ($proc.CommandLine -match 'ai-agent-pty-wrapper\.js\s+"?([^"\s]+)"?') {
                    $sessionId = $matches[1]
                } else {
                    $sessionId = "N/A"
                }
            }
            
            $result += [PSCustomObject]@{
                ProcessId = $proc.ProcessId
                Type = $type
                CommandLine = $proc.CommandLine
                SessionId = if ($type -eq "Wrapper") { $sessionId } else { "N/A" }
                StartTime = $proc.CreationDate
            }
        }
        
        return $result
    } catch {
        Write-ColorOutput "Error getting processes: $_" "Red"
        return @()
    }
}

function Show-ProcessList {
    $processes = Get-ClaudeProcesses
    
    if ($processes.Count -eq 0) {
        Write-ColorOutput "No Claude Remote Control processes found." "Yellow"
        return
    }
    
    Write-ColorOutput "`nClaude Remote Control Processes:" "Cyan"
    Write-ColorOutput ("=" * 100) "Cyan"
    
    $processes | Format-Table -AutoSize @{
        Label="PID"; Expression={$_.ProcessId}; Width=8
    }, @{
        Label="Type"; Expression={$_.Type}; Width=15
    }, @{
        Label="Session ID"; Expression={$_.SessionId}; Width=30
    }, @{
        Label="Start Time"; Expression={$_.StartTime}; Width=20
    }, @{
        Label="Command Line"; Expression={$_.CommandLine}; Width=100
    }
    
    Write-Host ""
}

function Stop-Server {
    $processes = Get-ClaudeProcesses | Where-Object { $_.Type -eq "Server" }
    
    if ($processes.Count -eq 0) {
        Write-ColorOutput "No server process found." "Yellow"
        return
    }
    
    foreach ($proc in $processes) {
        Write-ColorOutput "Stopping server process (PID: $($proc.ProcessId))..." "Yellow"
        try {
            Stop-Process -Id $proc.ProcessId -Force
            Write-ColorOutput "Server stopped successfully." "Green"
        } catch {
            Write-ColorOutput "Failed to stop server: $_" "Red"
        }
    }
    
    Write-Host ""
    
    if (Test-Path $SERVER_LOCK_FILE) {
        try {
            Remove-Item $SERVER_LOCK_FILE -Force
            Write-ColorOutput "Removed: ${SERVER_LOCK_FILE}" "Green"
        } catch {
            Write-ColorOutput "Failed to remove ${SERVER_LOCK_FILE}: ${_}" "Red"
        }
    }
}

function Stop-SessionManager {
    $processes = Get-ClaudeProcesses | Where-Object { $_.Type -eq "SessionManager" }
    
    if ($processes.Count -eq 0) {
        Write-ColorOutput "No Session Manager process found." "Yellow"
        return
    }
    
    foreach ($proc in $processes) {
        Write-ColorOutput "Stopping Session Manager process (PID: $($proc.ProcessId))..." "Yellow"
        try {
            Stop-Process -Id $proc.ProcessId -Force
            Write-ColorOutput "Session Manager stopped successfully." "Green"
        } catch {
            Write-ColorOutput "Failed to stop Session Manager: $_" "Red"
        }
    }
    
    Write-Host ""
    
    if (Test-Path $MANAGER_LOCK_FILE) {
        try {
            Remove-Item $MANAGER_LOCK_FILE -Force
            Write-ColorOutput "Removed: ${MANAGER_LOCK_FILE}" "Green"
        } catch {
            Write-ColorOutput "Failed to remove ${MANAGER_LOCK_FILE}: ${_}" "Red"
        }
    }
}

function Stop-Session {
    param([string]$SessionId)
    
    if (-not $SessionId) {
        Write-ColorOutput "Please specify SessionId." "Red"
        return
    }
    
    $processes = Get-ClaudeProcesses | Where-Object { 
        $_.Type -eq "Wrapper" -and 
        $_.SessionId -eq $SessionId
    }
    
    if ($processes.Count -eq 0) {
        Write-ColorOutput "No wrapper process found for session: $SessionId" "Yellow"
        return
    }
    
    foreach ($proc in $processes) {
        Write-ColorOutput "Stopping wrapper for session '$SessionId' (PID: $($proc.ProcessId))..." "Yellow"
        try {
            Stop-Process -Id $proc.ProcessId -Force
            Write-ColorOutput "Wrapper stopped successfully." "Green"
        } catch {
            Write-ColorOutput "Failed to stop wrapper: $_" "Red"
        }
    }
    
    Write-Host ""
}

function Stop-AllProcesses {
    $processes = Get-ClaudeProcesses
    
    if ($processes.Count -eq 0) {
        Write-ColorOutput "No Claude Remote Control processes found." "Yellow"
        return
    }
    
    Write-ColorOutput "Stopping all Claude Remote Control processes..." "Yellow"
    
    foreach ($proc in $processes) {
        Write-ColorOutput "Stopping $($proc.Type) (PID: $($proc.ProcessId))..." "Yellow"
        try {
            Stop-Process -Id $proc.ProcessId -Force
            Write-ColorOutput "Stopped." "Green"
        } catch {
            Write-ColorOutput "Failed: $_" "Red"
        }
    }
    
    Write-ColorOutput "All processes stopped." "Green"
    Write-Host ""
    
    Write-ColorOutput "Cleaning up lock files..." "Yellow"
    
    if (Test-Path $SERVER_LOCK_FILE) {
        try {
            Remove-Item $SERVER_LOCK_FILE -Force
            Write-ColorOutput "Removed: ${SERVER_LOCK_FILE}" "Green"
        } catch {
            Write-ColorOutput "Failed to remove ${SERVER_LOCK_FILE}: ${_}" "Red"
        }
    }
    
    if (Test-Path $MANAGER_LOCK_FILE) {
        try {
            Remove-Item $MANAGER_LOCK_FILE -Force
            Write-ColorOutput "Removed: ${MANAGER_LOCK_FILE}" "Green"
        } catch {
            Write-ColorOutput "Failed to remove ${MANAGER_LOCK_FILE}: ${_}" "Red"
        }
    }
    
    Write-ColorOutput "Lock file cleanup completed." "Green"
}

function Show-Status {
    Write-ColorOutput "`nClaude Remote Control Status:" "Cyan"
    Write-ColorOutput ("=" * 50) "Cyan"
    
    $processes = Get-ClaudeProcesses
    
    $serverCount = ($processes | Where-Object { $_.Type -eq "Server" }).Count
    $managerCount = ($processes | Where-Object { $_.Type -eq "SessionManager" }).Count
    $wrapperCount = ($processes | Where-Object { $_.Type -eq "Wrapper" }).Count
    
    Write-ColorOutput "Server: " "White" -NoNewline
    if ($serverCount -gt 0) {
        Write-ColorOutput "Running ($serverCount process(es))" "Green"
    } else {
        Write-ColorOutput "Stopped" "Red"
    }
    
    Write-ColorOutput "Session Manager: " "White" -NoNewline
    if ($managerCount -gt 0) {
        Write-ColorOutput "Running ($managerCount process(es))" "Green"
    } else {
        Write-ColorOutput "Stopped" "Red"
    }
    
    Write-ColorOutput "Wrapper Processes: " "White" -NoNewline
    if ($wrapperCount -gt 0) {
        Write-ColorOutput "Running ($wrapperCount process(es))" "Green"
    } else {
        Write-ColorOutput "Stopped" "Red"
    }
    
    Write-Host ""
    
    $serverLockExists = Test-Path $SERVER_LOCK_FILE
    $managerLockExists = Test-Path $MANAGER_LOCK_FILE
    
    Write-ColorOutput "Server Lock File: " "White" -NoNewline
    if ($serverLockExists) {
        Write-ColorOutput "Exists" "Yellow"
    } else {
        Write-ColorOutput "Not exists" "Green"
    }
    
    Write-ColorOutput "Manager Lock File: " "White" -NoNewline
    if ($managerLockExists) {
        Write-ColorOutput "Exists" "Yellow"
    } else {
        Write-ColorOutput "Not exists" "Green"
    }
    
    Write-Host ""
}

function Cleanup-LockFiles {
    Write-ColorOutput "`nCleaning up lock files..." "Yellow"
    
    $removed = $false
    
    if (Test-Path $SERVER_LOCK_FILE) {
        try {
            Remove-Item $SERVER_LOCK_FILE -Force
            Write-ColorOutput "Removed: ${SERVER_LOCK_FILE}" "Green"
            $removed = $true
        } catch {
            $err = $_.ToString()
            Write-ColorOutput "Failed to remove ${SERVER_LOCK_FILE}: ${err}" "Red"
        }
    } else {
        Write-ColorOutput "Server lock file not found." "Yellow"
    }
    
    if (Test-Path $MANAGER_LOCK_FILE) {
        try {
            Remove-Item $MANAGER_LOCK_FILE -Force
            Write-ColorOutput "Removed: ${MANAGER_LOCK_FILE}" "Green"
            $removed = $true
        } catch {
            $err = $_.ToString()
            Write-ColorOutput "Failed to remove ${MANAGER_LOCK_FILE}: ${err}" "Red"
        }
    } else {
        Write-ColorOutput "Manager lock file not found." "Yellow"
    }
    
    if (-not $removed) {
        Write-ColorOutput "No lock files to remove." "Yellow"
    } else {
        Write-ColorOutput "Lock file cleanup completed." "Green"
    }
    
    Write-Host ""
}

switch ($Action) {
    "list" {
        Show-ProcessList
    }
    "stop-server" {
        Stop-Server
    }
    "stop-manager" {
        Stop-SessionManager
    }
    "stop-session" {
        Stop-Session -SessionId $SessionId
    }
    "stop-all" {
        Stop-AllProcesses
    }
    "status" {
        Show-Status
    }
    "cleanup-lock" {
        Cleanup-LockFiles
    }
    default {
        Write-ColorOutput "Unknown action: $Action" "Red"
        exit 1
    }
}