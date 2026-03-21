# 故障排查指南

本文档收集了项目开发和运行过程中遇到的常见问题及解决方案。

## 目录

- [连接问题](#连接问题)
- [显示问题](#显示问题)
- [进程问题](#进程问题)
- [配置问题](#配置问题)
- [网络问题](#网络问题)

---

## 连接问题

### 1. 多客户端布局同步问题 (v1.6.0)

**问题**: 移动端和原生Claude端的输出会相互影响对方布局，导致显示混乱。

**解决方案**: 蒙板激活机制
- 当前激活的客户端正常显示
- 非激活客户端显示半透明蒙板，遮挡混乱布局
- 双击蒙板激活当前客户端
- 激活后自动执行终端尺寸调整

**实现要点**:
- 服务器维护 activeDevice 状态
- 激活设备变化时，向其他设备发送 showOverlay 消息
- 客户端双击蒙板后发送 active 消息切换激活设备

---

### 2. 多客户端Resize冲突 (v1.4.0)

**问题**: 原生Claude窗口和手机浏览器的resize会相互影响对方显示。

**客户端类型**:
- **desktop**: 电脑上的原生 Claude/Qwen CLI 窗口（通过 PTY Wrapper 连接）
- **mobile**: 手机浏览器上的 Web App

**解决方案**:
- 手机端resize → 转发给原生Claude窗口
- 原生Claude窗口resize → 不转发给手机端
- 原生窗口resize时仍发送输出给手机端（服务器原样转发）

---

### 3. OpenCode终端转义序列过滤 (v1.8.0)

**问题**: OpenCode AI Agent在移动端无法保持激活状态，点击激活后立即被原生wrapper抢占。

**原因分析**:
OpenCode启动时会发送大量终端控制序列（终端能力查询响应），这些序列被误认为是用户输入，触发native wrapper发送`showOverlay`消息抢占移动端激活状态。

**涉及的转义序列类型**:

| 类型 | 格式 | 示例 | 说明 |
|------|------|------|------|
| 焦点事件 | `\x1b[O` / `\x1b[I` | `\x1b[O` | 终端失去/获得焦点 |
| 鼠标事件 | `\x1b[<...M/m` | `\x1b[<35;53;14M` | 鼠标点击/释放 |
| DECRPM | `\x1b[?...$y` | `\x1b[?1016;2$y` | 设备属性响应模式 |
| DA响应 | `\x1b[>...c` | `\x1b[>65;0c` | 设备属性响应 |
| CPR响应 | `\x1b[...R` | `\x1b[1;1R` | 光标位置报告 |
| OSC | `\x1b]...\x07` 或 `\x1b]...\x1b\\` | `\x1b]4;0;rgb:...\x1b\\` | 操作系统命令 |
| APC | `\x1b_...\x1b\\` | - | 应用程序命令 |
| DCS | `\x1bP...\x1b\\` | - | 设备控制字符串 |
| 窗口大小 | `\x1b[...t` | `\x1b[14t` | 窗口大小报告 |

**解决方案**:
在客户端和服务端都添加转义序列过滤，但**仅对OpenCode生效**，避免影响其他AI Agent（Claude、Qwen、Gemini）的正常行为。

**修改的文件**:

1. `server/webapp/js/terminal.js`:
```javascript
isFocusEventSequence(data) {
  // 基础过滤（所有AI Agent）
  if (data === '\x1b[O' || data === '\x1b[I') return true;
  if (/^\x1b\[\d*[OI]$/.test(data)) return true;
  if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data)) return true;
  
  // OpenCode专用过滤
  if (this.aiAgent === 'opencode') {
    if (/^\x1b\[\?\d+(;\d+)*\$y$/.test(data)) return true;
    if (/^\x1b\[>\d+(;\d+)*c$/.test(data)) return true;
    if (/^\x1b\[\d+;\d+R$/.test(data)) return true;
    if (/^\x1b\][^\x07\x1b]*(\x07|\x1b\\)$/.test(data)) return true;
    if (/^\x1b_[^\x1b]*\x1b\\$/.test(data)) return true;
    if (/^\x1bP[\x20-\x7e]*\x1b\\$/.test(data)) return true;
    if (/^\x1b\[\d+(;\d+)*t$/.test(data)) return true;
  }
  return false;
}

setAIAgent(aiAgent) {
  this.aiAgent = aiAgent;
}
```

2. `server/webapp/js/app.js`:
```javascript
// 连接时设置AI Agent
this.terminal.setAIAgent(aiAgent);
```

3. `client/claude-pty-wrapper.js`:
```javascript
isFocusEventSequence(data) {
  // 基础过滤（所有AI Agent）
  // ...
  
  // OpenCode专用过滤
  const aiAgent = this.config.aiAgent || 'claude';
  if (aiAgent === 'opencode') {
    // 扩展过滤逻辑
  }
  return false;
}
```

**设计原则**:
- 保持向后兼容，不影响现有AI Agent的行为
- 使用条件判断，只对特定AI Agent应用扩展过滤
- 过滤逻辑集中在`isFocusEventSequence`方法中，便于维护

---

### 4. Wrapper关闭时标签页状态未更新

**问题**: 强制终止wrapper进程后，网页仍显示"已连接"。

**原因**:
1. sessionId格式不一致（重复前缀）
2. status消息未包含sessionId
3. 服务器未处理manager类型的status消息

**修复**:
- 统一sessionId格式
- status消息包含sessionId
- 服务器正确转发manager的disconnected消息

---

### 5. 新建标签时旧标签标题变化问题 (v1.8.0)

**问题**: 当勾选"新建标签"选项时，在设置面板中更改AI Agent或工作目录会更新当前标签的标题，而不是只在点击"连接"后创建新标签。

**原因分析**:
设置面板的`change`事件监听器会调用`updateCurrentTab()`方法，该方法会更新当前标签的属性和名称。但用户期望的是只有在点击"连接"按钮后才创建新标签，在设置面板中更改时不应该影响当前标签。

**解决方案**:
在设置面板的`change`事件监听器中添加条件判断，只有当"新建标签"未勾选时才更新当前标签。

**修改的文件**: `server/webapp/js/app.js`

```javascript
// 修改前
this.elements.aiAgent.addEventListener('change', () => {
  this.saveSettings();
  this.updateCurrentTab();
});

// 修改后
this.elements.aiAgent.addEventListener('change', () => {
  this.saveSettings();
  if (!this.elements.newTabCheckbox.checked) {
    this.updateCurrentTab();
  }
});
```

同样应用于其他设置项：
- 服务器地址
- 认证Token
- 工作目录
- AI Agent

**实现要点**:
- 保持向后兼容，不影响现有行为
- 使用`newTabCheckbox.checked`判断是否要创建新标签
- 只在非新建标签模式下更新当前标签

---

## 显示问题

### 6. 手机端点击快捷按钮弹出输入法

**问题**: 在手机上使用快捷按钮时，点击后会自动弹出输入法键盘。

**原因分析**:
1. xterm.js 的终端元素是 `<textarea>`
2. 点击按钮时，虽然代码调用了 `terminal.element.blur()`，但点击事件本身会让焦点重新回到终端
3. 终端获得焦点后，手机浏览器认为需要显示输入法键盘

**测试过程**:
1. 创建测试页面，对比多种 blur 方案：
   - 直接 blur: 无效，焦点仍在 textarea
   - focus + blur: 有效，不会弹出键盘
   - body.focus(): 无效
2. 发现使用隐藏的 input 元素先 focus 再 blur 可以阻止键盘弹出

**解决方案**:
1. 在页面添加隐藏的 input 元素：
```html
<input type="text" id="blur-target" style="position: absolute; left: -9999px; opacity: 0; width: 1px; height: 1px;">
```

2. 点击快捷按钮时执行：
```javascript
const blurTarget = document.getElementById('blur-target');
if (blurTarget) {
  blurTarget.focus();
  blurTarget.blur();
}
```

**实现要点**:
- 使用 pointerdown 事件 + preventDefault 阻止默认聚焦行为
- 先让隐藏 input 获得焦点，再立即让它失去焦点
- 终端从未获得焦点，手机不会弹出输入法键盘
- 删除连接后自动 focus 终端的代码（避免键盘弹出）

---

### 7. 连接后终端无内容显示

**问题**: 修复快捷按钮问题后，连接成功但终端不显示内容。

**原因**: HTML 中 blur-target 元素没有正确闭合，导致后续的 terminal-container 元素结构被破坏。

**修复**: 确保 input 元素正确闭合。

---

## 进程问题

### 8. Session Manager双进程问题

**问题**: 重启服务时出现两个Session Manager进程。

**原因分析**:
- 使用 `cmd.exe /c` 启动时，进程枚举时序问题
- 进程未完全退出就启动新进程

**解决方案**:
- 改用 `Start-Process` 直接调用 node.exe
- 停止进程后等待2秒确保完全退出
- 启动后等待锁文件创建完成再继续
- 添加已有进程检查，避免重复启动

---

### 9. Windows下Wrapper窗口启动问题

**问题**: 在Windows下，Session Manager启动wrapper时，wrapper窗口无法正常弹出或立即退出。

**原因分析**:
1. 使用PowerShell的`Start-Process`命令时，参数传递和引号处理复杂
2. 使用`cmd.exe /c`直接执行时，stdio管道配置不当导致进程无法正常运行
3. node-pty需要正确的TTY环境才能启动PTY进程

**错误尝试**:
1. PowerShell `Start-Process` - 参数引号嵌套问题
2. `cmd.exe /c "node ..."` - stdio配置问题
3. 直接spawn node进程 - 无法创建独立窗口

**正确方案**:
使用Windows的`start`命令配合`shell: true`选项：

```javascript
if (isWindows) {
  const windowTitle = `"${aiAgent.toUpperCase()}"`;
  spawnArgs = [
    'start',
    windowTitle,
    '/wait',
    'node',
    wrapperPath,
    '--server', this.config.serverUrl,
    '--token', this.config.token,
    '--session', normalizedSessionId,
    '--device-id', `wrapper-${aiAgent}-${normalizedSessionId}`,
    '--claude-path', claudePath,
    '--ai-model', aiAgent
  ];
  
  spawnOptions = {
    cwd: workDir,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: false,
    shell: true  // 关键：使用shell执行start命令
  };
}

const wrapper = spawn(spawnArgs[0], spawnArgs.slice(1), spawnOptions);
```

**关键点**:
1. `start`命令创建独立窗口
2. `/wait`参数让父进程等待（可选）
3. `shell: true`让spawn通过cmd.exe执行start命令
4. `stdio: ['ignore', 'pipe', 'pipe']`允许捕获输出但忽略输入
5. `detached: true`让wrapper独立于父进程运行

---

## 配置问题

### 10. 端口与配置

**问题**: 端口配置混乱，文档中同时出现 10010 和 41491。

**解决方案**:
- 统一使用端口 41491
- 监听地址: 0.0.0.0（允许局域网访问）
- 统一配置管理: 根目录 config.json

---

## 网络问题

### 11. 移动端连接时PTY尺寸不匹配问题

**问题**: 移动端连接wrapper后，终端显示布局混乱，PTY使用默认尺寸(120x40)而非移动端尺寸。

**原因分析**:
1. 移动端发送resize消息时，wrapper可能还没完成认证注册
2. wrapper启动后等待500ms，没收到resize就用默认尺寸启动PTY
3. 服务器端收到resize时，如果desktop还没连接，消息就被丢弃了

**解决方案**:
在服务器端添加`pendingResize`缓存机制：

```javascript
// 1. session添加pendingResize字段
function createSession(sessionId = null) {
  const session = {
    // ...
    pendingResize: null  // 缓存mobile发来的resize消息
  };
  return session;
}

// 2. 收到mobile的resize时缓存
if (message.type === 'resize') {
  if (session.desktops.size === 0) {
    session.pendingResize = message.data;
  } else {
    // 转发给desktop
    session.desktops.forEach(desktop => {
      desktop.send(JSON.stringify(message));
    });
  }
}

// 3. desktop连接时发送缓存的resize
function handleDesktopConnection(ws, sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.pendingResize) {
    const resizeMsg = {
      type: 'resize',
      sessionId,
      data: session.pendingResize
    };
    ws.send(JSON.stringify(resizeMsg));
    session.pendingResize = null;
  }
}
```

---

## 调试工具

### 查看日志

```powershell
# 查看服务器日志
type %TEMP%\claude-remote-server.log

# 查看Session Manager日志
type %TEMP%\session-manager.log
```

### 检查进程

```powershell
# 查看所有node进程
tasklist | findstr node

# 查看特定进程
tasklist | findstr "claude-remote"
```

### 检查端口

```powershell
# 检查端口监听
netstat -an | findstr 41491
```

### 网络诊断

```powershell
# 测试本地连接
curl http://localhost:41491/api/network-info
```

---

## 常用修复命令

```powershell
# 修复网络栈问题
.\scripts\fix-network-stack.bat

# 清理重置
.\scripts\clean-reset.bat

# 重启服务
.\scripts\restart-services.ps1
```

---

## 获取帮助

如果以上解决方案无法解决您的问题，请：

1. 查看日志文件获取详细错误信息
2. 查看相关文档：
   - [doc/DEVELOP.md](DEVELOP.md) - 开发文档
   - [doc/QUICKSTART.md](QUICKSTART.md) - 快速开始指南

---

*文档版本: 2.0*
*创建日期: 2026-03-13*
*更新日期: 2026-03-15*
