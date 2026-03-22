import { MSG_TYPES, DEVICE_TYPES, CONNECTION_MODES, createMessage } from './constants.js';

export class WebSocketManager {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.deviceId = null;
    this.deviceType = null;
    this.isConnected = false;
    this.listeners = new Map();
    this.connectionMode = CONNECTION_MODES.RELAY;
    this.networkInfo = null;

    // 延迟检测
    this.latency = null;
    this._pingTime = null;
    this._heartbeatInterval = null;
    this._latencyHistory = [];
    this._maxLatencyHistory = 10;
  }

  async fetchNetworkInfo(serverUrl) {
    try {
      const baseUrl = serverUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
      const response = await fetch(`${baseUrl}/api/network-info`);
      const result = await response.json();
      if (result.success) {
        this.networkInfo = result.data;
        return result.data;
      }
    } catch (error) {
      console.log('[WS] Failed to fetch network info:', error);
    }
    return null;
  }

  getBestConnectionUrl(serverUrl) {
    if (!this.networkInfo) {
      return serverUrl;
    }
    
    const { connectionMode } = this.networkInfo;
    
    if (connectionMode === CONNECTION_MODES.DIRECT) {
      this.connectionMode = CONNECTION_MODES.DIRECT;
      return serverUrl;
    }
    
    this.connectionMode = CONNECTION_MODES.RELAY;
    return serverUrl;
  }

  connect(serverUrl, token, workDir, aiAgent = 'claude', useDirectMode = true) {
    return new Promise(async (resolve, reject) => {
      try {
        if (useDirectMode) {
          await this.fetchNetworkInfo(serverUrl);
          serverUrl = this.getBestConnectionUrl(serverUrl);
        }
        
        const savedDeviceId = localStorage.getItem('claude-remote-deviceId');
        
        const normalizedWorkDir = workDir.replace(/\\/g, '/').toLowerCase();
        const sessionKey = `${aiAgent}:${normalizedWorkDir}`;
        const sessionId = sessionKey;
        
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('[WS] Connected to server:', serverUrl, '(mode:', this.connectionMode, ')');
          this.deviceType = DEVICE_TYPES.MOBILE;
          this.ws.send(JSON.stringify(createMessage(MSG_TYPES.CONTROL, {
            action: 'auth',
            token,
            deviceType: DEVICE_TYPES.MOBILE,
            workDir: normalizedWorkDir,
            aiAgent
          }, sessionId, savedDeviceId || undefined)));
        };

        this.ws.onmessage = (event) => {
          console.log('[WS Client] Raw message:', event.data.substring(0, 200));
          try {
            const message = JSON.parse(event.data);
            console.log('[WS Client] Parsed message type:', message.type);
            this.handleMessage(message);

            if (message.type === MSG_TYPES.CONTROL && message.data?.action === 'auth_success') {
              this.sessionId = message.sessionId;
              this.deviceId = message.deviceId;
              this.isConnected = true;

              localStorage.setItem('claude-remote-deviceId', message.deviceId);

              // 启动心跳检测
              this._startHeartbeat();

              resolve(message);
            }
          } catch (error) {
            console.error('[WS] Parse error:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('[WS] Disconnected:', event.code, event.reason);
          this.isConnected = false;
          this.emit('disconnected', { code: event.code, reason: event.reason });
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          reject(error);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
      this.isConnected = false;
    }
  }

  // 心跳检测
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        this._pingTime = Date.now();
        const message = createMessage(MSG_TYPES.CONTROL, { action: 'ping' }, this.sessionId, this.deviceId, this.deviceType);
        this.ws.send(JSON.stringify(message));
      }
    }, 10000); // 每10秒发送一次 ping
  }

  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  _handlePong() {
    if (this._pingTime) {
      const latency = Date.now() - this._pingTime;
      this._pingTime = null;

      // 记录延迟历史
      this._latencyHistory.push(latency);
      if (this._latencyHistory.length > this._maxLatencyHistory) {
        this._latencyHistory.shift();
      }

      // 计算平均延迟
      const avgLatency = Math.round(
        this._latencyHistory.reduce((a, b) => a + b, 0) / this._latencyHistory.length
      );

      this.latency = avgLatency;

      // 每次都触发延迟更新事件
      this.emit('latency', { latency: avgLatency, history: [...this._latencyHistory] });
    }
  }

  // 获取连接质量等级
  getConnectionQuality() {
    if (this.latency === null) return 'unknown';
    if (this.latency < 100) return 'excellent';
    if (this.latency < 200) return 'good';
    if (this.latency < 500) return 'fair';
    return 'poor';
  }

  handleMessage(message) {
    const { type, data, sessionId } = message;
    console.log('[WS Client] handleMessage - type:', type, 'data:', data?.content?.substring?.(0, 50));

    // 处理 pong 响应
    if (type === MSG_TYPES.CONTROL && data?.action === 'pong') {
      this._handlePong();
      return;
    }

    switch (type) {
      case MSG_TYPES.OUTPUT:
        console.log('[WS Client] Emitting output event');
        this.emit('output', data);
        break;
      case MSG_TYPES.STATUS:
        this.emit('status', { ...data, sessionId });
        break;
      case MSG_TYPES.CONTROL:
        this.emit('control', data);
        break;
      default:
        console.log('[WS Client] Unknown message type:', type);
    }
  }

  sendCommand(content, cols = null, rows = null) {
    if (!this.ws || !this.isConnected) return false;
    const message = createMessage(MSG_TYPES.COMMAND, { content, cols, rows }, this.sessionId, this.deviceId, this.deviceType);
    this.ws.send(JSON.stringify(message));
    return true;
  }

  sendResize(cols, rows) {
    if (!this.ws || !this.isConnected) return false;
    const message = createMessage(MSG_TYPES.RESIZE, { cols, rows }, this.sessionId, this.deviceId, this.deviceType);
    console.log(`[WS] Sending resize: ${cols}x${rows}`);
    this.ws.send(JSON.stringify(message));
    return true;
  }

  sendActive(activeDevice) {
    if (!this.ws || !this.isConnected) return false;
    const message = createMessage(MSG_TYPES.CONTROL, { action: 'active', activeDevice }, this.sessionId, this.deviceId, this.deviceType);
    this.ws.send(JSON.stringify(message));
    return true;
  }

  send(message) {
    if (!this.ws || !this.isConnected) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }
}
