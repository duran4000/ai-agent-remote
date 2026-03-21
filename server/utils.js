export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const MSG_TYPES = {
  COMMAND: 'command',
  OUTPUT: 'output',
  STATUS: 'status',
  CONTROL: 'control'
};

export const DEVICE_TYPES = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile'
};

export const STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ACTIVE: 'active',
  IDLE: 'idle'
};
