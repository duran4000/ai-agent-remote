@echo off
chcp 65001 >nul
echo ========================================
echo Fix Windows Network Stack
echo ========================================
echo.
echo This will reset network stack
echo WARNING: This may temporarily disrupt network connectivity
echo.
pause

echo.
echo [1/3] Stopping services...
cd /d "%~dp0.."
.\scripts\manage-processes.ps1 -Action stop-all
timeout /t 3
echo OK
echo.
pause

echo.
echo [2/3] Resetting Windows TCP/IP stack...
echo This may take a while...
netsh int ip reset
echo.
echo Flushing DNS...
ipconfig /flushdns
echo OK
echo.
pause

echo.
echo [3/3] Restarting computer is REQUIRED!
echo.
echo Please save your work and restart your computer.
echo.
choice /C YN /M "Restart now?" /T 30 /D Y
if %errorLevel% equ 2 (
    echo Restart cancelled. Please restart manually.
) else (
    echo Restarting in 10 seconds...
    timeout /t 10
    shutdown /r /t 10
)
echo.
pause
