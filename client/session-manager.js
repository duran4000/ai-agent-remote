#!/usr/bin/env node

import { WebSocket } from 'ws';
import { spawn, exec, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { getServerUrl, getServerToken, getAIModelPath, loadConfig } from '../utils/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(os.tmpdir(), 'session-manager.log');
const CONFIG_FILE = path.join(__dirname, 'sessions.json');
const LOCK_FILE = path.join(__dirname, 'session-manager.lock');

const MSG_TYPES = {
  COMMAND: 'command',
  OUTPUT: 'output',
  STATUS: 'status',
  CONTROL: 'control',
  RESIZE: 'resize'
};

const DEVICE_TYPES = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  MANAGER: 'manager'
};

const MOBILE_DISCONNECT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function getSessionKey(aiAgent, sessionId) {
  return `${aiAgent}-${sessionId}`;
}

function quotePathIfNeeded(p) {
  return p.includes(' ') ? `"${p}"` : p;
}

function getNodeProcesses() {
  if (process.platform === 'win32') {
    const result = execSync("wmic process where \"name='node.exe'\" get processid,commandline /format:csv", { encoding: 'utf8' });
    return result.split('\n').slice(1).filter(line => line.trim());
  }
  // Linux/Mac
  const result = execSync("ps aux | grep 'node' | grep -v grep", { encoding: 'utf8' });
  return result.trim().split('\n').filter(line => line);
}

function parseProcessLine(line) {
  const isWindows = process.platform === 'win32';
  let pid, commandLine;

  if (isWindows) {
    const lastCommaIndex = line.lastIndexOf(',');
    if (lastCommaIndex === -1) return null;
    pid = line.substring(lastCommaIndex + 1).trim();
    commandLine = line.replace(/\\/g, '/');
  } else {
    const parts = line.trim().split(/\s+/);
    pid = parts[1];
    commandLine = line;
  }

  if (!pid || isNaN(pid)) return null;
  return { pid, commandLine };
}

function extractArgValue(line, argName) {
  let match = line.match(new RegExp(`--${argName}[=\\s]+([^"\\s]+)`));
  if (!match) match = line.match(new RegExp(`--${argName}[=\\s]+"([^"]+)"`));
  return match ? match[1] : null;
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockContent = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockData = JSON.parse(lockContent);
      log(`Lock file exists from ${lockData.startTime}`);
      log(`PID: ${lockData.pid}`);

      // 检查锁文件中的进程是否还在运行
      const isProcessRunning = checkProcessAlive(lockData.pid);
      if (isProcessRunning) {
        log(`Process ${lockData.pid} is still running, cannot acquire lock`);
        return false;
      }

      // 进程已退出，移除陈旧的锁文件
      log(`Process ${lockData.pid} is not running, removing stale lock file`);
      fs.unlinkSync(LOCK_FILE);
    } catch (error) {
      log(`Invalid lock file, removing...`);
      fs.unlinkSync(LOCK_FILE);
    }
  }

  try {
    // Use 'wx' flag for atomic creation - fails if file already exists
    const fd = fs.openSync(LOCK_FILE, 'wx');
    const lockData = {
      pid: process.pid,
      startTime: new Date().toISOString()
    };
    fs.writeSync(fd, JSON.stringify(lockData, null, 2));
    fs.closeSync(fd);
    log(`Lock file created: ${LOCK_FILE}`);
    return true;
  } catch (error) {
    log(`Failed to create lock file: ${error.message}`);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      log(`Lock file removed`);
    }
  } catch (error) {
    log(`Failed to remove lock file: ${error.message}`);
  }
}

function log(...args) {
  const timestamp = new Date().toISOString();
  const msg = `[${timestamp}] [Manager] ${args.join(' ')}\n`;
  console.log('[Manager]', ...args);
  try {
    fs.appendFileSync(LOG_FILE, msg);
  } catch (e) {}
}

function checkProcessAlive(pid) {
  if (!pid) return false;

  const isWindows = process.platform === 'win32';

  try {
    if (isWindows) {
      const result = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
      return result.includes(`"${pid}"`);
    } else {
      const result = execSync(`ps -p ${pid} -o pid=`, { encoding: 'utf8' });
      return result.trim() === String(pid);
    }
  } catch (error) {
    return false;
  }
}

function loadSessionConfig() {
  const configPath = CONFIG_FILE;
  let sessionConfig = {};
  
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    sessionConfig = JSON.parse(content);
  }
  
  return {
    serverUrl: getServerUrl(),
    token: getServerToken(),
    sessions: sessionConfig.sessions?.overrides || {}
  };
}

class SessionManager {
  constructor() {
    this.ws = null;
    this.config = loadSessionConfig();
    this.sessions = new Map();
    this.deviceSessionMap = new Map();
    this.isConnected = false;
    this.heartbeatTimer = null;
  }

  start() {
    log('Session Manager starting...');
    log('Config:', JSON.stringify(this.config, null, 2));
    this.connectToServer();
  }

  connectToServer() {
    log('Connecting to server:', this.config.serverUrl);

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on('open', () => {
        log('WebSocket connected');
        this.ws.send(JSON.stringify({
          type: MSG_TYPES.CONTROL,
          timestamp: Date.now(),
          data: {
            action: 'auth',
            token: this.config.token,
            deviceType: DEVICE_TYPES.MANAGER,
            sessionId: 'manager',
            deviceId: 'session-manager'
          }
        }));
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          log('Parse error:', error.message);
        }
      });

      this.ws.on('close', (code, reason) => {
        log('WebSocket closed:', code, reason.toString());
        this.isConnected = false;
        this.stopHeartbeat();
        log('Server disconnected, exiting...');
        this.stop();
        process.exit(0);
      });

      this.ws.on('error', (error) => {
        log('WebSocket error:', error.message);
      });

    } catch (err) {
      log('Connection error:', err.message);
      log('Cannot connect to server, exiting...');
      process.exit(1);
    }
  }

  handleMessage(message) {
    const { type, sessionId, deviceId, data } = message;

    if (type === MSG_TYPES.CONTROL && data?.action === 'auth_success') {
      this.isConnected = true;
      log('Manager authenticated');
      this.startHeartbeat();
      return;
    }

    if (type === MSG_TYPES.STATUS && data?.status === 'connected' && data?.deviceType === DEVICE_TYPES.MOBILE) {
      log(`Mobile connected: session=${sessionId}, device=${deviceId}, workDir=${data.workDir || 'none'}, aiAgent=${data.aiAgent || 'claude'}`);
      this.handleMobileConnect(sessionId, deviceId, data.workDir, data.aiAgent);
      return;
    }

    if (type === MSG_TYPES.STATUS && data?.status === 'disconnected' && data?.deviceType === DEVICE_TYPES.MOBILE) {
      log(`Mobile disconnected: session=${sessionId}, device=${deviceId}, aiAgent=${data.aiAgent || 'claude'}`);
      this.handleMobileDisconnect(sessionId, deviceId, data.aiAgent);
      return;
    }

    if (type === MSG_TYPES.STATUS && data?.status === 'disconnected' && data?.deviceType === DEVICE_TYPES.DESKTOP) {
      log(`Desktop disconnected: session=${sessionId}, device=${deviceId}, aiAgent=${data.aiAgent || 'claude'}`);
      this.handleDesktopDisconnect(sessionId, deviceId, data.aiAgent || 'claude');
      return;
    }

    if (type === MSG_TYPES.COMMAND) {
      const session = this.sessions.get(sessionId);
      if (session?.wrapper) {
        session.wrapper.stdin.write(JSON.stringify(message) + '\n');
      }
      return;
    }

    if (type === MSG_TYPES.RESIZE) {
      const session = this.sessions.get(sessionId);
      if (session?.wrapper) {
        session.wrapper.stdin.write(JSON.stringify(message) + '\n');
      }
      return;
    }
  }

  handleMobileConnect(sessionId, deviceId, clientWorkDir, aiAgent = 'claude') {
    const sessionKey = getSessionKey(aiAgent, sessionId);
    const existingSession = this.sessions.get(sessionKey);

    if (existingSession) {
      // 检查wrapper是否真的还在运行
      if (existingSession.wrapper && !existingSession.wrapper.killed && !existingSession.wrapperExited) {
        // 验证wrapper进程是否真的存在
        const wrapperAlive = this.checkWrapperProcessAlive(existingSession.wrapper.pid);
        if (wrapperAlive) {
          log(`[${sessionKey}] Mobile reconnected, reusing existing wrapper`);
          existingSession.mobileConnected = true;
          existingSession.lastMobileConnect = Date.now();
          
          if (existingSession.disconnectTimer) {
            clearTimeout(existingSession.disconnectTimer);
            existingSession.disconnectTimer = null;
          }
          return;
        } else {
          log(`[${sessionKey}] Mobile reconnected but wrapper process not found, restarting wrapper`);
          this.sessions.delete(sessionKey);
        }
      } else {
        log(`[${sessionKey}] Mobile reconnected but wrapper exited, restarting wrapper`);
        this.sessions.delete(sessionKey);
      }
    }

    const workDir = !clientWorkDir
      ? process.cwd()
      : (fs.existsSync(clientWorkDir.replace(/\\/g, '/')) ? clientWorkDir.replace(/\\/g, '/') : process.cwd());
    
    loadConfig(true);
    const pathConfig = getAIModelPath(aiAgent, sessionId.toLowerCase(), true);
    const claudePath = pathConfig.command;
    const fallbackPath = pathConfig.fallbackPath;

    log(`Starting wrapper for session ${sessionKey}`);
    log(`  Work directory: ${workDir}`);
    log(`  AI Agent: ${aiAgent}`);
    log(`  Command: ${claudePath}`);
    log(`  Fallback path: ${fallbackPath || 'none'}`);

    const existingWrapper = this.checkExistingWrapper(sessionId.toLowerCase(), aiAgent);
    if (existingWrapper) {
      log(`[${sessionKey}] Existing wrapper process detected: PID=${existingWrapper.pid}, aiAgent=${existingWrapper.aiAgent || 'unknown'}`);
    } else {
      log(`[${sessionKey}] No existing wrapper process found`);
    }

    this.startWrapper(sessionId, workDir, claudePath, fallbackPath, aiAgent);
  }

  handleMobileDisconnect(sessionId, deviceId, aiAgent = 'claude') {
    const sessionKey = getSessionKey(aiAgent, sessionId);
    const session = this.sessions.get(sessionKey);
    if (session) {
      // 不立即关闭 wrapper，只是记录断开
      session.mobileConnected = false;
      session.lastMobileDisconnect = Date.now();
      log(`[${sessionKey}] Mobile disconnected, wrapper kept running`);
      
      // 5分钟后如果还没有重新连接，才关闭 wrapper
      if (session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
      }
      session.disconnectTimer = setTimeout(() => {
        const currentSession = this.sessions.get(sessionKey);
        if (currentSession && !currentSession.mobileConnected) {
          log(`[${sessionKey}] No mobile reconnection for 5 minutes, stopping wrapper`);
          if (currentSession.wrapper && !currentSession.wrapper.killed) {
            currentSession.wrapper.kill();
          }
          this.sessions.delete(sessionKey);
        }
      }, MOBILE_DISCONNECT_TIMEOUT);
    }
  }

  handleDesktopDisconnect(sessionId, deviceId, aiAgent) {
    // 根据aiAgent和sessionId查找对应的session
    const sessionKey = getSessionKey(aiAgent, sessionId);
    const session = this.sessions.get(sessionKey);

    if (session) {
      log(`[${sessionKey}] Desktop disconnected, removing session`);

      // 发送disconnected status消息
      log(`[${sessionKey}] Sending disconnected status message`);
      log(`[${sessionKey}] Session data: sessionId=${session.sessionId}, deviceId=${session.deviceId}, wsReady=${this.ws && this.ws.readyState === WebSocket.OPEN}`);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: MSG_TYPES.STATUS,
          timestamp: Date.now(),
          data: {
            sessionId: session.sessionId,
            deviceType: DEVICE_TYPES.MANAGER,
            status: 'disconnected',
            deviceId: session.deviceId
          }
        }));
        log(`[${sessionKey}] Disconnected status message sent`);
      } else {
        log(`[${sessionKey}] WebSocket not ready, cannot send status message`);
      }

      // 杀死wrapper进程及其所有子进程（使用 /T 参数杀死进程树）
      if (session.wrapperPid) {
        try {
          const isWindows = process.platform === 'win32';
          if (isWindows) {
            // /T 参数会杀死指定进程及其所有子进程（包括 claude.exe）
            execSync(`taskkill /F /T /PID ${session.wrapperPid}`, { encoding: 'utf8' });
          } else {
            // Linux/Mac: 杀死进程组
            try {
              process.kill(-session.wrapperPid, 'SIGKILL');
            } catch (e) {
              // 如果进程组不存在，尝试只杀死进程
              execSync(`kill -9 ${session.wrapperPid}`, { encoding: 'utf8' });
            }
          }
          log(`[${sessionKey}] Wrapper process tree killed: PID ${session.wrapperPid}`);
        } catch (error) {
          log(`[${sessionKey}] Failed to kill wrapper process tree: ${error.message}`);
        }
      } else if (session.wrapper && !session.wrapper.killed) {
        try {
          session.wrapper.kill();
          log(`[${sessionKey}] Wrapper killed`);
        } catch (error) {
          log(`[${sessionKey}] Failed to kill wrapper: ${error.message}`);
        }
      }

      this.sessions.delete(sessionKey);
    } else {
      log(`[${sessionKey}] Session not found for desktop disconnect`);
    }
  }

  checkExistingWrapper(sessionId, aiAgent = 'claude') {
    const normalizedSessionId = sessionId.replace(/\\/g, '/');

    try {
      const lines = getNodeProcesses();

      for (const line of lines) {
        const parsed = parseProcessLine(line);
        if (!parsed) continue;
        if (!line.includes('ai-agent-pty-wrapper') || !parsed.commandLine.includes(normalizedSessionId)) continue;

        const claudePath = extractArgValue(line, 'claude-path');
        const existingAiAgent = extractArgValue(line, 'ai-model');

        if (existingAiAgent && existingAiAgent !== aiAgent) continue;
        return { pid: parsed.pid, claudePath, aiAgent: existingAiAgent, mismatch: false };
      }
    } catch (error) {
      log(`[${sessionId}] Check existing wrapper error: ${error.message}`);
    }
    
    return null;
  }

  checkWrapperProcessAlive(pid) {
    if (!pid) return false;
    
    const isWindows = process.platform === 'win32';
    
    try {
      if (isWindows) {
        // Windows: 检查指定PID的进程是否存在
        const result = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
        return result.includes(`"${pid}"`);
      } else {
        // Linux/Mac: 检查指定PID的进程是否存在
        const result = execSync(`ps -p ${pid} -o pid=`, { encoding: 'utf8' });
        return result.trim() === String(pid);
      }
    } catch (error) {
      // 进程不存在
      return false;
    }
  }

  cleanupExistingWrapper(sessionId) {
    try {
      const lines = getNodeProcesses();

      for (const line of lines) {
        if (!line.includes('ai-agent-pty-wrapper') || !line.includes(sessionId)) continue;
        const parsed = parseProcessLine(line);
        if (!parsed) continue;

        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /PID ${parsed.pid}`, { encoding: 'utf8' });
          } else {
            execSync(`kill -9 ${parsed.pid}`, { encoding: 'utf8' });
          }
          log(`[${sessionId}] Killed existing wrapper process: PID ${parsed.pid}`);
        } catch (killError) {
          log(`[${sessionId}] Failed to kill process ${parsed.pid}: ${killError.message}`);
        }
      }
    } catch (error) {
      log(`[${sessionId}] Cleanup error: ${error.message}`);
    }
  }

  cleanupPtyProcesses(sessionId, aiAgent = 'claude') {
    const normalizedSessionId = sessionId.replace(/\\/g, '/').toLowerCase();

    try {
      if (process.platform === 'win32') {
        const lines = getNodeProcesses();
        for (const line of lines) {
          if (!line.includes('ai-agent-pty-wrapper') || !line.includes(normalizedSessionId)) continue;
          const parsed = parseProcessLine(line);
          if (!parsed) continue;

          try {
            execSync(`taskkill /F /T /PID ${parsed.pid}`, { encoding: 'utf8', timeout: 10000 });
            log(`[${normalizedSessionId}] Killed wrapper process tree: PID ${parsed.pid}`);
          } catch (killError) {
            log(`[${normalizedSessionId}] Failed to kill wrapper tree ${parsed.pid}: ${killError.message}`);
          }
        }
      } else {
        try {
          execSync(`pkill -f "ai-agent-pty-wrapper.*${normalizedSessionId}"`, { encoding: 'utf8' });
          log(`[${normalizedSessionId}] Killed wrapper processes`);
        } catch (killError) {
          log(`[${normalizedSessionId}] Failed to kill wrapper processes: ${killError.message}`);
        }
      }
    } catch (error) {
      log(`[${normalizedSessionId}] PTY cleanup error: ${error.message}`);
    }
  }

  startWrapper(sessionId, workDir, claudePath, fallbackPath, aiAgent = 'claude') {
    const normalizedSessionId = sessionId.replace(/\\/g, '/').toLowerCase();
    const sessionKey = `${aiAgent}-${normalizedSessionId}`;
    const wrapperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ai-agent-pty-wrapper.js');
    
    const isWindows = process.platform === 'win32';
    
    // 检查wrapper是否已经在运行
    const existingWrapper = this.checkExistingWrapper(normalizedSessionId, aiAgent);
    if (existingWrapper) {
      log(`[${sessionKey}] Found existing wrapper: PID=${existingWrapper.pid}, aiAgent=${existingWrapper.aiAgent || 'none'}`);

      // 只检查aiAgent是否匹配，不比较command路径
      // 这样当config.json中的command改变时不会重启已有的wrapper
      const aiAgentMismatch = existingWrapper.aiAgent && existingWrapper.aiAgent !== aiAgent;

      if (aiAgentMismatch) {
        log(`[${sessionKey}] AI Agent mismatch: existing=${existingWrapper.aiAgent || 'none'}, new=${aiAgent}, killing existing wrapper`);
        // 杀死现有的wrapper
        try {
          if (isWindows) {
            execSync(`taskkill /F /PID ${existingWrapper.pid}`, { encoding: 'utf8' });
          } else {
            execSync(`kill -9 ${existingWrapper.pid}`, { encoding: 'utf8' });
          }
          log(`[${sessionKey}] Killed existing wrapper: PID ${existingWrapper.pid}`);
        } catch (error) {
          log(`[${sessionKey}] Failed to kill existing wrapper: ${error.message}`);
        }
        // 删除session
        this.sessions.delete(sessionKey);
      } else {
        log(`[${sessionKey}] Wrapper already running with correct aiAgent: PID ${existingWrapper.pid}, reusing existing wrapper`);
        const session = {
          wrapper: null,
          wrapperPid: existingWrapper.pid,
          workDir,
          aiAgent,
          sessionId: sessionId,
          startTime: Date.now(),
          mobileConnected: true,
          lastMobileConnect: Date.now(),
          disconnectTimer: null,
          wrapperExited: false,
          deviceId: `mobile-${sessionId}`
        };
        this.sessions.set(sessionKey, session);
        return;
      }
    }
    
    let spawnCmd, spawnArgs, spawnOptions;
    
    if (isWindows) {
      // Windows: 直接 spawn cmd.exe /c start，避免 shell:true 创建多余的 cmd 窗口
      // cmd.exe 由 windowsHide:true 隐藏，start 创建的唯一窗口可见
      const windowTitle = `"${aiAgent.toUpperCase()}"`;
      const quotedClaudePath = quotePathIfNeeded(claudePath);

      spawnArgs = [
        '/c',
        'start',
        windowTitle,
        '/wait',
        'node',
        wrapperPath,
        '--server', this.config.serverUrl,
        '--token', this.config.token,
        '--session', normalizedSessionId,
        '--device-id', `wrapper-${aiAgent}-${normalizedSessionId}`,
        '--claude-path', quotedClaudePath,
        '--ai-model', aiAgent
      ];

      if (fallbackPath) {
        const quotedFallbackPath = quotePathIfNeeded(fallbackPath);
        spawnArgs.push('--fallback-path', quotedFallbackPath);
      }

      log(`[${sessionKey}] CMD: cmd /c start ${windowTitle} /wait node ${wrapperPath} ...`);

      spawnOptions = {
        cwd: workDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        windowsHide: true
      };
    } else {
      // Linux/Mac: 使用node执行wrapper.js
      spawnArgs = [
        wrapperPath,
        '--server', this.config.serverUrl,
        '--token', this.config.token,
        '--session', normalizedSessionId,
        '--device-id', `wrapper-${aiAgent}-${normalizedSessionId}`,
        '--claude-path', claudePath,
        '--ai-model', aiAgent
      ];
      
      if (fallbackPath) {
        spawnArgs.push('--fallback-path', fallbackPath);
      }
      
      spawnOptions = {
        cwd: workDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        },
        stdio: 'ignore'
      };
    }

    const spawnExe = isWindows ? 'cmd.exe' : process.execPath;
    const wrapper = spawn(spawnExe, spawnArgs, spawnOptions);
    
    const session = {
      wrapper,
      wrapperPid: wrapper.pid,
      workDir,
      aiAgent,
      startTime: Date.now(),
      mobileConnected: true,
      lastMobileConnect: Date.now(),
      disconnectTimer: null,
      deviceId: `mobile-${sessionId}`,
      sessionId: sessionId
    };

    this.sessions.set(sessionKey, session);

    log('Starting wrapper for session:', sessionKey);
    log('  Work directory:', workDir);
    log('  spawnArgs:', JSON.stringify(spawnArgs));
    log('Wrapper spawned with PID:', wrapper.pid);
    
    if (wrapper.stdout) {
      wrapper.stdout.on('data', (data) => {
        log(`[${sessionKey}] Wrapper stdout:`, data.toString());
      });
    }
    
    if (wrapper.stderr) {
      wrapper.stderr.on('data', (data) => {
        log(`[${sessionKey}] Wrapper stderr:`, data.toString());
      });
    }
    
    wrapper.on('exit', (code, signal) => {
      log(`[${sessionId}] Wrapper exited: code=${code}, signal=${signal}`);
      const session = this.sessions.get(sessionKey);
      if (session) {
        session.wrapper = null;
        session.wrapperExited = true;
        
        log(`[${sessionId}] Sending disconnected status message`);
        log(`[${sessionId}] Session data: sessionId=${session.sessionId}, deviceId=${session.deviceId}, wsReady=${this.ws && this.ws.readyState === WebSocket.OPEN}`);
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: MSG_TYPES.STATUS,
            timestamp: Date.now(),
            data: {
              sessionId: session.sessionId,
              deviceType: DEVICE_TYPES.MOBILE,
              status: 'disconnected',
              deviceId: session.deviceId
            }
          }));
          log(`[${sessionId}] Disconnected status message sent`);
        } else {
          log(`[${sessionId}] WebSocket not ready, cannot send status message`);
        }
        
        this.cleanupPtyProcesses(sessionId, aiAgent);
      } else {
        log(`[${sessionId}] Session not found in sessions map`);
      }
    });

    wrapper.on('error', (err) => {
      log(`[${sessionId}] Wrapper error:`, err.message);
      const session = this.sessions.get(sessionKey);
      if (session) {
        session.wrapper = null;
        session.wrapperExited = true;
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: MSG_TYPES.STATUS,
            timestamp: Date.now(),
            data: {
              sessionId: session.sessionId,
              deviceType: DEVICE_TYPES.MOBILE,
              status: 'disconnected',
              deviceId: session.deviceId
            }
          }));
        }
      }
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send(JSON.stringify({
          type: MSG_TYPES.CONTROL,
          timestamp: Date.now(),
          data: { action: 'ping' }
        }));
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  stop() {
    this.stopHeartbeat();
    for (const [sessionId, session] of this.sessions) {
      log(`Stopping wrapper for session ${sessionId}`);
      if (session.wrapper && !session.wrapper.killed) {
        session.wrapper.kill();
      }
    }
    if (this.ws) {
      this.ws.close();
    }
    releaseLock();
  }
}

const manager = new SessionManager();

if (!acquireLock()) {
  log('ERROR: Session Manager is already running or lock file exists.');
  log('Please stop the existing Session Manager or remove the lock file manually.');
  log('Lock file location:', LOCK_FILE);
  process.exit(1);
}

function shutdown(signal) {
  log(`Received ${signal}, shutting down...`);
  manager.stop();
  releaseLock();
  process.exit(0);
}

process.on('exit', () => {
  releaseLock();
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

manager.start();
