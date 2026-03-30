import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, unlinkSync, existsSync, access, stat, appendFileSync } from 'fs';
import { execSync } from 'child_process';
import { generateId } from './utils.js';
import { getServerHost, getServerPort, getServerToken, getSessionConfig, getAIAgents, getServerAuthPassword, getConnectionConfig, loadConfig, addAIAgent, updateAIAgent, deleteAIAgent } from '../utils/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOCK_FILE = join(__dirname, 'server.lock');
const LOG_FILE = join(process.env.TEMP || '/tmp', 'ai-agent-server.log');

// Buffered async logging - prevents high-frequency output from blocking the event loop
const logBuffer = [];
const LOG_FLUSH_INTERVAL = 500; // ms
const LOG_BUFFER_MAX = 1000; // drop logs if buffer is too full

function flushLogBuffer() {
  if (logBuffer.length === 0) return;
  const chunk = logBuffer.splice(0, logBuffer.length);
  try {
    appendFileSync(LOG_FILE, chunk.join(''));
  } catch (error) {
    // Silently ignore - don't let logging failures crash the server
  }
}

setInterval(flushLogBuffer, LOG_FLUSH_INTERVAL);

function logToFile(message) {
  if (logBuffer.length >= LOG_BUFFER_MAX) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX + 100);
  }
  const timestamp = new Date().toISOString();
  logBuffer.push(`[${timestamp}] ${message}\n`);
}

const originalConsoleLog = console.log;
console.log = (...args) => {
  originalConsoleLog(...args);
  logToFile(args.join(' '));
};

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    try {
      const lockContent = readFileSync(LOCK_FILE, 'utf-8');
      const lockData = JSON.parse(lockContent);
      console.log(`[Server] Lock file exists from ${lockData.startTime}`);
      console.log(`[Server] PID: ${lockData.pid}`);
      return false;
    } catch (error) {
      console.log(`[Server] Invalid lock file, removing...`);
      unlinkSync(LOCK_FILE);
    }
  }

  try {
    const lockData = {
      pid: process.pid,
      startTime: new Date().toISOString(),
      port: config.server.port
    };
    writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
    console.log(`[Server] Lock file created: ${LOCK_FILE}`);
    return true;
  } catch (error) {
    console.log(`[Server] Failed to create lock file: ${error.message}`);
    return false;
  }
}

function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
      console.log(`[Server] Lock file removed`);
    }
  } catch (error) {
    console.log(`[Server] Failed to remove lock file: ${error.message}`);
  }
}

const config = {
  server: {
    host: getServerHost(),
    port: getServerPort(),
    token: getServerToken()
  },
  session: getSessionConfig()
};

const sessions = new Map();
const deviceToSession = new Map();
const managers = new Set();

function createSession(sessionId = null) {
  const id = sessionId || generateId();
  const session = {
    id,
    desktops: new Map(),
    mobile: null,
    activeDevice: null,
    history: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    workDir: null,
    aiAgent: 'claude',
    pendingResize: null
  };
  sessions.set(id, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function getOrCreateSession(sessionId) {
  return getSession(sessionId) || createSession(sessionId);
}

function addDevice(sessionId, ws, deviceType, deviceId, aiAgent = 'claude') {
  const session = getOrCreateSession(sessionId);
  const device = { ws, deviceId, deviceType, connectedAt: Date.now(), aiAgent };

  console.log(`[WS] addDevice: ${deviceType} (${deviceId}, aiAgent=${aiAgent}) to session ${sessionId}, existing desktops: ${session.desktops.size}, existing mobile: ${session.mobile?.deviceId}`);

  if (deviceType === 'desktop') {
    // 使用aiAgent作为key来存储desktop连接
    const existingDesktop = session.desktops.get(aiAgent);
    if (existingDesktop && existingDesktop.deviceId !== deviceId) {
      console.log(`[WS] Closing old desktop connection for ${aiAgent}: ${existingDesktop.deviceId}`);
      deviceToSession.delete(existingDesktop.deviceId);
      existingDesktop.ws.close(1000, 'New desktop connected');
    } else if (existingDesktop && existingDesktop.deviceId === deviceId) {
      console.log(`[WS] Same desktop reconnecting for ${aiAgent}: ${deviceId}`);
      deviceToSession.delete(existingDesktop.deviceId);
    }
    session.desktops.set(aiAgent, device);
  } else {
    if (session.mobile && session.mobile.deviceId !== deviceId) {
      console.log(`[WS] Closing old mobile connection: ${session.mobile.deviceId}`);
      deviceToSession.delete(session.mobile.deviceId);
      session.mobile.ws.close(1000, 'New mobile connected');
    } else if (session.mobile && session.mobile.deviceId === deviceId) {
      console.log(`[WS] Same mobile reconnecting: ${deviceId}`);
      deviceToSession.delete(session.mobile.deviceId);
    }
    session.mobile = device;
  }

  deviceToSession.set(deviceId, sessionId);
  const previousActiveDevice = session.activeDevice;
  session.activeDevice = deviceId;
  session.lastActivity = Date.now();
  console.log(`[WS] addDevice: set activeDevice from ${previousActiveDevice} to ${deviceId} (deviceType=${deviceType}, aiAgent=${aiAgent})`);
  return session;
}

function removeDevice(deviceId, ws) {
  const sessionId = deviceToSession.get(deviceId);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;

  let removedAiAgent = null;

  // 检查是否是desktop连接
  for (const [aiAgent, desktop] of session.desktops.entries()) {
    if (desktop.deviceId === deviceId) {
      if (!ws || desktop.ws === ws) {
        console.log(`[WS] Removing desktop ${aiAgent} from session ${sessionId}`);
        removedAiAgent = aiAgent;
        session.desktops.delete(aiAgent);
      }
      break;
    }
  }
  
  if (session.mobile?.deviceId === deviceId) {
    if (!ws || session.mobile.ws === ws) {
      session.mobile = null;
    }
  }
  deviceToSession.delete(deviceId);

  // 检查是否还有任何desktop连接
  const hasDesktop = session.desktops.size > 0;
  if (!hasDesktop && !session.mobile) {
    sessions.delete(sessionId);
    return null;
  }

  if (session.activeDevice === deviceId) {
    // 获取第一个可用的desktop或mobile
    const firstDesktop = session.desktops.values().next().value;
    session.activeDevice = firstDesktop?.deviceId || session.mobile?.deviceId || null;
  }
  
  // 返回session和被移除的aiAgent
  return { session, removedAiAgent };
}

function addToHistory(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.history.push({ ...message, timestamp: Date.now() });
  if (session.history.length > 1000) {
    session.history = session.history.slice(-1000);
  }
  session.lastActivity = Date.now();
}

function broadcastToSession(sessionId, message, excludeDeviceId = null) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const msgStr = JSON.stringify(message);

  session.desktops.forEach((desktop) => {
    if (desktop.deviceId !== excludeDeviceId && desktop.ws.readyState === 1) {
      desktop.ws.send(msgStr);
    }
  });
  if (session.mobile && session.mobile.deviceId !== excludeDeviceId) {
    if (session.mobile.ws.readyState === 1) session.mobile.ws.send(msgStr);
  }
}

function notifyManagers(message) {
  const msgStr = JSON.stringify(message);
  managers.forEach(manager => {
    if (manager.ws.readyState === 1) {
      manager.ws.send(msgStr);
    }
  });
}

function handleWebSocket(ws, req) {
  let deviceId = null;
  let deviceType = null;
  let sessionId = null;
  let isAuthenticated = false;

  const clientPort = req.socket.remotePort;
  console.log(`[WS] New connection from ${req.socket.remoteAddress}:${clientPort}`);

  function send(message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  ws.on('close', (code, reason) => {
    console.log(`[WS] Disconnected: ${deviceId || 'unknown'} (port: ${clientPort}) - code: ${code}, reason: ${reason?.toString() || 'none'}`);
    
    // 处理 Manager 断开
    if (deviceType === 'manager') {
      managers.forEach(manager => {
        if (manager.ws === ws) {
          managers.delete(manager);
          console.log(`[WS] Manager removed: ${deviceId}`);
        }
      });
      return;
    }
    
    if (deviceId) {
      const result = removeDevice(deviceId, ws);
      if (result && result.session) {
        const { session, removedAiAgent } = result;
        broadcastToSession(session.id, {
          type: 'status',
          sessionId: session.id,
          timestamp: Date.now(),
          data: { 
            status: 'disconnected', 
            deviceId, 
            deviceType,
            aiAgent: removedAiAgent
          }
        }, deviceId);
        
        // 通知 Manager
        notifyManagers({
          type: 'status',
          sessionId: session.id,
          timestamp: Date.now(),
          data: { 
            status: 'disconnected', 
            deviceId, 
            deviceType,
            aiAgent: removedAiAgent
          }
        });
        
        // 不再主动关闭移动设备的连接，允许移动设备保持连接状态
        // 移动设备可以等待新的wrapper连接或者主动断开
      }
    }
  });

  ws.on('error', (err) => {
    console.log(`[WS] Error for ${deviceId || 'unknown'} (port: ${clientPort}): ${err.message}`);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const { type, sessionId: msgSid, data: msgData } = msg;

      // Skip per-message logging for high-frequency output to avoid event loop blocking
      if (type !== 'output') {
        console.log(`[WS] Received message type: ${type}, from: ${deviceId || 'not authed'}, deviceType: ${deviceType}`);
      }

      if (!isAuthenticated && type !== 'control') {
        send({ type: 'status', data: { status: 'disconnected', error: 'Not authenticated' } });
        return;
      }

      if (type === 'control') {
        const { action, token, deviceType: dType, deviceId: clientDeviceId, workDir, aiAgent, activeDevice } = msgData || {};
        console.log(`[WS] Received control message: action=${action}, aiAgent=${aiAgent}, deviceType=${dType}`);

        if (action === 'active') {
          const session = getSession(sessionId);
          if (session) {
            session.activeDevice = activeDevice;
            console.log(`[WS] Active device: ${activeDevice}`);
            
            // 发送active状态给对应的设备
            // 当activeDevice是mobile时，发送给desktop端，让desktop端显示蒙板
            if (activeDevice === 'mobile') {
              // 发送给所有desktop客户端，让它们显示蒙板
              if (session.desktops) {
                session.desktops.forEach((desktop) => {
                  if (desktop.ws?.readyState === 1) {
                    desktop.ws.send(JSON.stringify({
                      type: 'control',
                      sessionId,
                      deviceId: desktop.deviceId,
                      timestamp: Date.now(),
                      data: { action: 'showOverlay', activeDevice: 'mobile' }
                    }));
                  }
                });
              }
            }
            
            // 当activeDevice是native时，发送给mobile端，让mobile端显示蒙板
            if (activeDevice === 'native' && session.mobile?.ws?.readyState === 1) {
              session.mobile.ws.send(JSON.stringify({
                type: 'control',
                sessionId,
                deviceId: session.mobile.deviceId,
                timestamp: Date.now(),
                data: { action: 'showOverlay', activeDevice: 'native' }
              }));
            }
          }
          return;
        }

        if (action === 'auth') {
          if (token !== config.server.token) {
            send({ type: 'status', data: { status: 'disconnected', error: 'Invalid token' } });
            ws.close(1008, 'Authentication failed');
            return;
          }

          deviceId = clientDeviceId || generateId();
          deviceType = dType || 'desktop';
          sessionId = msgSid || generateId();
          isAuthenticated = true;

          if (deviceType === 'manager') {
            managers.add({ ws, deviceId });
            console.log(`[WS] Manager registered: ${deviceId}`);
            send({
              type: 'control',
              sessionId: 'manager',
              deviceId,
              timestamp: Date.now(),
              data: { action: 'auth_success', sessionId: 'manager', deviceId, deviceType: 'manager' }
            });
            return;
          }

          const session = addDevice(sessionId, ws, deviceType, deviceId, aiAgent);
          
          if (workDir) {
            session.workDir = workDir;
          }
          
          if (aiAgent && deviceType === 'mobile') {
            // 更新session的aiAgent，但不关闭旧的wrapper
            if (session.aiAgent && session.aiAgent !== aiAgent) {
              console.log(`[WS] AI agent changed from ${session.aiAgent} to ${aiAgent}, keeping existing wrappers`);
            }
            session.aiAgent = aiAgent;
          } else if (aiAgent && deviceType === 'desktop') {
            session.aiAgent = aiAgent;
          }

          const recentHistory = session.history.slice(-50);
          send({
            type: 'control',
            sessionId,
            deviceId,
            timestamp: Date.now(),
            data: {
              action: 'auth_success',
              sessionId,
              deviceId,
              deviceType,
              activeDevice: session.activeDevice,
              history: recentHistory,
              historyTotal: session.history.length,
              workDir: session.workDir
            }
          });

          if (deviceType === 'desktop' && session.pendingResize) {
            console.log(`[WS] Sending pending resize to newly connected desktop: ${session.pendingResize.data?.cols}x${session.pendingResize.data?.rows}`);
            ws.send(JSON.stringify(session.pendingResize));
            session.pendingResize = null;
          }

          // 广播给 session 内的其他设备
          broadcastToSession(sessionId, {
            type: 'status',
            sessionId,
            timestamp: Date.now(),
            data: { 
              status: 'connected', 
              deviceId, 
              deviceType, 
              workDir: session.workDir, 
              aiAgent: session.aiAgent,
              availableDesktops: Array.from(session.desktops.keys())
            }
          }, deviceId);

          // 通知所有 Manager
          notifyManagers({
            type: 'status',
            sessionId,
            timestamp: Date.now(),
            data: { 
              status: 'connected', 
              deviceId, 
              deviceType, 
              workDir: session.workDir, 
              aiAgent: session.aiAgent,
              availableDesktops: Array.from(session.desktops.keys())
            }
          });

          console.log(`[WS] Authenticated: ${deviceType} (${deviceId}) in session ${sessionId}, workDir: ${workDir || 'none'}, aiAgent: ${session.aiAgent}`);
          return;
        }

        if (action === 'request_history') {
          const session = getSession(sessionId);
          send({
            type: 'control',
            sessionId,
            deviceId,
            timestamp: Date.now(),
            data: { action: 'history_response', history: session?.history || [] }
          });
        }

        if (action === 'ping') {
          send({
            type: 'control',
            sessionId,
            deviceId,
            timestamp: Date.now(),
            data: { action: 'pong' }
          });
        }
        return;
      }

      if (type === 'command') {
        console.log(`[WS] Received COMMAND, deviceType=${deviceType}, sessionId=${sessionId}`);
        
        const session = getSession(sessionId);
        
        // 查找目标连接（desktop > manager）
        let targetWs = null;
        let targetType = '';
        
        // 尝试发送给 desktop
        const desktop = session?.desktops?.get(session?.aiAgent || 'claude');
        if (desktop?.ws?.readyState === 1) {
          targetWs = desktop.ws;
          targetType = 'desktop';
        }
        
        // 如果没有 desktop，发送给 manager
        if (!targetWs && session?.manager?.ws?.readyState === 1) {
          targetWs = session.manager.ws;
          targetType = 'manager';
        }
        
        if (targetWs) {
          addToHistory(sessionId, msg);
          targetWs.send(JSON.stringify(msg));
          console.log(`[WS] COMMAND forwarded to ${targetType}`);
        } else {
          console.log(`[WS] COMMAND not forwarded - no target available`);
        }
      }

      if (type === 'output' && deviceType === 'desktop') {
        // output messages are not added to history (no replay value, saves memory)
        const session = getSession(sessionId);
        if (session?.mobile?.ws?.readyState === 1) {
          session.mobile.ws.send(JSON.stringify(msg));
          // Throttled logging: summary every 10s instead of per-message
          if (!session._outputLogTimer) {
            session._outputLogCount = 0;
            session._outputLogTimer = setTimeout(() => {
              console.log(`[WS] OUTPUT: forwarded ${session._outputLogCount} msgs to mobile (${sessionId})`);
              session._outputLogTimer = null;
              session._outputLogCount = 0;
            }, 10000);
          }
          session._outputLogCount++;
        }
        // If mobile is not connected, skip entirely - no logging, no processing
      }

      if (type === 'resize') {
        const { cols, rows } = msgData || {};
        console.log(`[WS] RESIZE from ${deviceType}: ${cols}x${rows}`);
        
        if (deviceType === 'mobile') {
          const session = getSession(sessionId);
          const desktop = session?.desktops?.get(session?.aiAgent || 'claude');
          if (desktop?.ws?.readyState === 1) {
            desktop.ws.send(JSON.stringify(msg));
            console.log(`[WS] RESIZE forwarded to desktop (${session?.aiAgent})`);
          } else {
            if (session) {
              session.pendingResize = msg;
              console.log(`[WS] RESIZE cached for later, desktop not ready (aiAgent=${session?.aiAgent})`);
            }
          }
        } else {
          console.log(`[WS] RESIZE from ${deviceType} ignored (only mobile resize is forwarded to desktop)`);
        }
      }

      if (type === 'status') {
        const { status } = msgData || {};
        console.log(`[WS] STATUS from ${deviceType}: ${status}, sessionId=${sessionId}, data.sessionId=${msgData?.sessionId}`);
        
        if (deviceType === 'desktop' && status === 'disconnected') {
          const session = getSession(sessionId);
          if (session) {
            const desktop = session.desktops.get(session.aiAgent || 'claude');
            if (desktop?.ws === ws) {
              session.desktops.delete(session.aiAgent || 'claude');
              console.log(`[WS] Desktop removed from session: ${session.aiAgent}`);
              
              // 通知mobile端desktop已断开
              if (session.mobile?.ws?.readyState === 1) {
                session.mobile.ws.send(JSON.stringify({
                  type: 'status',
                  sessionId,
                  timestamp: Date.now(),
                  data: { 
                    status: 'disconnected', 
                    deviceId, 
                    deviceType,
                    aiAgent: session.aiAgent
                  }
                }));
              }
              
              // 通知Manager
              notifyManagers({
                type: 'status',
                sessionId,
                timestamp: Date.now(),
                data: { 
                  status: 'disconnected', 
                  deviceId, 
                  deviceType,
                  aiAgent: session.aiAgent
                }
              });
            }
          }
        } else if (deviceType === 'manager' && status === 'disconnected') {
          // Manager发送的disconnected消息，转发给mobile端
          // 从data字段中获取sessionId
          const targetSessionId = msgData?.sessionId || sessionId;
          console.log(`[WS] Received disconnected status from manager: ${targetSessionId}`);
          const session = getSession(targetSessionId);
          console.log(`[WS] Session found: ${!!session}, mobile ready: ${session?.mobile?.ws?.readyState}`);
          if (session?.mobile?.ws?.readyState === 1) {
            session.mobile.ws.send(JSON.stringify({
              type: 'status',
              sessionId: targetSessionId,
              timestamp: Date.now(),
              data: { 
                status: 'disconnected', 
                deviceId, 
                deviceType: 'mobile'
              }
            }));
            console.log(`[WS] Forwarded disconnected status from manager to mobile: ${targetSessionId}`);
          } else {
            console.log(`[WS] Cannot forward - mobile not ready: ${session?.mobile?.ws?.readyState}`);
          }
        }
      }

    } catch (err) {
      console.error('[WS] Error:', err.message);
    }
  });
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(join(__dirname, 'webapp')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'webapp', 'index.html'));
});

app.get('/api/ai-agents', (req, res) => {
  try {
    const aiAgents = getAIAgents();
    res.json({ success: true, data: aiAgents });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/auth', (req, res) => {
  try {
    const { password } = req.body;
    const authPassword = getServerAuthPassword();
    
    if (password === authPassword) {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/validate-directory', (req, res) => {
  try {
    const { directory } = req.body;
    
    if (!directory) {
      return res.json({ success: false, error: '目录不能为空' });
    }
    
    let normalizedPath = directory;
    
    if (process.platform === 'win32') {
      normalizedPath = directory.replace(/\//g, '\\\\');
    }
    
    access(normalizedPath, 0, (err) => {
      if (err) {
        return res.json({ 
          success: false, 
          error: '目录不存在',
          directory: normalizedPath 
        });
      }
      
      stat(normalizedPath, (statErr, stats) => {
        if (statErr) {
          return res.json({ 
            success: false, 
            error: '无法访问目录',
            directory: normalizedPath 
          });
        }
        
        if (!stats.isDirectory()) {
          return res.json({ 
            success: false, 
            error: '路径不是目录',
            directory: normalizedPath 
          });
        }
        
        res.json({ 
          success: true, 
          directory: normalizedPath,
          message: '目录有效' 
        });
      });
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

wss.on('connection', handleWebSocket);

function getLocalIp() {
  try {
    const output = execSync('ipconfig', { encoding: 'utf-8', timeout: 5000 });
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/IPv4.*?(\d+\.\d+\.\d+\.\d+)/);
      if (match && !match[1].startsWith('127.')) {
        return match[1];
      }
    }
  } catch (error) {
    console.log('[Server] Local IP detection failed:', error.message);
  }
  return '127.0.0.1';
}

app.get('/api/network-info', (req, res) => {
  try {
    const localIp = getLocalIp();
    const connectionConfig = getConnectionConfig();
    
    res.json({
      success: true,
      data: {
        localIp,
        connectionMode: connectionConfig.defaultMode,
        fallbackEnabled: connectionConfig.fallbackToRelay
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/devices', (req, res) => {
  try {
    const devices = [];
    sessions.forEach((session, sessionId) => {
      session.desktops.forEach((desktop, aiAgent) => {
        devices.push({
          sessionId,
          deviceId: desktop.deviceId,
          deviceType: 'desktop',
          aiAgent,
          status: desktop.ws.readyState === 1 ? 'connected' : 'disconnected',
          connectedAt: desktop.connectedAt
        });
      });
      if (session.mobile) {
        devices.push({
          sessionId,
          deviceId: session.mobile.deviceId,
          deviceType: 'mobile',
          aiAgent: session.aiAgent,
          status: session.mobile.ws.readyState === 1 ? 'connected' : 'disconnected',
          connectedAt: session.mobile.connectedAt
        });
      }
    });
    res.json({ success: true, data: devices });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ========== Admin API ==========

// 管理页面路由
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'webapp', 'admin.html'));
});

// 获取完整配置
app.get('/api/admin/config', (req, res) => {
  try {
    const fullConfig = loadConfig();
    // 脱敏敏感字段
    const safeConfig = {
      ...fullConfig,
      server: {
        ...fullConfig.server,
        token: fullConfig.server.token ? '******' : '',
        authPassword: fullConfig.server.authPassword ? '******' : ''
      }
    };
    res.json({ success: true, data: safeConfig });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 获取 AI Agents 列表（详细信息）
app.get('/api/admin/ai-agents', (req, res) => {
  try {
    const aiAgents = getAIAgents();
    const agentsList = Object.entries(aiAgents).map(([key, config]) => ({
      key,
      name: config.name || key,
      command: config.command || key,
      fallbackPath: config.fallbackPath || ''
    }));
    res.json({ success: true, data: agentsList });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 添加 AI Agent
app.post('/api/admin/ai-agents', (req, res) => {
  try {
    const { name, command, fallbackPath } = req.body;

    if (!name || !command) {
      return res.json({ success: false, error: '名称和命令不能为空' });
    }

    // 用 name 生成 key，如果重名则加数字后缀
    let baseKey = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const aiAgents = getAIAgents();
    let agentKey = baseKey;
    if (aiAgents[agentKey]) {
      const lang = req.headers['accept-language'] || '';
      const isZh = lang.includes('zh');
      return res.json({
        success: false,
        error: isZh ? `Agent "${name}" 已存在（key: ${agentKey}），请使用编辑功能` : `Agent "${name}" already exists (key: ${agentKey}), use edit instead`
      });
    }

    const result = addAIAgent(agentKey, {
      name,
      command,
      fallbackPath: fallbackPath || ''
    });

    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 更新 AI Agent
app.put('/api/admin/ai-agents/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { name, command, fallbackPath } = req.body;

    const result = updateAIAgent(key, {
      name,
      command,
      fallbackPath: fallbackPath || ''
    });

    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 删除 AI Agent
app.delete('/api/admin/ai-agents/:key', (req, res) => {
  try {
    const { key } = req.params;
    const result = deleteAIAgent(key);
    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

const PORT = config.server.port || 8765;
const HOST = config.server.host || '127.0.0.1';

if (!acquireLock()) {
  console.log(`[Server] ERROR: Server is already running or lock file exists.`);
  console.log(`[Server] Please stop the existing server or remove the lock file manually.`);
  console.log(`[Server] Lock file location: ${LOCK_FILE}`);
  process.exit(1);
}

function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}, shutting down...`);
  releaseLock();
  process.exit(0);
}

process.on('exit', () => {
  releaseLock();
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] Claude Remote Control Server`);
  console.log(`[Server] Running at http://${HOST}:${PORT}`);
  console.log(`[Server] WebSocket: ws://${HOST}:${PORT}`);
  console.log(`[Server] Web App: http://${HOST}:${PORT}/`);
});
