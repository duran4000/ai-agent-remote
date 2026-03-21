const MSG_TYPES = {
  COMMAND: 'command',
  OUTPUT: 'output',
  STATUS: 'status',
  CONTROL: 'control',
  RESIZE: 'resize',
  NETWORK_INFO: 'network_info'
};

const DEVICE_TYPES = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  MANAGER: 'manager'
};

const CONNECTION_MODES = {
  RELAY: 'relay',
  DIRECT: 'direct'
};

const STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ACTIVE: 'active',
  IDLE: 'idle'
};

function createMessage(type, data, sessionId = null, deviceId = null, deviceType = null) {
  return { type, sessionId, deviceId, deviceType, timestamp: Date.now(), data };
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export { MSG_TYPES, DEVICE_TYPES, CONNECTION_MODES, STATUS, createMessage, generateId };
