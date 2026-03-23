import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let configCache = null;

export function loadConfig(forceReload = false) {
  if (configCache && !forceReload) {
    return configCache;
  }

  const configPath = path.join(__dirname, '..', 'config.json');
  
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    configCache = JSON.parse(configData);
    return configCache;
  } catch (error) {
    console.error('Failed to load config:', error.message);
    
    return {
      server: {
        host: '127.0.0.1',
        port: 41491,
        url: 'ws://localhost:41491',
        token: 'YOUR_AUTH_TOKEN'
      },
      session: {
        maxHistory: 1000,
        timeout: 3600000
      },
      wrapper: {
        defaultClaudePath: 'claude',
        defaultCols: 120,
        defaultRows: 40
      }
    };
  }
}

export function getServerUrl() {
  const config = loadConfig();
  return config.server.url;
}

export function getServerToken() {
  const config = loadConfig();
  return config.server.token;
}

export function getServerAuthPassword() {
  const config = loadConfig();
  return config.server.authPassword || '';
}

export function getServerHost() {
  const config = loadConfig();
  return config.server.host;
}

export function getServerPort() {
  const config = loadConfig();
  return config.server.port;
}

export function getWrapperDefaults() {
  const config = loadConfig();
  return config.wrapper;
}

export function getSessionConfig() {
  const config = loadConfig();
  return config.session;
}

export function getSessionDefaults() {
  const config = loadConfig();
  return config.sessions?.defaults || {};
}

export function getSessionOverrides() {
  const config = loadConfig();
  return config.sessions?.overrides || {};
}

export function getSessionClaudePath(sessionId) {
  const overrides = getSessionOverrides();
  const defaults = getSessionDefaults();
  
  if (overrides[sessionId] && overrides[sessionId].claudePath) {
    return overrides[sessionId].claudePath;
  }
  
  return defaults.claudePath || getWrapperDefaults().defaultClaudePath;
}

export function getAIModelPath(aiModel, sessionId, forceReload = false) {
  const config = loadConfig(forceReload);
  const aiAgents = config.aiAgents || {};
  
  const overrides = getSessionOverrides();
  const defaults = getSessionDefaults();
  
  if (aiModel && aiAgents[aiModel]) {
    const agentConfig = aiAgents[aiModel];
    return {
      command: agentConfig.command || aiModel,
      fallbackPath: agentConfig.fallbackPath
    };
  }
  
  if (sessionId && overrides[sessionId] && overrides[sessionId].claudePath) {
    return {
      command: overrides[sessionId].claudePath,
      fallbackPath: null
    };
  }
  
  return {
    command: defaults.claudePath || 'claude',
    fallbackPath: null
  };
}

export function getAIAgents() {
  const config = loadConfig(true); // 强制重新加载，确保获取最新配置
  return config.aiAgents || {};
}

export function getAIAgentName(aiAgent) {
  const aiAgents = getAIAgents();
  if (aiAgent && aiAgents[aiAgent]) {
    return aiAgents[aiAgent].name || aiAgent;
  }
  return aiAgent || 'Unknown';
}

export function getConnectionConfig() {
  const config = loadConfig();
  return config.connection || { defaultMode: 'direct', fallbackToRelay: true };
}

export function getServerHttpsPort() {
  const config = loadConfig();
  return config.server.httpsPort || 65437;
}

export function saveConfig(newConfig) {
  const configPath = path.join(__dirname, '..', 'config.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    configCache = newConfig;
    return { success: true };
  } catch (error) {
    console.error('Failed to save config:', error.message);
    return { success: false, error: error.message };
  }
}

export function addAIAgent(agentKey, agentConfig) {
  const config = loadConfig();

  if (!config.aiAgents) {
    config.aiAgents = {};
  }

  if (config.aiAgents[agentKey]) {
    return { success: false, error: 'AI Agent 已存在' };
  }

  config.aiAgents[agentKey] = agentConfig;
  return saveConfig(config);
}

export function updateAIAgent(agentKey, agentConfig) {
  const config = loadConfig();

  if (!config.aiAgents || !config.aiAgents[agentKey]) {
    return { success: false, error: 'AI Agent 不存在' };
  }

  config.aiAgents[agentKey] = { ...config.aiAgents[agentKey], ...agentConfig };
  return saveConfig(config);
}

export function deleteAIAgent(agentKey) {
  const config = loadConfig();

  if (!config.aiAgents || !config.aiAgents[agentKey]) {
    return { success: false, error: 'AI Agent 不存在' };
  }

  delete config.aiAgents[agentKey];
  return saveConfig(config);
}
