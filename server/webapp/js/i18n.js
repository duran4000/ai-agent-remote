// 国际化配置
const i18n = {
  zh: {
    // 标题
    title: 'Claude Remote Control',

    // 状态
    'status.disconnected': '已断开',
    'status.notConnected': '未连接',
    'status.connected': '已连接',
    'status.connecting': '连接中...',

    // 头部
    'header.newTab': '新建标签',
    'header.settings': '系统设置',

    // 会话信息
    'session.workDir': '工作目录:',
    'session.latency': '延迟:',

    // 终端
    'terminal.placeholder': '输入命令...',
    'terminal.overlay.disconnected': '已断开',

    // 快捷按钮
    'btn.esc': '退出/取消',
    'btn.more': '展开更多',
    'btn.prevCmd': '上一条命令',
    'btn.nextCmd': '下一条命令',
    'btn.left': '左移',
    'btn.right': '右移',
    'btn.fontSize': '调整字体',
    'btn.backspace': '退格',
    'btn.enter': '回车',
    'btn.clear': '清屏',
    'btn.tab': '自动补全',
    'btn.exportLog': '导出日志',
    'btn.search': '搜索',
    'search.placeholder': '搜索终端内容...',
    'search.noResults': '无匹配结果',
    'search.prev': '上一个',
    'search.next': '下一个',
    'btn.interrupt': '中断',
    'btn.exit': '退出',
    'btn.options': '选项',
    'btn.undo': '撤销',
    'btn.switchTask': '切换任务',
    'btn.save': '暂存',
    'btn.editor': '编辑器',
    'btn.pasteImg': '粘贴图片',
    'btn.switchModel': '切换模型',
    'btn.fastMode': '快速模式',
    'btn.autoAccept': '自动接受',
    'btn.newline': '换行',
    'btn.bashMode': 'Bash模式',
    'btn.command': '命令',
    'btn.filePath': '文件路径',
    'btn.background': '后台',

    // 设置模态框
    'settings.title': '设置',
    'settings.tabConnection': '连接',
    'settings.tabSession': '会话',
    'settings.serverUrl': '服务器地址',
    'settings.authToken': '认证Token',
    'settings.authTokenPlaceholder': '输入Token',
    'settings.workDir': '工作目录',
    'settings.workDirPlaceholder': '如: E:/MyCode/python/my-project',
    'settings.workDirHint': 'AI Agent将在此目录下运行',
    'settings.newTab': '新建标签',
    'settings.overlayMode': '蒙版激活',
    'settings.doubleClick': '双击',
    'settings.singleClick': '单击',
    'settings.longPress': '长按',
    'settings.connect': '连接',
    'settings.disconnect': '断开连接',

    // 语言
    'lang.switch': '切换语言',
    'lang.zh': '中文',
    'lang.en': 'English',

    // 管理页面
    'admin.title': '系统设置 - Claude Remote Control',
    'admin.header': '系统设置',
    'admin.backToTerminal': '返回终端',
    'admin.tab.aiAgents': 'AI Agents',
    'admin.tab.server': '服务器',
    'admin.tab.session': '会话',
    'admin.agents.title': 'AI Agent 管理',
    'admin.agents.add': '+ 添加 Agent',
    'admin.agents.name': '显示名称',
    'admin.agents.command': '启动命令',
    'admin.agents.path': '备用路径',
    'admin.agents.pathHint': '当命令不在 PATH 中时使用的完整路径',
    'admin.agents.builtin': '内置',
    'admin.agents.custom': '自定义',
    'admin.agents.edit': '编辑',
    'admin.agents.delete': '删除',
    'admin.agents.confirmDelete': '确定删除此 Agent?',
    'admin.server.title': '服务器配置',
    'admin.server.host': '监听地址',
    'admin.server.httpPort': 'HTTP 端口',
    'admin.server.httpsPort': 'HTTPS 端口',
    'admin.server.token': '认证 Token',
    'admin.server.password': '认证密码',
    'admin.server.toggleVisibility': '显示/隐藏',
    'admin.server.hint': '服务器配置需在 config.json 中修改，修改后需重启服务生效',
    'admin.session.title': '会话配置',
    'admin.session.maxHistory': '最大历史记录数',
    'admin.session.timeout': '会话超时 (毫秒)',
    'admin.session.hint': '会话配置需在 config.json 中修改',
    'admin.modal.add': '添加 AI Agent',
    'admin.modal.edit': '编辑 AI Agent',
    'admin.modal.nameLabel': '显示名称 *',
    'admin.modal.namePlaceholder': '如: Claude',
    'admin.modal.commandLabel': '启动命令 *',
    'admin.modal.commandPlaceholder': '如: claude',
    'admin.modal.pathLabel': '备用路径',
    'admin.modal.pathPlaceholder': '如: C:\\Users\\xxx\\.local\\bin\\claude.exe',
    'admin.modal.save': '保存',
    'admin.modal.cancel': '取消'
  },

  en: {
    // Title
    title: 'Claude Remote Control',

    // Status
    'status.disconnected': 'Disconnected',
    'status.notConnected': 'Not Connected',
    'status.connected': 'Connected',
    'status.connecting': 'Connecting...',

    // Header
    'header.newTab': 'New Tab',
    'header.settings': 'Settings',

    // Session Info
    'session.workDir': 'Work Dir:',
    'session.latency': 'Latency:',

    // Terminal
    'terminal.placeholder': 'Enter command...',
    'terminal.overlay.disconnected': 'Disconnected',

    // Quick Buttons
    'btn.esc': 'Exit/Cancel',
    'btn.more': 'More',
    'btn.prevCmd': 'Previous Command',
    'btn.nextCmd': 'Next Command',
    'btn.left': 'Left',
    'btn.right': 'Right',
    'btn.fontSize': 'Font Size',
    'btn.backspace': 'Backspace',
    'btn.enter': 'Enter',
    'btn.clear': 'Clear',
    'btn.tab': 'Tab',
    'btn.exportLog': 'Export Log',
    'btn.search': 'Search',
    'search.placeholder': 'Search terminal...',
    'search.noResults': 'No results',
    'search.prev': 'Previous',
    'search.next': 'Next',
    'btn.interrupt': 'Interrupt',
    'btn.exit': 'Exit',
    'btn.options': 'Options',
    'btn.undo': 'Undo',
    'btn.switchTask': 'Switch Task',
    'btn.save': 'Save',
    'btn.editor': 'Editor',
    'btn.pasteImg': 'Paste Image',
    'btn.switchModel': 'Switch Model',
    'btn.fastMode': 'Fast Mode',
    'btn.autoAccept': 'Auto Accept',
    'btn.newline': 'Newline',
    'btn.bashMode': 'Bash Mode',
    'btn.command': 'Command',
    'btn.filePath': 'File Path',
    'btn.background': 'Background',

    // Settings Modal
    'settings.title': 'Settings',
    'settings.tabConnection': 'Connection',
    'settings.tabSession': 'Session',
    'settings.serverUrl': 'Server URL',
    'settings.authToken': 'Auth Token',
    'settings.authTokenPlaceholder': 'Enter Token',
    'settings.workDir': 'Work Directory',
    'settings.workDirPlaceholder': 'e.g.: E:/MyCode/python/my-project',
    'settings.workDirHint': 'AI Agent will run in this directory',
    'settings.newTab': 'New Tab',
    'settings.overlayMode': 'Overlay Mode',
    'settings.doubleClick': 'Double Click',
    'settings.singleClick': 'Single Click',
    'settings.longPress': 'Long Press',
    'settings.connect': 'Connect',
    'settings.disconnect': 'Disconnect',

    // Language
    'lang.switch': 'Switch Language',
    'lang.zh': '中文',
    'lang.en': 'English',

    // Admin Page
    'admin.title': 'Settings - Claude Remote Control',
    'admin.header': 'Settings',
    'admin.backToTerminal': 'Back to Terminal',
    'admin.tab.aiAgents': 'AI Agents',
    'admin.tab.server': 'Server',
    'admin.tab.session': 'Session',
    'admin.agents.title': 'AI Agent Management',
    'admin.agents.add': '+ Add Agent',
    'admin.agents.name': 'Display Name',
    'admin.agents.command': 'Command',
    'admin.agents.path': 'Fallback Path',
    'admin.agents.pathHint': 'Full path when command is not in PATH',
    'admin.agents.builtin': 'Built-in',
    'admin.agents.custom': 'Custom',
    'admin.agents.edit': 'Edit',
    'admin.agents.delete': 'Delete',
    'admin.agents.confirmDelete': 'Delete this Agent?',
    'admin.server.title': 'Server Configuration',
    'admin.server.host': 'Listen Address',
    'admin.server.httpPort': 'HTTP Port',
    'admin.server.httpsPort': 'HTTPS Port',
    'admin.server.token': 'Auth Token',
    'admin.server.password': 'Auth Password',
    'admin.server.toggleVisibility': 'Show/Hide',
    'admin.server.hint': 'Server config must be modified in config.json. Restart service after changes.',
    'admin.session.title': 'Session Configuration',
    'admin.session.maxHistory': 'Max History Records',
    'admin.session.timeout': 'Session Timeout (ms)',
    'admin.session.hint': 'Session config must be modified in config.json',
    'admin.modal.add': 'Add AI Agent',
    'admin.modal.edit': 'Edit AI Agent',
    'admin.modal.nameLabel': 'Display Name *',
    'admin.modal.namePlaceholder': 'e.g.: Claude',
    'admin.modal.commandLabel': 'Command *',
    'admin.modal.commandPlaceholder': 'e.g.: claude',
    'admin.modal.pathLabel': 'Fallback Path',
    'admin.modal.pathPlaceholder': 'e.g.: C:\\Users\\xxx\\.local\\bin\\claude.exe',
    'admin.modal.save': 'Save',
    'admin.modal.cancel': 'Cancel'
  }
};

// 获取翻译
function t(key, lang = 'zh') {
  return i18n[lang]?.[key] || i18n['zh']?.[key] || key;
}

// 获取当前语言
function getCurrentLang() {
  return localStorage.getItem('app-language') || 'zh';
}

// 设置语言
function setLang(lang) {
  localStorage.setItem('app-language', lang);
  applyTranslations(lang);
}

// 应用翻译
function applyTranslations(lang) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  // 更新所有带 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key, lang);

    if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
      el.placeholder = translation;
    } else {
      el.textContent = translation;
    }
  });

  // 更新 title 属性的元素
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, lang);
  });
}

export { i18n, t, getCurrentLang, setLang, applyTranslations };
