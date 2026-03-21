@echo off
chcp 65001 >nul
echo ========================================
echo Clean Reset System State
echo ========================================
echo.

echo [1/4] Checking admin privileges...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Administrator privileges required
    pause
    exit /b 1
)
echo OK
echo.
pause

echo.
echo [2/4] Stopping services...
cd /d "%~dp0.."
.\scripts\manage-processes.ps1 -Action stop-all
timeout /t 3
echo OK
echo.
pause

echo.
echo [3/4] Cleaning lock files...
if exist "server\.lock" del /f /q "server\.lock"
if exist "client\.lock" del /f /q "client\.lock"
if exist "server\pid.txt" del /f /q "server\pid.txt"
if exist "client\pid.txt" del /f /q "client\pid.txt"
echo OK
echo.
pause

echo.
echo [4/4] Cleaning temporary files...
if exist "%TEMP%\session-manager.log" del /f /q "%TEMP%\session-manager.log"
if exist "%TEMP%\server.log" del /f /q "%TEMP%\server.log"
echo OK
echo.
pause

echo.
echo ========================================
echo Clean reset complete!
echo ========================================
echo.
echo You can now restart the services.
echo.
pause
