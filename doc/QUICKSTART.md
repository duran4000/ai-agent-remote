# 快速开始指南

本指南帮助您在 5 分钟内完成项目部署和配置。

> **⚠️ 重要提示**：本文档中的服务器 IP 地址和密码已脱敏处理，发布前请根据实际情况替换。

> **📖 详细配置说明**：查看 [CONFIGURATION.md](CONFIGURATION.md) 了解如何配置所有占位符。

## 前提条件

- Windows 10/11 桌面电脑
- 手机或平板（iOS/Android）
- 稳定的网络连接

---

## 第一步：搭建 P2P 网络（2分钟）

> **详细步骤**：请参考 [P2P网络搭建部署指南.md](P2P网络搭建部署指南.md)

### 桌面端

1. **下载并安装 Tailscale**
   - 访问：https://tailscale.com/download
   - 下载并安装 Windows 版本

2. **配置连接到自建 Headscale 服务器**
   ```powershell
   cd e:\MyCode\python\ai-agent-remote
   .\scripts\configure-tailscale.ps1
   ```
   或手动配置：
   ```powershell
   # 以管理员身份运行
   Stop-Service -Name "Tailscale" -Force
   Set-ItemProperty -Path "HKLM:\SOFTWARE\Tailscale" -Name "ControlURL" -Value "https://YOUR_SERVER_IP:65437"
   Start-Service -Name "Tailscale"
   ```

3. **连接到 Headscale 网络**
   - 点击系统托盘中的 Tailscale 图标
   - 选择 "Log in..."
   - 浏览器会自动打开：https://YOUR_SERVER_IP:65437
   - 注册账号并登录

4. **获取 Tailscale IP**
   ```cmd
   tailscale ip -4
   ```
   记录显示的 IP 地址（如：100.64.0.1）

### 手机端

1. **安装 Tailscale App**
   - iOS：App Store 搜索 "Tailscale"
   - Android：Google Play 搜索 "Tailscale"

2. **配置 Headscale 服务器地址**
   - 打开 Tailscale App
   - 点击右上角设置图标
   - 在"Control Server"中输入：`https://YOUR_SERVER_IP:65437`

3. **登录**
   - 使用与桌面端相同的账号登录

---

## 第二步：启动服务（1分钟）

### 启动 Web Server

```powershell
cd e:\MyCode\python\ai-agent-remote\server
.\start-server.bat
```

**预期输出**：
```
[Server] Claude Remote Control Server
[Server] Running at http://0.0.0.0:9527
[Server] WebSocket: ws://0.0.0.0:9527
[Server] Web App: http://0.0.0.0:9527/app
[Server] Tailscale IP: 100.64.x.x
[Server] P2P Access: http://100.64.x.x:9527/app
```

### 启动 Session Manager

```powershell
cd e:\MyCode\python\ai-agent-remote\client
.\session-manager.bat
```

**注意**：Session Manager 必须在独立的 PowerShell 窗口中运行，不能在 IDE 的终端中运行。

---

## 第三步：连接手机（2分钟）

### 访问 Web App

在手机浏览器中访问以下地址之一：

**P2P 直连模式**（推荐）：
```
http://<桌面端Tailscale IP>:9527/app
```

**局域网模式**（备用）：
```
http://<桌面端局域网IP>:9527/app
```

### 配置连接

1. **服务器地址**：`ws://<桌面端Tailscale IP>:9527`
2. **认证 Token**：`YOUR_AUTH_TOKEN`（在 config.json 中设置）
3. **工作目录**：如 `E:/MyCode/python/my-project`
4. **AI Agent**：选择您要使用的 AI 工具（Claude、Qwen、Gemini 等）

### 点击连接

点击"连接"按钮，等待连接成功。

---

## 验证连接

连接成功后，您应该看到：

1. **终端界面**：显示 AI Agent 的欢迎信息
2. **状态栏**：显示"已连接 (P2P直连)"
3. **可以输入命令**：在终端中输入命令并看到响应

---

## 常用快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+C | 中断当前命令 |
| Ctrl+L | 清屏 |
| Ctrl+D | 退出当前会话 |
| Tab | 自动补全 |
| ↑/↓ | 浏览历史命令 |

---

## 常见问题

### Q1: 连接失败？

**解决方案**：
1. 确认桌面端和手机端都连接到 Tailscale
2. 检查防火墙是否允许端口 9527
3. 尝试使用局域网 IP 连接

### Q2: 终端无响应？

**解决方案**：
1. 检查 Session Manager 是否正在运行
2. 查看日志：`type %TEMP%\session-manager.log`
3. 重启 Session Manager

### Q3: 如何停止服务？

**解决方案**：
```powershell
# 停止所有服务
cd e:\MyCode\python\ai-agent-remote
.\scripts\manage-processes.ps1 -Action stop-all
```

---

## 下一步

- 查看详细文档：[doc/DEVELOP.md](DEVELOP.md)
- 了解网络架构：[doc/NETWORK_PLAN.md](NETWORK_PLAN.md)
- 故障排查指南：[doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 管理命令

```powershell
# 查看进程状态
.\scripts\manage-processes.ps1 -Action list

# 重启服务
.\scripts\restart-services.ps1

# 查看日志
.\scripts\check-logs.bat

# 诊断问题
.\scripts\diagnose-tailscale.bat
```

---

**文档版本：** 1.0
**最后更新：** 2026-03-13
