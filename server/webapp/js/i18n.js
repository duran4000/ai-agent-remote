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
    'settings.connect': '连接',
    'settings.disconnect': '断开连接',

    // 语言
    'lang.switch': '切换语言',
    'lang.zh': '中文',
    'lang.en': 'English'
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
    'settings.connect': 'Connect',
    'settings.disconnect': 'Disconnect',

    // Language
    'lang.switch': 'Switch Language',
    'lang.zh': '中文',
    'lang.en': 'English'
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
