import { WebSocketManager } from './websocket.js';
import { Terminal } from './terminal.js';
import { STATUS } from './constants.js';
import { getCurrentLang, setLang, applyTranslations, t } from './i18n.js';

function waitForFitAddon(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.FitAddon) {
      resolve();
      return;
    }
    const startTime = Date.now();
    const check = () => {
      if (window.FitAddon) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('FitAddon load timeout'));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

class App {
  constructor() {
    this.terminal = null;
    this.settings = this.loadSettings();
    this.desktopDisconnected = false;
    this.tabs = this.loadTabs();
    this.currentTabId = this.tabs.length > 0 ? this.tabs[0].id : null;
    this.tabConnections = new Map();
    this.aiAgents = {};

    // AI 完成通知相关
    this.aiThinking = false;
    this.lastOutputTime = 0;
    this.aiCompleteTimer = null;
    this.aiCompleteDelay = 500; // 0.5秒无输出认为完成

    // 命令历史
    this.commandHistory = [];
    this.maxCommandHistory = 100;
    this.historyIndex = -1;

    Object.defineProperty(this, 'wsManager', {
      get() {
        const connection = this.tabConnections.get(this.currentTabId);
        return connection ? connection.wsManager : null;
      }
    });

    this.elements = {
      connectionStatus: document.getElementById('connection-status'),
      statusText: document.getElementById('status-text'),
      terminal: document.getElementById('terminal'),
      commandInput: document.getElementById('command-input'),
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      closeSettings: document.getElementById('close-settings'),
      serverUrl: document.getElementById('server-url'),
      authToken: document.getElementById('auth-token'),
      workDir: document.getElementById('work-dir'),
      aiAgent: document.getElementById('ai-model'),
      aiAgentTrigger: document.getElementById('ai-model-trigger'),
      aiAgentValue: document.getElementById('ai-model-value'),
      aiAgentOptions: document.getElementById('ai-model-options'),
      connectBtn: document.getElementById('connect-btn'),
      disconnectBtn: document.getElementById('disconnect-btn'),
      newTabCheckbox: document.getElementById('new-tab-checkbox'),
      addTabBtn: document.getElementById('add-tab-btn'),
      quickActions: document.getElementById('quick-actions'),
      inputArea: document.getElementById('input-area'),
      currentWorkDir: document.getElementById('current-work-dir'),
      sessionStatusDot: document.getElementById('session-status-dot'),
      sessionStatusText: document.getElementById('session-status-text'),
      latencyContainer: document.getElementById('latency-container'),
      latencyValue: document.getElementById('latency-value'),
      latencyIcon: document.getElementById('latency-icon'),
      tabsList: document.getElementById('tabs-list'),
      addTabBtn: document.getElementById('add-tab-btn'),
      terminalOverlay: document.getElementById('terminal-overlay'),
      fontSizeBtn: document.getElementById('font-size-btn')
    };

    this.init();
  }

  async init() {
    if (!this.checkAuth()) {
      return;
    }
    
    try {
      await waitForFitAddon();
    } catch (e) {
      console.error('Failed to load FitAddon:', e);
      return;
    }
    
    await this.loadAIAgents();
    
    this.terminal = new Terminal(this.elements.terminal, (cols, rows) => {
      this.handleTerminalResize(cols, rows);
    }, (data) => {
      this.handleTerminalInput(data);
    });

    // 加载保存的字体大小
    this.loadFontSize();

    // 初始化语言
    this.initLanguage();

    this.setupEventListeners();
    this.setupVirtualKeyboardHandler();
    this.setupFontSizeHandler();
    this.setupSwipeGesture();
    this.updateConnectionUI(false);
    this.renderTabs();
    this.loadCurrentTabSettings();
    this.loadWorkDirHistory();
  }

  setupVirtualKeyboardHandler() {
    // 使用 visualViewport API 检测软键盘弹出
    if (!window.visualViewport) {
      console.log('[App] visualViewport not supported');
      return;
    }

    const app = document.getElementById('app');

    const handleViewportChange = () => {
      // 获取可视区域相对于整个窗口的偏移
      const viewportHeight = window.visualViewport.height;
      const viewportTop = window.visualViewport.offsetTop;

      // 计算键盘高度（窗口高度 - 可视区域高度）
      const keyboardHeight = window.innerHeight - viewportHeight;

      console.log('[App] Viewport change:', {
        viewportHeight,
        viewportTop,
        keyboardHeight,
        innerHeight: window.innerHeight
      });

      if (keyboardHeight > 100) {
        // 键盘弹出，调整布局
        // 将 app 的高度限制在可视区域内
        app.style.height = `${viewportHeight}px`;

        // 滚动页面以确保终端底部可见
        requestAnimationFrame(() => {
          window.scrollTo(0, 0);
          document.body.scrollTop = 0;
          document.documentElement.scrollTop = 0;
        });

        // 延迟调整终端大小，确保布局稳定后再调整
        setTimeout(() => {
          if (this.terminal) {
            this.terminal.fit(true);
            // 滚动到终端底部，确保输入位置可见
            this.terminal.scrollToBottom();
          }
        }, 150);
      } else {
        // 键盘收起，恢复布局
        app.style.height = '100%';

        // 滚动页面回到顶部
        requestAnimationFrame(() => {
          window.scrollTo(0, 0);
          document.body.scrollTop = 0;
          document.documentElement.scrollTop = 0;
        });

        setTimeout(() => {
          if (this.terminal) {
            this.terminal.fit(true);
            // 滚动到终端底部恢复原位
            this.terminal.scrollToBottom();
          }
        }, 150);
      }
    };

    // 监听 resize 和 scroll 事件
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);

    // 记录以便后续清理
    this._viewportHandler = handleViewportChange;

    // 阻止页面滚动，避免键盘弹出时页面整体滚动
    document.body.addEventListener('touchmove', (e) => {
      if (e.target.closest('#terminal')) {
        // 允许终端内部滚动
        return;
      }
    }, { passive: false });
  }

  setupSwipeGesture() {
    const container = document.getElementById('terminal-container');
    if (!container) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    const swipeThreshold = 80; // 滑动距离阈值
    const maxVerticalDistance = 100; // 最大垂直距离（防止上下滚动时触发）
    const maxSwipeTime = 300; // 最大滑动时间（毫秒）

    // 使用 capture 阶段监听，确保在 xterm.js 之前捕获
    container.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
    }, { passive: true, capture: true });

    container.addEventListener('touchend', (e) => {
      if (this.tabs.length <= 1) return; // 只有一个标签时不切换

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const endTime = Date.now();

      const deltaX = endX - startX;
      const deltaY = Math.abs(endY - startY);
      const deltaTime = endTime - startTime;

      // 检查是否是有效的水平滑动手势
      if (
        deltaTime < maxSwipeTime &&
        deltaY < maxVerticalDistance &&
        Math.abs(deltaX) > swipeThreshold
      ) {
        // 查找当前标签的索引
        const currentIndex = this.tabs.findIndex(t => t.id === this.currentTabId);
        if (currentIndex === -1) return;

        let newIndex;
        if (deltaX > 0) {
          // 右滑 - 切换到下一个标签
          newIndex = currentIndex < this.tabs.length - 1 ? currentIndex + 1 : 0;
        } else {
          // 左滑 - 切换到上一个标签
          newIndex = currentIndex > 0 ? currentIndex - 1 : this.tabs.length - 1;
        }

        const newTab = this.tabs[newIndex];
        if (newTab && newTab.id !== this.currentTabId) {
          this.switchTab(newTab.id);
          this.showTabSwitchIndicator(deltaX > 0 ? 'next' : 'prev', newIndex);
        }
      }
    }, { passive: true, capture: true });
  }

  showTabSwitchIndicator(direction, newIndex) {
    // 创建切换指示器
    let indicator = document.getElementById('tab-switch-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'tab-switch-indicator';
      indicator.style.cssText = `
        position: fixed;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 16px;
        pointer-events: none;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s ease;
      `;
      document.body.appendChild(indicator);
    }

    // 设置箭头方向
    indicator.textContent = direction === 'prev' ? '◀' : '▶';
    indicator.style.left = direction === 'prev' ? '20px' : 'auto';
    indicator.style.right = direction === 'next' ? '20px' : 'auto';

    // 显示并淡出
    indicator.style.opacity = '1';
    setTimeout(() => {
      indicator.style.opacity = '0';
    }, 500);
  }

  loadFontSize() {
    const savedSize = localStorage.getItem('claude-remote-font-size');
    if (savedSize) {
      const size = parseInt(savedSize, 10);
      if (size >= 10 && size <= 28) {
        this.terminal.setFontSize(size);
      }
    }
  }

  initLanguage() {
    const lang = getCurrentLang();
    applyTranslations(lang);
    this.updateLangButton(lang);
  }

  toggleLanguage() {
    const currentLang = getCurrentLang();
    const newLang = currentLang === 'zh' ? 'en' : 'zh';
    setLang(newLang);
    this.updateLangButton(newLang);
  }

  updateLangButton(lang) {
    const langSwitch = document.getElementById('lang-switch');
    if (langSwitch) {
      langSwitch.textContent = lang === 'zh' ? 'EN' : '中文';
    }
  }

  setupFontSizeHandler() {
    const fontSizeBtn = this.elements.fontSizeBtn;
    if (!fontSizeBtn) return;

    const fontSizes = [12, 14, 16, 18, 20];

    // 创建字体选择面板
    let panel = document.createElement('div');
    panel.className = 'font-size-panel hidden';
    panel.id = 'font-size-panel';

    fontSizes.forEach(size => {
      const option = document.createElement('button');
      option.className = 'font-size-option';
      option.dataset.size = size;
      option.textContent = size;
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        this.terminal.setFontSize(size);
        updateActiveOption(size);
        panel.classList.add('hidden');
      });
      panel.appendChild(option);
    });

    // 将面板添加到 body
    document.body.appendChild(panel);

    const updateActiveOption = (currentSize) => {
      panel.querySelectorAll('.font-size-option').forEach(opt => {
        opt.classList.toggle('active', parseInt(opt.dataset.size, 10) === currentSize);
      });
    };

    // 初始化当前选中的字体大小
    updateActiveOption(this.terminal.getFontSize());

    // 点击按钮切换面板
    fontSizeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.classList.toggle('hidden');
      updateActiveOption(this.terminal.getFontSize());
    });

    // 点击其他地方关闭面板
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== fontSizeBtn) {
        panel.classList.add('hidden');
      }
    });
  }

  async loadAIAgents() {
    try {
      const serverUrl = this.elements.serverUrl.value || window.location.origin;
      const response = await fetch(`${serverUrl}/api/ai-agents`);
      const result = await response.json();
      
      if (result.success && result.data) {
        this.aiAgents = result.data;
        this.populateAIAgentDropdown();
      }
    } catch (error) {
      console.error('Failed to load AI agents:', error);
      this.aiAgents = { claude: { name: 'Claude', path: 'claude' } };
      this.populateAIAgentDropdown();
    }
  }

  populateAIAgentDropdown() {
    const select = this.elements.aiAgent;
    const optionsContainer = this.elements.aiAgentOptions;
    
    select.innerHTML = '';
    optionsContainer.innerHTML = '';
    
    const keys = Object.keys(this.aiAgents);
    keys.forEach((key, index) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = this.aiAgents[key].name || key;
      select.appendChild(option);
      
      const customOption = document.createElement('div');
      customOption.className = 'custom-select-option';
      customOption.dataset.value = key;
      customOption.textContent = this.aiAgents[key].name || key;
      customOption.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectAIAgent(key);
      });
      optionsContainer.appendChild(customOption);
    });
    
    if (keys.length > 0) {
      this.selectAIAgent(keys[0]);
    }
    
    this.elements.aiAgentTrigger.addEventListener('click', () => {
      this.elements.aiAgentOptions.classList.toggle('hidden');
      this.elements.aiAgentTrigger.classList.toggle('active');
    });
    
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-select')) {
        this.elements.aiAgentOptions.classList.add('hidden');
        this.elements.aiAgentTrigger.classList.remove('active');
      }
    });
  }

  selectAIAgent(key) {
    const select = this.elements.aiAgent;
    const valueSpan = this.elements.aiAgentValue;
    const options = this.elements.aiAgentOptions.querySelectorAll('.custom-select-option');
    
    select.value = key;
    valueSpan.textContent = this.aiAgents[key].name || key;
    
    options.forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === key);
    });
    
    this.elements.aiAgentOptions.classList.add('hidden');
    this.elements.aiAgentTrigger.classList.remove('active');
  }

  getAIAgentName(aiAgent) {
    if (this.aiAgents && this.aiAgents[aiAgent]) {
      return this.aiAgents[aiAgent].name || aiAgent;
    }
    return aiAgent || '-';
  }

  handleTerminalResize(cols, rows) {
    console.log(`[App] Terminal resized: ${cols}x${rows}`);
    if (this.wsManager && this.wsManager.isConnected) {
      this.wsManager.sendResize(cols, rows);
    }
  }

  handleTerminalInput(data) {
    if (this.wsManager && this.wsManager.isConnected) {
      const size = this.terminal.getSize();
      this.wsManager.sendCommand(data, size.cols, size.rows);
    }
  }

  setupEventListeners() {
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.setAttribute('inputmode', 'none');
      btn.setAttribute('enterkeyhint', 'done');
    });
    
    if (this.elements.settingsBtn) {
      this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
    }
    this.elements.closeSettings.addEventListener('click', () => this.hideSettings());
    this.elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.elements.settingsModal) this.hideSettings();
    });

    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

    this.elements.commandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendCommand();
    });

    this.elements.commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory('down');
      }
    });

    this.elements.quickActions.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.action-btn');
      if (btn && btn.dataset.action) {
        e.preventDefault();
        e.stopPropagation();

        this.handleQuickAction(btn.dataset.action);
      }
    });

    // 语言切换按钮
    const langSwitch = document.getElementById('lang-switch');
    if (langSwitch) {
      langSwitch.addEventListener('click', () => this.toggleLanguage());
    }

    this.elements.serverUrl.addEventListener('change', () => {
      this.saveSettings();
      if (!this.elements.newTabCheckbox.checked) {
        this.updateCurrentTab();
      }
    });
    this.elements.authToken.addEventListener('change', () => {
      this.saveSettings();
      if (!this.elements.newTabCheckbox.checked) {
        this.updateCurrentTab();
      }
    });
    this.elements.workDir.addEventListener('change', () => {
      this.saveSettings();
      if (!this.elements.newTabCheckbox.checked) {
        this.updateCurrentTab();
      }
    });
    this.elements.aiAgent.addEventListener('change', () => {
      this.saveSettings();
      if (!this.elements.newTabCheckbox.checked) {
        this.updateCurrentTab();
      }
    });
    
    this.elements.addTabBtn.addEventListener('click', () => this.addTab());

    // Setup overlay click listener based on settings
    this.setupOverlayClickListener();

    // Listen for overlay click mode changes
    document.querySelectorAll('input[name="overlay-click-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.settings.overlayClickMode = e.target.value;
        this.setupOverlayClickListener();
        this.saveSettings();
      });
    });
  }

  setupOverlayClickListener() {
    const overlay = this.elements.terminalOverlay;
    const eventType = this.settings.overlayClickMode || 'dblclick';

    // Remove existing listener
    overlay.removeEventListener('click', this._overlayClickHandler);
    overlay.removeEventListener('dblclick', this._overlayClickHandler);

    // Create handler if not exists
    if (!this._overlayClickHandler) {
      this._overlayClickHandler = (e) => {
        const unlockCircle = e.target.closest('.unlock-circle');
        if (!unlockCircle) return;

        this.playRippleEffect(e);

        if (overlay.classList.contains('disconnected')) {
          this.animateUnlock(() => {
            this.reconnectTab(this.currentTabId);
          });
          return;
        }

        this.animateUnlock(() => {
          overlay.classList.remove('active');
          if (this.terminal) {
            this.terminal.fit(true);
          }
          if (this.wsManager && this.wsManager.isConnected) {
            const deviceType = this.wsManager.deviceType || 'desktop';
            this.wsManager.sendActive(deviceType);
            this.lockCurrentTab();
          }
        });
      };
    }

    // Add listener with correct event type
    overlay.addEventListener(eventType, this._overlayClickHandler);
  }

  lockCurrentTab() {
    const currentTab = this.tabs.find(t => t.id === this.currentTabId);
    if (currentTab) {
      currentTab.locked = true;
      this.saveTabs();
      this.renderTabs();
    }
  }

  playRippleEffect(e) {
    const overlay = this.elements.terminalOverlay;
    const unlockCircle = overlay.querySelector('.unlock-circle');
    const rippleContainer = overlay.querySelector('.ripple-container');
    if (!rippleContainer || !unlockCircle) return;

    // 获取圆圈的中心位置（相对于ripple-container）
    const circleRect = unlockCircle.getBoundingClientRect();
    const containerRect = overlay.getBoundingClientRect();

    // 计算圆圈中心相对于overlay的位置
    const centerX = circleRect.left - containerRect.left + circleRect.width / 2;
    const centerY = circleRect.top - containerRect.top + circleRect.height / 2;

    // 创建多层涟漪
    const rippleCount = 4;
    const baseDelay = 150;

    for (let i = 0; i < rippleCount; i++) {
      const ripple = document.createElement('div');
      const size = 60 + i * 70;

      ripple.className = `ripple ${i % 2 === 0 ? 'ripple-ring' : 'ripple-fill'}`;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${centerX - size / 2}px`;
      ripple.style.top = `${centerY - size / 2}px`;
      ripple.style.animationDelay = `${i * baseDelay}ms`;

      rippleContainer.appendChild(ripple);

      // 动画结束后移除元素
      ripple.addEventListener('animationend', () => {
        ripple.remove();
      });
    }
  }

  animateUnlock(callback) {
    const overlay = this.elements.terminalOverlay;
    const unlockCircle = overlay.querySelector('.unlock-circle');
    const wasDisconnected = overlay.classList.contains('disconnected');
    const wasActive = overlay.classList.contains('active');
    const triggeredTabId = this.currentTabId;

    if (unlockCircle) {
      unlockCircle.style.transition = 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      unlockCircle.style.opacity = '0';
      unlockCircle.style.transform = 'scale(1.5)';
    }

    setTimeout(() => {
      if (this.currentTabId !== triggeredTabId) return;

      if (callback) callback();

      const stillDisconnected = overlay.classList.contains('disconnected');
      const stillActive = overlay.classList.contains('active');

      if (unlockCircle && stillDisconnected && !stillActive) {
        unlockCircle.style.transition = '';
        unlockCircle.style.opacity = '';
        unlockCircle.style.transform = '';
      }
    }, 800);
  }

  toggleTabLock(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.locked = tab.locked === false ? true : false;
    this.saveTabs();
    this.renderTabs();
  }

  showTabLockHint(tabId) {
    const tabBtn = this.elements.tabsList.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabBtn) return;

    const lockBtn = tabBtn.querySelector('.tab-lock');
    if (lockBtn) {
      lockBtn.classList.add('shake');
      setTimeout(() => lockBtn.classList.remove('shake'), 500);
    }

    // 显示无感提示
    const hint = document.createElement('span');
    hint.className = 'tab-close-hint';
    hint.textContent = '先解锁';
    tabBtn.appendChild(hint);

    setTimeout(() => {
      hint.classList.add('fade-out');
      setTimeout(() => hint.remove(), 300);
    }, 1000);
  }

  async connect() {
    const serverUrl = this.elements.serverUrl.value.trim() || window.location.origin.replace(/^http/, 'ws');
    const token = this.elements.authToken.value.trim();
    const aiAgent = this.elements.aiAgent.value;
    const workDir = this.elements.workDir.value.trim().replace(/\\/g, '/').toLowerCase();
    const createNewTab = this.elements.newTabCheckbox.checked;

    if (!token) {
      alert('请输入Token');
      return;
    }

    if (!workDir) {
      // OpenClaw uses its own workspace, skip directory validation
      if (aiAgent !== 'openclaw') {
        alert('请输入工作目录');
        return;
      }
    }

    try {
      let apiUrl = serverUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
      const response = await fetch(`${apiUrl}/api/validate-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: workDir })
      });

      const result = await response.json();

      if (!result.success) {
        alert(`目录验证失败: ${result.error || '未知错误'}`);
        return;
      }
    } catch (error) {
      alert(`目录验证失败: ${error.message}`);
      return;
    }

    if (createNewTab) {
      const newTab = {
        id: Date.now().toString(),
        name: this.getAIAgentName(aiAgent),
        serverUrl,
        token,
        workDir,
        aiAgent,
        terminalHistory: [],
        locked: true
      };
      
      this.tabs.push(newTab);
      this.saveTabs();
      this.currentTabId = newTab.id;
      this.renderTabs();
      this.loadCurrentTabSettings();
    }

    this.saveSettings();
    this.currentAiAgent = aiAgent;
    this.terminal.setAIAgent(aiAgent);
    this.updateConnectionUI(false, true);
    this.elements.statusText.textContent = '连接中...';

    try {
      const wsManager = new WebSocketManager();
      
      wsManager.on('output', (data) => {
        if (this.currentTabId === this.getCurrentTabIdForWs(wsManager)) {
          console.log('[App] Received output:', data?.content?.substring(0, 100));
          if (data.content) this.terminal.write(data.content);

          // AI 完成检测
          this.handleAIOutput();
        }
      });

      wsManager.on('status', (data) => {
        this.handleStatus(data);
      });

      wsManager.on('control', (data) => {
        if (this.currentTabId === this.getCurrentTabIdForWs(wsManager)) {
          this.handleControl(data);
        }
      });

      wsManager.on('disconnected', () => {
        const tabId = this.getCurrentTabIdForWs(wsManager);
        if (tabId) {
          const connection = this.tabConnections.get(tabId);
          if (connection) {
            connection.isConnected = false;
            this.tabConnections.set(tabId, connection);
            this.renderTabs();
          }
        }

        if (this.currentTabId === tabId) {
          this.updateConnectionUI(false);
          this.desktopDisconnected = false;
          // 隐藏延迟显示
          if (this.elements.latencyContainer) {
            this.elements.latencyContainer.style.display = 'none';
          }
        }
      });

      wsManager.on('latency', (data) => {
        if (this.currentTabId === this.getCurrentTabIdForWs(wsManager)) {
          this.updateLatencyDisplay(data.latency, wsManager.getConnectionQuality());
        }
      });

      // OpenClaw uses its own workspace, submit empty workDir
      const submitWorkDir = aiAgent === 'openclaw' ? '' : workDir;
      const message = await wsManager.connect(serverUrl, token, submitWorkDir, aiAgent);

      this.tabConnections.set(this.currentTabId, {
        wsManager,
        isConnected: true,
        serverUrl,
        token,
        workDir: submitWorkDir,
        aiAgent
      });
      
      this.terminal.fit(true);
      const size = this.terminal.getSize();
      console.log(`[App] Sending initial resize immediately: ${size.cols}x${size.rows}`);
      wsManager.sendResize(size.cols, size.rows);
      
      this.updateConnectionUI(true);
      this.terminal.setConnected(true);
      this.elements.inputArea.classList.add('hidden-input');

      this.saveWorkDirHistory(workDir);

      this.updateSessionInfo(aiAgent, workDir, message.deviceId, true);

      // 连接成功时请求通知权限
      this.requestNotificationPermission();
      
      this.renderTabs();

      this.updateCurrentTab();

      // 连接成功后给当前标签加锁
      this.lockCurrentTab();

      if (message.data?.history?.length > 0) {
        const currentTab = this.tabs.find(t => t.id === this.currentTabId);
        if (currentTab) {
          this.terminal.clear();
          
          currentTab.terminalHistory = message.data.history
            .map(item => ({
              content: item.data?.content || '',
              type: 'default'
            }))
            .filter(item => !this.shouldFilterContent(item.content || ''));
          this.saveTabs();
          
          message.data.history.forEach(item => {
            if (item.data?.content && !this.shouldFilterContent(item.data.content)) {
              this.terminal.write(item.data.content);
            }
          });
        }
      }
      
      this.updateCurrentTab();
      this.hideSettings();
    } catch (error) {
      this.updateConnectionUI(false);
      this.terminal.write(`连接失败: ${error.message || '未知错误'}`, 'error');
    }
  }

  // 内容过滤器 - 过滤掉不需要显示的状态消息
  shouldFilterContent(content) {
    const filters = [
      '[远程控制已连接]',
      '已断开连接',
      '连接成功！',
      '工作目录:',
      'AI Agent:',
      '设备ID:',
      '加载',
      '桌面客户端'
    ];
    return filters.some(pattern => content.includes(pattern));
  }

  getCurrentTabIdForWs(wsManager) {
    for (const [tabId, connection] of this.tabConnections.entries()) {
      if (connection.wsManager === wsManager) {
        return tabId;
      }
    }
    return null;
  }

  disconnect() {
    const connection = this.tabConnections.get(this.currentTabId);
    if (connection && connection.isConnected) {
      connection.wsManager.disconnect();
      connection.isConnected = false;
      this.tabConnections.set(this.currentTabId, connection);
      this.renderTabs();
    }
    this.terminal.setConnected(false);
    this.elements.inputArea.classList.remove('hidden-input');
    this.updateConnectionUI(false);
    this.updateSessionInfo('', '');
    this.saveCurrentTabTerminal();
  }

  sendCommand() {
    const input = this.elements.commandInput.value;
    if (!input) return;

    // 添加到命令历史
    if (input.trim() && (this.commandHistory.length === 0 || this.commandHistory[0] !== input)) {
      this.commandHistory.unshift(input);
      if (this.commandHistory.length > this.maxCommandHistory) {
        this.commandHistory.pop();
      }
    }
    this.historyIndex = -1;

    const size = this.terminal.getSize();
    if (this.wsManager && this.wsManager.sendCommand(input + '\n', size.cols, size.rows)) {
      this.elements.commandInput.value = '';
    } else {
      this.terminal.write('未连接到服务器', 'error');
    }
  }

  // 浏览命令历史
  navigateHistory(direction) {
    if (this.commandHistory.length === 0) return;

    if (direction === 'up') {
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.elements.commandInput.value = this.commandHistory[this.historyIndex];
      }
    } else if (direction === 'down') {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.elements.commandInput.value = this.commandHistory[this.historyIndex];
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1;
        this.elements.commandInput.value = '';
      }
    }
  }

  handleQuickAction(action) {
    if (!this.wsManager) {
      this.terminal.write('未连接到服务器', 'error');
      this.elements.quickActions.classList.remove('expanded');
      return;
    }

    const size = this.terminal.getSize();
    
    switch (action) {
      case 'clear-screen':
        this.terminal.clear();
        break;
      case 'enter':
        this.wsManager.sendCommand('\n', size.cols, size.rows);
        break;
      case 'esc':
        this.wsManager.sendCommand('\x1b', size.cols, size.rows);
        break;
      case 'backspace':
        this.wsManager.sendCommand('\x08', size.cols, size.rows);
        break;
      case 'tab':
        this.wsManager.sendCommand('\t', size.cols, size.rows);
        break;
      case 'up':
        this.wsManager.sendCommand('\x1b[A', size.cols, size.rows);
        break;
      case 'down':
        this.wsManager.sendCommand('\x1b[B', size.cols, size.rows);
        break;
      case 'left':
        this.wsManager.sendCommand('\x1b[D', size.cols, size.rows);
        break;
      case 'right':
        this.wsManager.sendCommand('\x1b[C', size.cols, size.rows);
        break;
      case 'toggle-shortcuts':
        this.elements.quickActions.classList.toggle('expanded');
        return;
      case 'ctrl-c':
        this.wsManager.sendCommand('\x03', size.cols, size.rows);
        this.terminal.write('^C', 'info');
        break;
      case 'ctrl-d':
        this.wsManager.sendCommand('\x04', size.cols, size.rows);
        this.terminal.write('^D', 'info');
        break;
      case 'ctrl-o':
        this.wsManager.sendCommand('\x0f', size.cols, size.rows);
        this.terminal.write('^O', 'info');
        break;
      case 'ctrl-z':
        this.wsManager.sendCommand('\x1a', size.cols, size.rows);
        this.terminal.write('^Z', 'info');
        break;
      case 'num-1':
        this.wsManager.sendCommand('1', size.cols, size.rows);
        break;
      case 'num-2':
        this.wsManager.sendCommand('2', size.cols, size.rows);
        break;
      case 'num-3':
        this.wsManager.sendCommand('3', size.cols, size.rows);
        break;
      case 'num-4':
        this.wsManager.sendCommand('4', size.cols, size.rows);
        break;
      case 'num-5':
        this.wsManager.sendCommand('5', size.cols, size.rows);
        break;
      case 'num-6':
        this.wsManager.sendCommand('6', size.cols, size.rows);
        break;
      case 'num-7':
        this.wsManager.sendCommand('7', size.cols, size.rows);
        break;
      case 'num-8':
        this.wsManager.sendCommand('8', size.cols, size.rows);
        break;
      case 'num-9':
        this.wsManager.sendCommand('9', size.cols, size.rows);
        break;
      case 'bash-mode':
        this.wsManager.sendCommand('!', size.cols, size.rows);
        break;
      case 'slash':
        this.wsManager.sendCommand('/', size.cols, size.rows);
        break;
      case 'at':
        this.wsManager.sendCommand('@', size.cols, size.rows);
        break;
      case 'ampersand':
        this.wsManager.sendCommand('&', size.cols, size.rows);
        break;
      case 'shift-tab':
        this.wsManager.sendCommand('\x1b[Z', size.cols, size.rows);
        break;
      case 'ctrl-t':
        this.wsManager.sendCommand('\x14', size.cols, size.rows);
        break;
      case 'newline':
        this.wsManager.sendCommand('\x0d', size.cols, size.rows);
        break;
      case 'ctrl-shift-minus':
        this.wsManager.sendCommand('\x1f', size.cols, size.rows);
        break;
      case 'alt-v':
        this.wsManager.sendCommand('\x16', size.cols, size.rows);
        break;
      case 'meta-p':
        this.wsManager.sendCommand('\x10', size.cols, size.rows);
        break;
      case 'meta-o':
        this.wsManager.sendCommand('\x0f', size.cols, size.rows);
        break;
      case 'ctrl-s':
        this.wsManager.sendCommand('\x13', size.cols, size.rows);
        break;
      case 'ctrl-g':
        this.wsManager.sendCommand('\x07', size.cols, size.rows);
        break;
      case 'export-log':
        this.exportTerminalLog();
        break;
      case 'search-terminal':
        this.toggleTerminalSearch();
        break;
    }
    
    this.elements.quickActions.classList.remove('expanded');
  }

  handleStatus(data) {
    if (data.deviceType === 'desktop') {
      if (data.status === STATUS.CONNECTED) {
        this.desktopDisconnected = false;
      } else if (data.status === STATUS.DISCONNECTED) {
        this.desktopDisconnected = true;
      }
    } else if (data.deviceType === 'mobile') {
      const sessionKey = data.sessionId;
      if (data.status === STATUS.DISCONNECTED) {
        for (const [tabId, connection] of this.tabConnections.entries()) {
          const connectionSessionKey = `${connection.aiAgent}:${connection.workDir.toLowerCase()}`;
          if (connectionSessionKey === sessionKey) {
            connection.isConnected = false;
            this.tabConnections.set(tabId, connection);
            this.renderTabs();
            
            if (this.currentTabId === tabId) {
              this.updateConnectionUI(false);
            }
            break;
          }
        }
      }
    }
  }

  // AI 完成通知相关方法
  handleAIOutput() {
    // 记录最后输出时间，启动/重置完成检测定时器
    this.lastOutputTime = Date.now();

    if (!this.aiThinking) {
      this.aiThinking = true;
      console.log('[App] AI thinking started');
    }

    // 清除之前的定时器
    if (this.aiCompleteTimer) {
      clearTimeout(this.aiCompleteTimer);
    }

    // 设置新的检测定时器
    this.aiCompleteTimer = setTimeout(() => {
      if (this.aiThinking && Date.now() - this.lastOutputTime >= this.aiCompleteDelay) {
        this.onAIComplete();
      }
    }, this.aiCompleteDelay);
  }

  onAIComplete() {
    console.log('[App] AI thinking completed, sending notification');
    this.aiThinking = false;

    // 发送通知
    this.sendNotification('AI 完成', 'AI 已完成思考，可以继续操作');
  }

  sendNotification(title, body) {
    // 检查是否支持通知
    if (!('Notification' in window)) {
      console.log('[App] Browser does not support notifications');
      return;
    }

    console.log('[App] Notification permission:', Notification.permission);

    // 检查权限
    if (Notification.permission === 'granted') {
      console.log('[App] Showing notification:', title);
      new Notification(title, { body });
    } else {
      console.log('[App] Cannot show notification, permission not granted');
    }
  }

  requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.log('[App] Browser does not support notifications');
      return;
    }

    if (Notification.permission === 'granted') {
      console.log('[App] Notification permission already granted');
      return;
    }

    if (Notification.permission !== 'denied') {
      console.log('[App] Requesting notification permission on connect');
      Notification.requestPermission().then(permission => {
        console.log('[App] Permission result:', permission);
        if (permission === 'granted') {
          // 显示测试通知
          new Notification('通知已启用', { body: 'AI 完成时会收到通知' });
        }
      });
    } else {
      console.log('[App] Notification permission was denied before');
    }
  }

  exportTerminalLog() {
    const content = this.terminal.exportContent();
    if (!content || content.trim().length === 0) {
      alert('终端内容为空，无法导出');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `terminal-log-${timestamp}.txt`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 终端搜索功能
  toggleTerminalSearch() {
    let searchBox = document.getElementById('terminal-search-box');

    if (!searchBox) {
      // 创建搜索框
      searchBox = document.createElement('div');
      searchBox.id = 'terminal-search-box';
      searchBox.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 8px;
        z-index: 100;
        display: flex;
        gap: 8px;
        align-items: center;
      `;

      searchBox.innerHTML = `
        <input type="text" id="terminal-search-input" placeholder="搜索..." style="
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 4px 8px;
          color: var(--text-primary);
          width: 200px;
        ">
        <button id="terminal-search-prev" style="
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 4px 8px;
          color: var(--text-primary);
          cursor: pointer;
        ">↑</button>
        <button id="terminal-search-next" style="
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 4px 8px;
          color: var(--text-primary);
          cursor: pointer;
        ">↓</button>
        <span id="terminal-search-count" style="
          color: var(--text-secondary);
          font-size: 12px;
          min-width: 50px;
        "></span>
        <button id="terminal-search-close" style="
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 16px;
        ">×</button>
      `;

      const terminalContainer = document.getElementById('terminal-container');
      terminalContainer.style.position = 'relative';
      terminalContainer.appendChild(searchBox);

      // 绑定事件
      const searchInput = document.getElementById('terminal-search-input');
      const prevBtn = document.getElementById('terminal-search-prev');
      const nextBtn = document.getElementById('terminal-search-next');
      const closeBtn = document.getElementById('terminal-search-close');

      searchInput.addEventListener('input', () => this.performSearch());
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.performSearch();
        }
      });

      prevBtn.addEventListener('click', () => this.navigateSearch(-1));
      nextBtn.addEventListener('click', () => this.navigateSearch(1));
      closeBtn.addEventListener('click', () => this.closeTerminalSearch());

      this.searchResults = [];
      this.searchIndex = -1;
    } else {
      searchBox.style.display = searchBox.style.display === 'none' ? 'flex' : 'none';
    }

    // 聚焦输入框
    const input = document.getElementById('terminal-search-input');
    if (input && searchBox.style.display !== 'none') {
      input.focus();
    }
  }

  performSearch() {
    const input = document.getElementById('terminal-search-input');
    const keyword = input?.value?.trim();

    if (!keyword) {
      this.searchResults = [];
      this.searchIndex = -1;
      this.updateSearchCount();
      return;
    }

    this.searchResults = this.terminal.search(keyword);
    this.searchIndex = this.searchResults.length > 0 ? 0 : -1;
    this.updateSearchCount();

    if (this.searchResults.length > 0) {
      this.terminal.scrollToLine(this.searchResults[0].line);
    }
  }

  navigateSearch(direction) {
    if (this.searchResults.length === 0) return;

    this.searchIndex += direction;

    if (this.searchIndex < 0) {
      this.searchIndex = this.searchResults.length - 1;
    } else if (this.searchIndex >= this.searchResults.length) {
      this.searchIndex = 0;
    }

    this.terminal.scrollToLine(this.searchResults[this.searchIndex].line);
    this.updateSearchCount();
  }

  updateSearchCount() {
    const countEl = document.getElementById('terminal-search-count');
    if (countEl) {
      if (this.searchResults.length === 0) {
        countEl.textContent = '无结果';
      } else {
        countEl.textContent = `${this.searchIndex + 1}/${this.searchResults.length}`;
      }
    }
  }

  closeTerminalSearch() {
    const searchBox = document.getElementById('terminal-search-box');
    if (searchBox) {
      searchBox.style.display = 'none';
    }
    this.searchResults = [];
    this.searchIndex = -1;
  }

  handleControl(data) {
    if (data.action === 'switch_device') {
      this.terminal.write(`设备切换: ${data.activeDevice}`, 'info');
    }
    if (data.action === 'showOverlay') {
      // 已连接但非激活状态：显示"点亮激活"蒙版
      const overlay = this.elements.terminalOverlay;
      const overlayText = overlay.querySelector('.overlay-text');
      overlay.classList.remove('disconnected', 'unlocking');
      overlay.classList.add('active');
      if (overlayText) overlayText.textContent = '点亮激活';
    }
  }

  updateConnectionUI(connected, connecting = false) {
    this.elements.sessionStatusDot.className = 'status-dot';
    this.elements.commandInput.disabled = !connected;

    const overlay = this.elements.terminalOverlay;
    const overlayText = overlay.querySelector('.overlay-text');

    if (connected) {
      overlay.classList.remove('disconnected', 'unlocking');
      this.elements.sessionStatusDot.classList.add('connected');
      this.elements.sessionStatusText.textContent = '已连接';
      this.elements.sessionStatusText.style.color = '#00ff00';
      this.elements.connectBtn.classList.add('hidden');
      this.elements.disconnectBtn.classList.remove('hidden');
      // 显示延迟容器（初始值待更新）
      if (this.elements.latencyContainer) {
        this.elements.latencyContainer.style.display = 'flex';
        this.elements.latencyValue.textContent = '-';
        if (this.elements.latencyIcon) {
          this.elements.latencyIcon.className = 'info-icon';
        }
      }
    } else if (connecting) {
      overlay.classList.remove('disconnected', 'unlocking');
      this.elements.sessionStatusDot.classList.add('connecting');
      this.elements.sessionStatusText.textContent = '连接中...';
      // 隐藏延迟容器
      if (this.elements.latencyContainer) {
        this.elements.latencyContainer.style.display = 'none';
      }
    } else {
      const unlockCircle = overlay.querySelector('.unlock-circle');
      if (unlockCircle) {
        unlockCircle.style.transition = 'none';
        unlockCircle.style.opacity = '1';
        unlockCircle.style.transform = 'scale(1)';
        void unlockCircle.offsetWidth;
        unlockCircle.style.transition = '';
      }

      overlay.classList.remove('active', 'unlocking');
      overlay.classList.add('disconnected');
      if (overlayText) overlayText.textContent = '已断开';

      this.elements.sessionStatusText.textContent = '已断开';
      this.elements.sessionStatusText.style.color = '#ff0000';
      this.elements.connectBtn.classList.remove('hidden');
      this.elements.disconnectBtn.classList.add('hidden');
      // 隐藏延迟容器
      if (this.elements.latencyContainer) {
        this.elements.latencyContainer.style.display = 'none';
      }
    }
  }

  updateLatencyDisplay(latency, quality) {
    if (!this.elements.latencyContainer) return;

    if (latency === null) {
      this.elements.latencyContainer.style.display = 'none';
      return;
    }

    this.elements.latencyContainer.style.display = 'flex';
    this.elements.latencyValue.textContent = `${latency}ms`;

    // 更新图标颜色
    const qualityConfig = {
      excellent: { name: '极好', color: '#4ade80' },
      good: { name: '良好', color: '#a3e635' },
      fair: { name: '一般', color: '#fbbf24' },
      poor: { name: '较差', color: '#f87171' }
    };

    const config = qualityConfig[quality] || qualityConfig.good;
    if (this.elements.latencyIcon) {
      this.elements.latencyIcon.className = `info-icon ${quality}`;
      this.elements.latencyIcon.title = config.name;
    }
    this.elements.latencyValue.style.color = config.color;
  }

  updateSessionInfo(aiAgent, workDir, deviceId = '', connected = false) {
    this.elements.currentWorkDir.textContent = workDir || '-';
  }

  loadTabs() {
    const saved = localStorage.getItem('claude-remote-tabs');
    return saved ? JSON.parse(saved) : [];
  }

  saveTabs() {
    localStorage.setItem('claude-remote-tabs', JSON.stringify(this.tabs));
  }

  renderTabs() {
    this.elements.tabsList.innerHTML = '';

    this.tabs.forEach(tab => {
      const connection = this.tabConnections.get(tab.id);
      const isConnected = connection && connection.isConnected;
      const isLocked = tab.locked !== false; // 默认锁定

      const tabBtn = document.createElement('button');
      tabBtn.className = `tab-btn ${tab.id === this.currentTabId ? 'active' : ''} ${isConnected ? 'connected' : ''} ${isLocked ? 'locked' : ''}`;
      tabBtn.dataset.tabId = tab.id;

      const label = document.createElement('span');
      label.className = 'tab-label';
      const agentName = this.getAIAgentName(tab.aiAgent);
      label.textContent = tab.name || agentName || '-';

      const lockBtn = document.createElement('span');
      lockBtn.className = `tab-lock ${isLocked ? 'locked' : 'unlocked'}`;
      if (isLocked) {
        lockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>';
        lockBtn.title = '点击解锁后可关闭';
      } else {
        lockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>';
        lockBtn.title = '已解锁，可关闭';
      }
      lockBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleTabLock(tab.id);
      };

      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };

      tabBtn.appendChild(lockBtn);
      tabBtn.appendChild(label);
      tabBtn.appendChild(closeBtn);
      tabBtn.onclick = () => this.switchTab(tab.id);

      // 添加拖拽排序事件
      this.setupTabDrag(tabBtn, tab.id);

      this.elements.tabsList.appendChild(tabBtn);
    });
  }

  setupTabDrag(tabBtn, tabId) {
    let longPressTimer = null;
    let isDragging = false;
    let isLongPress = false;
    let draggedElement = null;
    let placeholder = null;
    let startX = 0;
    let startY = 0;
    const longPressDelay = 400; // 长按触发时间
    const moveThreshold = 10; // 移动阈值，超过此距离才取消长按

    const clearDragState = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      tabBtn.classList.remove('long-press-ready');
      if (isDragging) {
        isDragging = false;
        if (draggedElement) {
          draggedElement.classList.remove('dragging');
          draggedElement.style.transform = '';
          draggedElement.style.opacity = '';
        }
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
        }
        draggedElement = null;
        placeholder = null;
      }
      isLongPress = false;
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    };

    const startDrag = (clientX, clientY) => {
      isDragging = true;
      isLongPress = true;
      draggedElement = tabBtn;
      draggedElement.classList.remove('long-press-ready');
      draggedElement.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      // 触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(30);
      }

      // 创建占位符
      placeholder = document.createElement('div');
      placeholder.className = 'tab-placeholder';
      placeholder.style.width = `${tabBtn.offsetWidth}px`;
      placeholder.style.height = `${tabBtn.offsetHeight}px`;
      tabBtn.parentNode.insertBefore(placeholder, tabBtn);
    };

    const handleMove = (clientX) => {
      if (!isDragging || !draggedElement) return;

      const tabsList = this.elements.tabsList;
      const children = Array.from(tabsList.children);
      const tabButtons = children.filter(c => c.classList.contains('tab-btn'));

      // 找到鼠标所在位置的目标索引
      // 从左到右扫描，找到第一个 midpoint > clientX 的标签，该标签之前的位置就是目标
      let targetIdx = 0;
      for (let i = 0; i < tabButtons.length; i++) {
        const rect = tabButtons[i].getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (clientX < midX) {
          targetIdx = i;
          break;
        }
        targetIdx = i + 1;
      }

      // 如果目标位置是占位符当前位置，不操作
      const currentPlaceholderIdx = children.indexOf(placeholder);
      if (targetIdx === currentPlaceholderIdx) return;

      // 移动占位符到目标位置
      const targetChild = children[targetIdx];
      if (targetChild === placeholder) return;

      if (targetIdx < currentPlaceholderIdx) {
        // 向左移动：插到目标元素之前
        tabsList.insertBefore(placeholder, targetChild);
      } else {
        // 向右移动：插到目标元素之后（下一个兄弟元素之前）
        tabsList.insertBefore(placeholder, targetChild.nextSibling);
      }
    };

    const handleEnd = () => {
      if (!isDragging) {
        clearDragState();
        return;
      }

      // 计算新顺序
      const tabsList = this.elements.tabsList;
      const newOrder = [];
      let placeholderIdx = -1;
      tabsList.querySelectorAll('.tab-btn, .tab-placeholder').forEach(el => {
        if (el.classList.contains('tab-placeholder')) {
          placeholderIdx = newOrder.length;
          newOrder.push(tabId);
        } else if (el.dataset.tabId) {
          newOrder.push(el.dataset.tabId);
        }
      });

      // 重新排序 tabs 数组
      // 拖拽的 tab 用 placeholderIdx（目标位置），其他 tab 用 indexOf（首个出现位置）
      this.tabs.sort((a, b) => {
        const aIdx = a.id === tabId ? placeholderIdx : newOrder.indexOf(a.id);
        const bIdx = b.id === tabId ? placeholderIdx : newOrder.indexOf(b.id);
        return aIdx - bIdx;
      });
      this.saveTabs();

      clearDragState();
      this.renderTabs();
    };

    // 阻止右键菜单
    tabBtn.addEventListener('contextmenu', (e) => {
      if (isLongPress) {
        e.preventDefault();
      }
    });

    // 触摸事件
    tabBtn.addEventListener('touchstart', (e) => {
      if (e.target.closest('.tab-lock') || e.target.closest('.tab-close')) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;

      // 立即禁止选择
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      // 添加预备状态样式
      tabBtn.classList.add('long-press-ready');

      longPressTimer = setTimeout(() => {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }, longPressDelay);
    }, { passive: true });

    tabBtn.addEventListener('touchmove', (e) => {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const moveDistance = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));

      // 只有移动距离超过阈值才取消长按
      if (longPressTimer && moveDistance > moveThreshold) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        tabBtn.classList.remove('long-press-ready');
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
      }

      if (isDragging) {
        e.preventDefault();
        handleMove(currentX);
      }
    }, { passive: false });

    tabBtn.addEventListener('touchend', (e) => {
      if (isDragging) {
        e.preventDefault();
      }
      handleEnd();
    });
    tabBtn.addEventListener('touchcancel', clearDragState);

    // 鼠标事件（桌面端）
    tabBtn.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tab-lock') || e.target.closest('.tab-close')) return;
      if (e.button !== 0) return; // 只响应左键

      startX = e.clientX;
      startY = e.clientY;

      tabBtn.classList.add('long-press-ready');
      document.body.style.userSelect = 'none';

      longPressTimer = setTimeout(() => {
        startDrag(e.clientX, e.clientY);
      }, longPressDelay);
    });

    tabBtn.addEventListener('mousemove', (e) => {
      const moveDistance = Math.sqrt(Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2));

      if (longPressTimer && moveDistance > moveThreshold) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        tabBtn.classList.remove('long-press-ready');
      }
      if (isDragging) {
        e.preventDefault();
        handleMove(e.clientX);
      }
    });

    tabBtn.addEventListener('mouseup', handleEnd);
    tabBtn.addEventListener('mouseleave', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        tabBtn.classList.remove('long-press-ready');
        document.body.style.userSelect = '';
      }
    });
  }

  toggleTabLock(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.locked = tab.locked === false ? true : false;
    this.saveTabs();
    this.renderTabs();
  }

  loadCurrentTabSettings() {
    if (!this.currentTabId) return;
    
    const currentTab = this.tabs.find(t => t.id === this.currentTabId);
    if (currentTab) {
      this.elements.serverUrl.value = currentTab.serverUrl || '';
      this.elements.authToken.value = currentTab.token || '';
      this.elements.workDir.value = currentTab.workDir || '';
      this.elements.aiAgent.value = currentTab.aiAgent || 'claude';
      this.updateSessionInfo(currentTab.aiAgent, currentTab.workDir);
    }
  }

  addTab() {
    this.showSettings();
  }

  switchTab(tabId) {
    if (this.currentTabId === tabId) return;
    
    this.saveCurrentTabTerminal();
    
    this.currentTabId = tabId;
    this.renderTabs();
    this.loadCurrentTabSettings();
    this.loadCurrentTabTerminal();
    
    const connection = this.tabConnections.get(tabId);
    if (connection && connection.isConnected) {
      this.updateConnectionUI(true);
      this.terminal.fit(true);
      const size = this.terminal.getSize();
      console.log(`[App] SwitchTab: sending resize ${size.cols}x${size.rows}`);
      connection.wsManager.sendResize(size.cols, size.rows);
    } else {
      this.updateConnectionUI(false);
    }
  }

  reconnectTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    this.switchTab(tabId);
    
    const originalChecked = this.elements.newTabCheckbox.checked;
    this.elements.newTabCheckbox.checked = false;
    this.connect();
    this.elements.newTabCheckbox.checked = originalChecked;
  }

  closeTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // 检查是否锁定
    if (tab.locked !== false) {
      this.showTabLockHint(tabId);
      return;
    }

    const connection = this.tabConnections.get(tabId);
    if (connection && connection.isConnected) {
      connection.wsManager.disconnect();
    }
    this.tabConnections.delete(tabId);

    if (this.currentTabId === tabId) {
      const currentIndex = this.tabs.findIndex(t => t.id === tabId);
      const newIndex = currentIndex > 0 ? currentIndex - 1 : (this.tabs.length > 1 ? 1 : 0);
      if (this.tabs.length > 1) {
        this.currentTabId = this.tabs[newIndex]?.id || this.tabs[0]?.id;
      } else {
        this.currentTabId = null;
      }
    }

    this.tabs = this.tabs.filter(t => t.id !== tabId);
    this.saveTabs();
    this.renderTabs();
    this.loadCurrentTabSettings();
  }

  showTabLockHint(tabId) {
    const tabBtn = this.elements.tabsList.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabBtn) return;

    const lockBtn = tabBtn.querySelector('.tab-lock');
    if (lockBtn) {
      lockBtn.classList.add('shake');
      setTimeout(() => lockBtn.classList.remove('shake'), 500);
    }

    // 显示无感提示
    const hint = document.createElement('span');
    hint.className = 'tab-close-hint';
    hint.textContent = '先解锁';
    tabBtn.appendChild(hint);

    setTimeout(() => {
      hint.classList.add('fade-out');
      setTimeout(() => hint.remove(), 300);
    }, 1000);
  }

  updateCurrentTab() {
    if (!this.currentTabId) return;
    
    const currentTab = this.tabs.find(t => t.id === this.currentTabId);
    if (currentTab) {
      currentTab.serverUrl = this.elements.serverUrl.value.trim();
      currentTab.token = this.elements.authToken.value.trim();
      currentTab.workDir = this.elements.workDir.value.trim();
      currentTab.aiAgent = this.elements.aiAgent.value;
      
      const agentName = this.getAIAgentName(currentTab.aiAgent);
      currentTab.name = agentName;
      
      this.saveTabs();
      this.renderTabs();
    }
  }

  saveCurrentTabTerminal() {
    if (!this.currentTabId) return;
    
    const currentTab = this.tabs.find(t => t.id === this.currentTabId);
    if (currentTab && this.terminal) {
      currentTab.terminalHistory = this.terminal.getHistory();
      this.saveTabs();
    }
  }

  loadCurrentTabTerminal() {
    if (!this.currentTabId) return;

    const currentTab = this.tabs.find(t => t.id === this.currentTabId);
    if (currentTab && this.terminal) {
      this.terminal.clear();
      if (currentTab.terminalHistory && currentTab.terminalHistory.length > 0) {
        currentTab.terminalHistory.forEach(line => {
          if (!this.shouldFilterContent(line.content || '')) {
            this.terminal.write(line.content, line.type || 'default');
          }
        });
      }
    }
  }

  showSettings() {
    this.elements.settingsModal.classList.remove('hidden');
    this.elements.connectBtn.classList.remove('hidden');
    this.elements.disconnectBtn.classList.add('hidden');
    // 隐藏蒙版，避免遮挡设置框
    this.elements.terminalOverlay.classList.remove('disconnected', 'active');
  }
  hideSettings() {
    this.elements.settingsModal.classList.add('hidden');
    // 如果当前标签未连接，恢复显示断开蒙版
    const connection = this.tabConnections.get(this.currentTabId);
    const isConnected = connection && connection.isConnected;
    if (!isConnected) {
      this.elements.terminalOverlay.classList.add('disconnected');
    }
  }

  checkAuth() {
    const authPassword = document.getElementById('auth-password');
    const authScreen = document.getElementById('auth-screen');
    const app = document.getElementById('app');
    
    const isAuthenticated = localStorage.getItem('claude-remote-authenticated');
    
    if (isAuthenticated === 'true') {
      authScreen.classList.add('hidden');
      app.classList.remove('hidden');
      return true;
    }
    
    authPassword.focus();
    
    const handleAuth = (e) => {
      if (e.key === 'Enter') {
        const password = authPassword.value;
        
        fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            localStorage.setItem('claude-remote-authenticated', 'true');
            authScreen.classList.add('hidden');
            app.classList.remove('hidden');
            authPassword.removeEventListener('keypress', handleAuth);
            this.init().catch(err => console.error('Init error:', err));
          } else {
            authPassword.value = '';
          }
        })
        .catch(err => {
          console.error('Auth error:', err);
          authPassword.value = '';
        });
      }
    };
    
    authPassword.addEventListener('keypress', handleAuth);
    return false;
  }

  loadSettings() {
    const saved = localStorage.getItem('claude-remote-settings');
    const defaults = { serverUrl: '', token: '', workDir: '', aiAgent: 'claude', overlayClickMode: 'dblclick' };
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  }

  saveSettings() {
    const overlayMode = document.querySelector('input[name="overlay-click-mode"]:checked');
    this.settings = {
      serverUrl: this.elements.serverUrl.value.trim(),
      token: this.elements.authToken.value.trim(),
      workDir: this.elements.workDir.value.trim(),
      aiAgent: this.elements.aiAgent.value,
      overlayClickMode: overlayMode ? overlayMode.value : 'dblclick'
    };
    localStorage.setItem('claude-remote-settings', JSON.stringify(this.settings));
  }

  loadSettingsToForm() {
    this.elements.serverUrl.value = this.settings.serverUrl || '';
    this.elements.authToken.value = this.settings.token || '';
    this.elements.workDir.value = this.settings.workDir || '';
    this.elements.aiAgent.value = this.settings.aiAgent || 'claude';

    // Load overlay click mode
    const overlayMode = this.settings.overlayClickMode || 'dblclick';
    const radioBtn = document.querySelector(`input[name="overlay-click-mode"][value="${overlayMode}"]`);
    if (radioBtn) radioBtn.checked = true;
  }

  loadWorkDirHistory() {
    const history = JSON.parse(localStorage.getItem('claude-remote-work-dir-history') || '[]');
    const dropdown = document.getElementById('work-dir-dropdown');
    dropdown.innerHTML = '';
    
    history.forEach(dir => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = dir;
      item.addEventListener('click', () => {
        this.elements.workDir.value = dir;
        this.hideWorkDirDropdown();
      });
      dropdown.appendChild(item);
    });
    
    if (!this.workDirDropdownSetup) {
      this.setupWorkDirDropdownEvents();
      this.workDirDropdownSetup = true;
    }
  }

  setupWorkDirDropdownEvents() {
    const workDirInput = this.elements.workDir;
    const dropdown = document.getElementById('work-dir-dropdown');
    
    workDirInput.addEventListener('focus', () => {
      this.showWorkDirDropdown();
    });
    
    workDirInput.addEventListener('input', () => {
      this.filterWorkDirDropdown(workDirInput.value);
    });
    
    document.addEventListener('click', (e) => {
      if (!workDirInput.contains(e.target) && !dropdown.contains(e.target)) {
        this.hideWorkDirDropdown();
      }
    });
  }

  showWorkDirDropdown() {
    const dropdown = document.getElementById('work-dir-dropdown');
    dropdown.classList.remove('hidden');
  }

  hideWorkDirDropdown() {
    const dropdown = document.getElementById('work-dir-dropdown');
    dropdown.classList.add('hidden');
  }

  filterWorkDirDropdown(filterText) {
    const dropdown = document.getElementById('work-dir-dropdown');
    const items = dropdown.querySelectorAll('.dropdown-item');
    const filter = filterText.toLowerCase();
    
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      if (text.includes(filter)) {
        item.style.display = 'block';
      } else {
        item.style.display = 'none';
      }
    });
    
    this.validateWorkDir(filterText);
  }

  async validateWorkDir(directory) {
    const validationEl = document.getElementById('work-dir-validation');
    const iconEl = validationEl.querySelector('.validation-icon');
    const messageEl = validationEl.querySelector('.validation-message');
    
    if (!directory || directory.trim() === '') {
      validationEl.classList.add('hidden');
      return;
    }
    
    validationEl.classList.remove('hidden', 'valid', 'invalid');
    validationEl.classList.add('validating');
    messageEl.textContent = '正在验证目录...';
    
    try {
      let serverUrl = this.elements.serverUrl.value || window.location.origin;
      serverUrl = serverUrl.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
      const response = await fetch(`${serverUrl}/api/validate-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: directory.trim() })
      });
      
      const result = await response.json();
      
      validationEl.classList.remove('validating');
      
      if (result.success) {
        validationEl.classList.add('valid');
        messageEl.textContent = result.message || '目录有效';
      } else {
        validationEl.classList.add('invalid');
        messageEl.textContent = result.error || '目录验证失败';
      }
    } catch (error) {
      validationEl.classList.remove('validating');
      validationEl.classList.add('invalid');
      messageEl.textContent = '验证失败: ' + error.message;
    }
  }

  saveWorkDirHistory(workDir) {
    if (!workDir || workDir.trim() === '') {
      return;
    }
    
    const history = JSON.parse(localStorage.getItem('claude-remote-work-dir-history') || '[]');
    const cleanDir = workDir.trim();
    
    const index = history.indexOf(cleanDir);
    if (index > -1) {
      history.splice(index, 1);
    }
    
    history.unshift(cleanDir);
    
    const maxHistory = 10;
    if (history.length > maxHistory) {
      history.splice(maxHistory);
    }
    
    localStorage.setItem('claude-remote-work-dir-history', JSON.stringify(history));
    this.loadWorkDirHistory();
  }
}

window.__app = new App();
