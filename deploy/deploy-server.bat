@echo off
REM 部署 server 到远程服务器
REM 用法: deploy-server.bat

setlocal enabledelayedexpansion

REM 读取 .env 文件
if exist "%~dp0.env" (
    for /f "tokens=1,2 delims==" %%a in (%~dp0.env) do (
        set %%a=%%b
    )
) else (
    echo 错误: 找不到 .env 文件
    echo 请复制 .env.example 为 .env 并填入实际凭证
    pause
    exit /b 1
)

set SERVER=%SERVER_USER%@%SERVER_HOST%
set REMOTE_DIR=%SERVER_PATH%/server
set LOCAL_DIR=server

echo 开始部署 server...

REM 删除远程旧的 server 目录
echo 删除旧的 server 目录...
wsl sshpass -p "%SERVER_PASSWORD%" ssh %SERVER% "rm -rf %REMOTE_DIR%"

REM 创建远程目录
echo 创建远程目录...
wsl sshpass -p "%SERVER_PASSWORD%" ssh %SERVER% "mkdir -p %REMOTE_DIR%/webapp/css"
wsl sshpass -p "%SERVER_PASSWORD%" ssh %SERVER% "mkdir -p %REMOTE_DIR%/webapp/js"
wsl sshpass -p "%SERVER_PASSWORD%" ssh %SERVER% "mkdir -p %REMOTE_DIR%/../utils"

REM 部署服务器主程序
echo 部署 claude-remote-server.js...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/claude-remote-server.js %SERVER%:%REMOTE_DIR%/

REM 部署配置加载工具
echo 部署 config-loader.js...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/utils/config-loader.js %SERVER%:%REMOTE_DIR%/../utils/

REM 部署统一配置文件
echo 部署 config.json...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/config.json %SERVER%:%REMOTE_DIR%/../

REM 部署工具函数
echo 部署 utils.js...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/utils.js %SERVER%:%REMOTE_DIR%/

REM 部署 package.json
echo 部署 package.json...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/package.json %SERVER%:%REMOTE_DIR%/

REM 部署 package-lock.json
echo 部署 package-lock.json...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/package-lock.json %SERVER%:%REMOTE_DIR%/

REM 部署Web App
echo 部署 Web App...
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/webapp/index.html %SERVER%:%REMOTE_DIR%/webapp/
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/webapp/css/*.css %SERVER%:%REMOTE_DIR%/webapp/css/
wsl sshpass -p "%SERVER_PASSWORD%" scp %LOCAL_PROJECT_PATH%/%LOCAL_DIR%/webapp/js/*.js %SERVER%:%REMOTE_DIR%/webapp/js/

echo 部署完成！
echo.
echo 请在服务器上执行以下命令：
echo   1. SSH登录: wsl sshpass -p "%SERVER_PASSWORD%" ssh %SERVER%
echo   2. 进入目录: cd %REMOTE_DIR%
echo   3. 安装依赖: npm install
echo   4. 启动服务: pm2 start claude-remote-server.js --name %PM2_APP_NAME%
echo   5. 查看日志: pm2 logs %PM2_APP_NAME%

pause
