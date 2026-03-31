#!/usr/bin/env node

import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getServerUrl, getServerToken, getWrapperDefaults, getAIModelPath, loadConfig } from '../utils/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(os.tmpdir(), 'ai-agent-pty-wrapper.log');
const MSG_TYPES = {
  COMMAND: 'command',
  OUTPUT: 'output',
  STATUS: 'status',
  CONTROL: 'control',
  RESIZE: 'resize'
};

const DEVICE_TYPES = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile'
};

const ENABLE_DEBUG = false;

function log(...args) {
  const timestamp = new Date().toISOString();
  const msg = `[${timestamp}] [PTY-Wrapper] ${args.join(' ')}\n`;
  
  if (ENABLE_DEBUG) {
    console.error('[PTY-Wrapper]', ...args);
  }
  
  try {
    fs.appendFileSync(LOG_FILE, msg);
  } catch (e) {}
}

function createMessage(type, data, sessionId, deviceId) {
  return { type, sessionId, deviceId, timestamp: Date.now(), data };
}

class ClaudePtyWrapper {
  constructor() {
    this.ws = null;
    this.pty = null;
    this.ptyPid = null; // 记录 PTY 子进程的 PID
    this.sessionId = null;
    this.deviceId = null;
    this.assignedDeviceId = null;
    this.isConnected = false;
    this.config = this.loadConfig();
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.shouldReconnect = true;
    this.outputBuffer = '';
    this.remoteSizeReceived = false;
    this.pendingOutput = [];
    this.isResizing = false;
    this.resizeSource = null;
    this.activeClient = null;
    this.activeClientTimer = null;
    this.isStopping = false; // 防止重复停止

    log('Starting Claude PTY Wrapper...');
    log('Raw process.argv:', JSON.stringify(process.argv));
    log('Config:', JSON.stringify(this.config));
  }

  loadConfig() {
    const args = process.argv.slice(2);
    log('Raw args:', JSON.stringify(args));
    const defaults = getWrapperDefaults();
    const config = {
      serverUrl: getServerUrl(),
      token: getServerToken(),
      sessionId: 'ai-agent-default',
      deviceId: 'ai-agent-desktop-main',
      claudePath: defaults.defaultClaudePath || 'claude',
      cols: defaults.defaultCols,
      rows: defaults.defaultRows
    };

    // 先解析所有参数
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--server' && args[i + 1]) {
        config.serverUrl = args[i + 1];
        i++;
      } else if (args[i] === '--token' && args[i + 1]) {
        config.token = args[i + 1];
        i++;
      } else if (args[i] === '--session' && args[i + 1]) {
        config.sessionId = args[i + 1];
        i++;
      } else if (args[i] === '--device-id' && args[i + 1]) {
        config.deviceId = args[i + 1];
        i++;
      } else if (args[i] === '--claude-path' && args[i + 1]) {
        let path = args[i + 1];
        log(`Raw claude-path argument: "${path}"`);
        if (path.startsWith('"') && path.endsWith('"')) {
          path = path.slice(1, -1);
          log(`Removed quotes, claude-path: "${path}"`);
        }
        config.claudePath = path;
        i++;
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          config.claudePath += ' ' + args[i + 1];
          log(`Appending to claude-path: "${args[i + 1]}", new value: "${config.claudePath}"`);
          i++;
        }
      } else if (args[i] === '--fallback-path' && args[i + 1]) {
        config.fallbackPath = args[i + 1];
        i++;
      } else if (args[i] === '--ai-model' && args[i + 1]) {
        config.aiAgent = args[i + 1];
        i++;
      } else if (args[i] === '--cols' && args[i + 1]) {
        config.cols = parseInt(args[i + 1], 10);
        i++;
      } else if (args[i] === '--rows' && args[i + 1]) {
        config.rows = parseInt(args[i + 1], 10);
        i++;
      }
    }

    // 如果指定了 aiAgent，从 aiAgents 配置中自动获取 command 和 fallbackPath
    // 优先级：命令行参数 > aiAgents 配置 > 默认值
    if (config.aiAgent) {
      const aiModelConfig = getAIModelPath(config.aiAgent, config.sessionId);
      if (aiModelConfig.command && !args.includes('--claude-path')) {
        config.claudePath = aiModelConfig.command;
        log(`Using command from aiAgents config: "${config.claudePath}"`);
      }
      if (aiModelConfig.fallbackPath && !args.includes('--fallback-path')) {
        config.fallbackPath = aiModelConfig.fallbackPath;
        log(`Using fallbackPath from aiAgents config: "${config.fallbackPath}"`);
      }
    }

    return config;
  }

  start() {
    log('Starting Claude PTY Wrapper...');
    log('Config:', this.config);
    
    this.connectToServer();
    this.setupStdio();
  }

  setupStdio() {
    // 检查是否在 TTY 环境中
    log('process.stdin.isTTY:', process.stdin.isTTY);
    if (process.stdin.isTTY) {
      // TTY 模式（直接运行，非 Session Manager 启动）
      // 原生窗口的 resize 事件会触发，PTY 会调整大小
      // 这样原生 CLI 可以自适应窗口大小
      // 服务器端会过滤掉 desktop 的 resize 事件，不会转发给 mobile 端
      
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (data) => {
        if (this.pty) {
          const dataStr = data.toString();
          this.pty.write(dataStr);
          
          if (this.isFocusEventSequence(dataStr)) {
            log('Ignoring focus event sequence:', JSON.stringify(dataStr));
            return;
          }
          
          log('Native input detected, sending active status');
          // 原生Claude有输入，调整PTY大小为原生Claude的窗口大小
          this.activeClient = 'native';
          if (this.activeClientTimer) {
            clearTimeout(this.activeClientTimer);
          }
          this.activeClientTimer = setTimeout(() => {
            this.activeClient = null;
          }, 5000);
          
          // 调整PTY大小为原生Claude的窗口大小
          this.pty.resize(process.stdout.columns, process.stdout.rows);
          
          // 发送active状态给服务器
          this.sendActiveStatus('native');
        }
      });

      process.stdout.on('resize', () => {
        if (this.pty) {
          this.isResizing = true;
          this.resizeSource = 'native';
          this.pty.resize(process.stdout.columns, process.stdout.rows);
          
          setTimeout(() => {
            this.isResizing = false;
            this.resizeSource = null;
          }, 500);
        }
      });
    } else {
      // 非 TTY 模式（被 Session Manager 启动）
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let buffer = '';
      process.stdin.on('data', (data) => {
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        lines.forEach(line => {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              this.handleManagerMessage(msg);
            } catch (e) {
              if (this.pty) {
                this.pty.write(line);
              }
            }
          }
        });
      });
      
      process.stdin.on('end', () => {
        log('stdin ended, but wrapper continues running');
      });
    }

    process.on('exit', () => {
      this.stop();
    });

    process.on('SIGINT', () => {
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      log('Received SIGTERM, stopping...');
      this.stop();
      process.exit(0);
    });

    if (process.platform === 'win32') {
      process.on('SIGBREAK', () => {
        log('Received SIGBREAK, stopping...');
        this.stop();
        process.exit(0);
      });
    }
  }

  handleManagerMessage(msg) {
    const { type, data } = msg;
    
    if (type === 'command' && this.pty) {
      if (data?.content) {
        log('Writing to PTY:', JSON.stringify(data.content));
        this.pty.write(data.content);
        
        // mobile端有输入，调整PTY大小为mobile端的大小
        this.activeClient = 'mobile';
        if (this.activeClientTimer) {
          clearTimeout(this.activeClientTimer);
        }
        this.activeClientTimer = setTimeout(() => {
          this.activeClient = null;
        }, 5000);
        
        // 调整PTY大小为mobile端的大小
        if (data.cols && data.rows) {
          this.pty.resize(data.cols, data.rows);
        }
      }
    }
    
    if (type === 'resize' && this.pty) {
      const { cols, rows } = data || {};
      if (cols && rows) {
        try {
          this.isResizing = true;
          this.resizeSource = 'mobile';
          this.pty.resize(cols, rows);
          
          setTimeout(() => {
            this.isResizing = false;
            this.resizeSource = null;
          }, 500);
        } catch (e) {}
      }
    }
  }

  async startPty() {
    const aiAgent = this.config.aiAgent || 'claude';
    log(`Starting PTY with ${aiAgent}...`);
    
    const command = this.config.claudePath;
    const fallbackPath = this.config.fallbackPath;
    
    log('AI Agent:', aiAgent);
    log('Command:', command);
    log('Fallback path:', fallbackPath || 'none');
    log('Current working directory:', process.cwd());
    
    let ptyArgs = [];
    let ptyEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    };
    
    const spawnWithCommand = async (cmd) => {
      log(`spawnWithCommand called with: "${cmd}"`);
      const isWindows = process.platform === 'win32';
      const isAbsolutePath = cmd.includes(':') || cmd.startsWith('/') || cmd.startsWith('\\');
      const isCmdOrBat = cmd.endsWith('.cmd') || cmd.endsWith('.bat');
      const isPs1 = cmd.endsWith('.ps1');
      const isExe = cmd.endsWith('.exe');
      let spawnCommand = cmd;
      let spawnArgs = ptyArgs;
      
      log(`isWindows: ${isWindows}, isAbsolutePath: ${isAbsolutePath}, isCmdOrBat: ${isCmdOrBat}, isPs1: ${isPs1}, isExe: ${isExe}`);
      
      if (isWindows) {
        if (isAbsolutePath) {
          if (isCmdOrBat) {
            spawnCommand = 'cmd.exe';
            spawnArgs = ['/c', cmd, ...ptyArgs];
          } else if (isPs1) {
            spawnCommand = 'powershell.exe';
            spawnArgs = ['-NoExit', '-Command', `& '${cmd}'`];
          } else {
            spawnCommand = cmd;
            spawnArgs = ptyArgs;
          }
        } else {
          if (isCmdOrBat || isPs1) {
            spawnCommand = cmd;
            spawnArgs = ptyArgs;
          } else {
            spawnCommand = 'cmd.exe';
            spawnArgs = ['/c', cmd, ...ptyArgs];
          }
        }
      } else {
        // Linux/Mac: 拆分命令和参数，避免把整个字符串当可执行文件名
        const parts = cmd.split(/\s+/);
        spawnCommand = parts[0];
        spawnArgs = [...parts.slice(1), ...ptyArgs];
      }
      
      log(`Final spawnCommand: "${spawnCommand}", spawnArgs: ${JSON.stringify(spawnArgs)}`);
      
      try {
        this.pty = pty.spawn(spawnCommand, spawnArgs, {
          name: 'xterm-256color',
          cols: this.config.cols,
          rows: this.config.rows,
          cwd: process.cwd(),
          env: ptyEnv,
          handleFlowControl: false,
          echo: false,
          ...(isWindows && { useConpty: true })
        });
        this.ptyPid = this.pty.pid; // 记录 PTY 进程的 PID
        log(`PTY spawn successful, PID: ${this.ptyPid}`);
        return true;
      } catch (error) {
        log(`Failed to spawn with command '${cmd}':`, error.message);
        log(`  spawnCommand: ${spawnCommand}`);
        log(`  spawnArgs: ${JSON.stringify(spawnArgs)}`);
        log(`  Error: ${error.toString()}`);
        return false;
      }
    };
    
    try {
      let spawned = await spawnWithCommand(command);
      
      if (!spawned && fallbackPath) {
        log(`Command '${command}' failed, trying fallback path: ${fallbackPath}`);
        spawned = await spawnWithCommand(fallbackPath);
      }
      
      if (!spawned) {
        throw new Error(`Failed to start ${aiAgent}: neither command '${command}' nor fallback path worked`);
      }
    } catch (error) {
      log('Failed to start PTY:', error.message);
      log('Error details:', error);
      this.sendOutput(`[ERROR] Failed to start ${aiAgent}: ${error.message}\n`);
      this.stop();
      process.exit(1);
      return;
    }

    this.pty.onData((data) => {
      // 正常情况：发送给原生Claude和mobile端
      process.stdout.write(data);
      
      if (this.ws && this.isConnected) {
        try {
          const msg = JSON.stringify(createMessage(MSG_TYPES.OUTPUT, {
            content: data
          }, this.sessionId, this.deviceId));
          this.ws.send(msg);
        } catch (err) {
          log('Error sending output to WebSocket:', err.message);
        }
      }
    });

    this.pty.onExit(({ exitCode, signal }) => {
      log('PTY exited with code:', exitCode, 'signal:', signal);
      log('AI Agent:', aiAgent);
      log('Command used:', command);
      log('Fallback path:', fallbackPath || 'none');
      this.pty = null;
      this.stop();
      process.exit(exitCode);
    });

    log('PTY started');
  }

  connectToServer() {
    log('Connecting to server:', this.config.serverUrl);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on('open', () => {
        log('WebSocket connected');
        const deviceIdToUse = this.assignedDeviceId || this.config.deviceId;
        this.ws.send(JSON.stringify(createMessage(MSG_TYPES.CONTROL, {
          action: 'auth',
          token: this.config.token,
          deviceType: DEVICE_TYPES.DESKTOP,
          aiAgent: this.config.aiAgent
        }, this.config.sessionId, deviceIdToUse)));
        log('Sent auth');
      });

      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleServerMessage(message);
        } catch (error) {
          log('Parse error:', error.message);
        }
      });

      this.ws.on('close', (code, reason) => {
        log('WebSocket closed:', code, reason.toString());
        this.isConnected = false;
        this.stopHeartbeat();
        
        if (this.shouldReconnect) {
          log('Scheduling reconnect in 5 seconds...');
          this.reconnectTimer = setTimeout(() => this.connectToServer(), 5000);
        }
      });

      this.ws.on('error', (error) => {
        log('WebSocket error:', error.message);
      });
    } catch (err) {
      log('Connection error:', err.message);
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connectToServer(), 5000);
      }
    }
  }

  async handleServerMessage(message) {
    const { type, data } = message;

    switch (type) {
      case MSG_TYPES.CONTROL:
        if (data.action === 'auth_success') {
          this.sessionId = message.sessionId;
          this.deviceId = message.deviceId;
          this.assignedDeviceId = message.deviceId;
          this.isConnected = true;
          log('Authenticated! Session:', this.sessionId, 'DeviceId:', this.deviceId);
          
          this.startHeartbeat();
          
          if (!this.pty) {
            log('Waiting for remote terminal size before starting PTY...');
            setTimeout(async () => {
              if (!this.pty) {
                log('No remote size received, starting PTY with default size');
                await this.startPty();
              }
            }, 500);
          }
        }
        break;

      case MSG_TYPES.COMMAND:
        log('Received COMMAND:', JSON.stringify(data?.content));
        log('PTY exists:', !!this.pty, 'data exists:', !!data, 'content exists:', !!data?.content);
        if (data?.content && this.pty) {
          const processedContent = data.content.replace(/\n/g, '\r');
          log('Writing to PTY:', JSON.stringify(processedContent));
          this.pty.write(processedContent);
        } else {
          log('Cannot write to PTY - content:', !!data?.content, 'pty:', !!this.pty);
        }
        break;

      case MSG_TYPES.RESIZE:
        if (data.cols && data.rows) {
          log(`Received RESIZE: ${data.cols}x${data.rows}`);
          if (this.pty) {
            try {
              this.pty.resize(data.cols, data.rows);
              log('PTY resized');
            } catch (err) {
              log('PTY resize error:', err.message);
            }
          } else {
            log('Starting PTY with remote size:', data.cols, 'x', data.rows);
            this.config.cols = data.cols;
            this.config.rows = data.rows;
            this.remoteSizeReceived = true;
            await this.startPty();
          }
        }
        break;

      case MSG_TYPES.STATUS:
        log('Status update:', JSON.stringify(data));
        break;
    }
  }

  sendActiveStatus(activeDevice) {
    if (this.ws && this.isConnected) {
      try {
        this.ws.send(JSON.stringify(createMessage(MSG_TYPES.CONTROL, {
          action: 'active',
          activeDevice
        }, this.sessionId, this.deviceId)));
      } catch (err) {
        log('Error sending active status:', err.message);
      }
    }
  }

  sendOutput(content) {
    if (this.ws && this.isConnected) {
      try {
        this.ws.send(JSON.stringify(createMessage(MSG_TYPES.OUTPUT, {
          content
        }, this.sessionId, this.deviceId)));
      } catch (err) {
        log('Error sending output:', err.message);
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    log('Starting heartbeat timer');
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        try {
          this.ws.send(JSON.stringify(createMessage(MSG_TYPES.CONTROL, {
            action: 'ping'
          })));
        } catch (err) {
          log('Heartbeat send error:', err.message);
        }
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  isFocusEventSequence(data) {
    if (data === '\x1b[O' || data === '\x1b[I') {
      return true;
    }
    if (/^\x1b\[\d*[OI]$/.test(data)) {
      return true;
    }
    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data)) {
      return true;
    }
    const aiAgent = this.config.aiAgent || 'claude';
    if (aiAgent === 'opencode') {
      if (/^\x1b\[\?\d+(;\d+)*\$y$/.test(data)) {
        return true;
      }
      if (/^\x1b\[>\d+(;\d+)*c$/.test(data)) {
        return true;
      }
      if (/^\x1b\[\d+;\d+R$/.test(data)) {
        return true;
      }
      if (/^\x1b\][^\x07\x1b]*(\x07|\x1b\\)$/.test(data)) {
        return true;
      }
      if (/^\x1b_[^\x1b]*\x1b\\$/.test(data)) {
        return true;
      }
      if (/^\x1bP[\x20-\x7e]*\x1b\\$/.test(data)) {
        return true;
      }
      if (/^\x1b\[\d+(;\d+)*t$/.test(data)) {
        return true;
      }
    }
    return false;
  }

  stop() {
    // 防止重复停止
    if (this.isStopping) {
      log('Already stopping, skipping...');
      return;
    }
    this.isStopping = true;

    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: MSG_TYPES.STATUS,
          timestamp: Date.now(),
          sessionId: this.sessionId,
          deviceId: this.deviceId,
          data: {
            status: 'disconnected',
            deviceType: 'mobile'
          }
        }));
        log('Sent disconnected status message');
      } catch (err) {
        log('Error sending disconnected status:', err.message);
      }
    }

    if (this.ws) {
      this.ws.close();
    }

    // 强制杀死 PTY 进程树
    if (this.ptyPid) {
      this.killPtyProcessTree(this.ptyPid);
    }

    if (this.pty) {
      try {
        this.pty.kill();
      } catch (e) {
        log('Error killing PTY:', e.message);
      }
    }
    this.shouldReconnect = false;
  }

  // 杀死 PTY 进程及其所有子进程
  killPtyProcessTree(pid) {
    const isWindows = process.platform === 'win32';

    try {
      if (isWindows) {
        // Windows: 使用 taskkill /F /T 杀死进程树
        // /T 参数会杀死指定进程及其所有子进程
        execSync(`taskkill /F /T /PID ${pid}`, { encoding: 'utf8', timeout: 5000 });
        log(`Killed PTY process tree: PID ${pid}`);
      } else {
        // Linux/Mac: 使用 kill -TERM 杀死进程组
        process.kill(-pid, 'SIGTERM');
        log(`Killed PTY process group: -${pid}`);
      }
    } catch (error) {
      log(`Failed to kill PTY process tree: ${error.message}`);
      // 如果进程树杀死失败，尝试只杀死进程本身
      try {
        if (isWindows) {
          execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf8', timeout: 5000 });
        } else {
          process.kill(pid, 'SIGKILL');
        }
        log(`Killed PTY process: PID ${pid}`);
      } catch (e) {
        log(`Failed to kill PTY process: ${e.message}`);
      }
    }
  }
}

const wrapper = new ClaudePtyWrapper();
wrapper.start();
