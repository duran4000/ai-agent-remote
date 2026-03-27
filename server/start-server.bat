@echo off
cd /d "%~dp0"

echo ========================================
echo Claude Remote Control Server
echo ========================================
echo.

REM 从 config.json 读取端口
for /f "delims=" %%i in ('node -e "try{console.log(require('../config.json').server.port||41491)}catch(e){console.log(41491)}"') do set PORT=%%i

echo [1/3] Checking if port %PORT% is already in use...
netstat -ano | findstr ":%PORT%" >nul
if %errorlevel% equ 0 (
    echo.
    echo [WARNING] Port %PORT% is already in use!
    echo.
    echo Finding the process using port %PORT%...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%"') do (
        set PID=%%a
        goto :found_pid
    )
    :found_pid
    echo.
    echo Process ID: %PID%
    echo.
    echo Process details:
    wmic process where "ProcessId=%PID%" get ProcessId,CommandLine,ExecutablePath /format:list 2>nul
    echo.
    set /p KILL_PROCESS="Do you want to kill this process? (Y/N): "
    if /i "%KILL_PROCESS%"=="Y" (
        echo.
        echo Killing process %PID%...
        taskkill /F /PID %PID% >nul 2>&1
        if %errorlevel% equ 0 (
            echo [SUCCESS] Process %PID% has been killed.
        ) else (
            echo [ERROR] Failed to kill process %PID%. Please check permissions.
            pause
            exit /b 1
        )
    ) else (
        echo.
        echo [CANCELLED] Please stop the process manually and try again.
        pause
        exit /b 1
    )
) else (
    echo [OK] Port %PORT% is available.
)

echo.
echo [2/3] Starting server...
node ai-agent-server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server failed to start. Check the error messages above.
    pause
    exit /b 1
)

echo.
echo [3/3] Server started successfully.
echo.
pause
