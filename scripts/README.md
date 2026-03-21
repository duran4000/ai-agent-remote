# 管理脚本说明

本目录包含项目管理和维护相关的脚本。

## 脚本列表

### check-logs.bat
查看系统日志文件。

**用途**：快速查看服务器和Session Manager的日志输出。

**使用方法**：
```powershell
.\check-logs.bat
```

---

### clean-reset.bat
清理系统并重置状态。

**用途**：清理lock文件、临时文件，重置系统状态。

**使用方法**：
```powershell
.\clean-reset.bat
```

---

### fix-network-stack.bat
修复网络栈问题。

**用途**：重置网络适配器和DNS缓存，解决网络连接问题。

**使用方法**：
```powershell
.\fix-network-stack.bat
```

---

### manage-processes.ps1
进程管理工具。

**用途**：统一管理服务器和Session Manager进程。

**使用方法**：
```powershell
# 查看所有进程
.\manage-processes.ps1 -Action list

# 停止所有进程
.\manage-processes.ps1 -Action stop-all

# 停止服务器
.\manage-processes.ps1 -Action stop-server

# 停止Session Manager
.\manage-processes.ps1 -Action stop-manager

# 查看系统状态
.\manage-processes.ps1 -Action status

# 清理lock文件
.\manage-processes.ps1 -Action cleanup-lock
```

---

### restart-services.ps1
重启相关服务。

**用途**：重启Web服务器。

**使用方法**：
```powershell
.\restart-services.ps1
```

---

## 使用建议

1. **日常维护**：使用 `manage-processes.ps1` 进行进程管理
2. **网络问题**：使用 `fix-network-stack.bat` 修复网络
3. **查看日志**：使用 `check-logs.bat` 查看运行日志

## 注意事项

- 所有脚本都需要管理员权限运行
- 部分脚本会重启服务，请确保保存工作
- 重置操作会清除配置，请谨慎使用
