# Windows 安装指南

## 前置要求

- Node.js 18+ （[下载地址](https://nodejs.org/)）
- PowerShell 5.1+

## 快速安装

### 方式一：一键安装（推荐）

1. 双击运行 `install.ps1`
   - 如果无法运行，右键 -> 使用 PowerShell 运行

2. 编辑 `config.json`，设置 Token 和密码：
   ```json
   {
     "server": {
       "token": "你的Token",
       "authPassword": "你的密码"
     }
   }
   ```

3. 双击运行 `start.bat` 启动服务

4. 浏览器访问 `http://localhost:65436`

### 方式二：命令行安装

```powershell
# 1. 安装依赖
./install.ps1

# 2. 配置（首次运行）
cp config.example.json config.json
notepad config.json

# 3. 启动服务
./start.bat
```

## 服务管理

```powershell
# 启动（生产模式，后台隐藏窗口）
./start.bat

# 启动（开发模式，显示窗口，方便调试）
./ai-agent-remote.ps1 start dev

# 停止服务
./ai-agent-remote.ps1 stop

# 重启服务
./ai-agent-remote.ps1 restart
```

**模式说明**：
- `prod` 模式：后台运行，无窗口，日志写入 `logs/` 目录
- `dev` 模式：显示窗口，方便查看实时输出和调试

## 常见问题

### 无法运行 PowerShell 脚本

```powershell
# 临时允许脚本执行
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### node-pty 编译失败

确保已安装 Visual Studio Build Tools：
```powershell
npm install -g windows-build-tools
```

### 端口被占用

检查并结束占用端口的进程：
```powershell
netstat -ano | findstr :65436
taskkill /PID <进程ID> /F
```
