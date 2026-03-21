@echo off
chcp 65001 >nul
echo ========================================
echo Check System Log Files
echo ========================================
echo.

set "LOG_DIR=%TEMP%"
if exist "%LOG_DIR%" (
    echo Log directory exists: %LOG_DIR%
    echo.
) else (
    echo Log directory does not exist
)

echo Checking session-manager.log...
if exist "%TEMP%\session-manager.log" (
    echo.
    echo ========================================
    echo session-manager.log (last 50 lines)
    echo ========================================
    powershell -Command "Get-Content '%TEMP%\session-manager.log' -Tail 50"
    echo.
    pause
) else (
    echo session-manager.log not found
)

echo.
echo Checking server log...
if exist "%TEMP%\server.log" (
    echo.
    echo ========================================
    echo server.log (last 50 lines)
    echo ========================================
    powershell -Command "Get-Content '%TEMP%\server.log' -Tail 50"
    echo.
    pause
) else (
    echo server.log not found
)

echo.
echo ========================================
echo Log check complete!
echo ========================================
pause
