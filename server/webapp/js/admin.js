import { getCurrentLang, setLang, applyTranslations, t } from './i18n.js';

class AdminApp {
  constructor() {
    this.agents = [];
    this.config = null;
    this.editingKey = null;
    this.init();
  }

  async init() {
    this.initLanguage();
    this.bindElements();
    this.bindEvents();
    await this.loadConfig();
    await this.loadAgents();
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
    this.renderAgents();
  }

  updateLangButton(lang) {
    const langSwitch = document.getElementById('lang-switch');
    if (langSwitch) {
      langSwitch.textContent = lang === 'zh' ? 'EN' : '中文';
    }
  }

  bindElements() {
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.agentsList = document.getElementById('agents-list');
    this.addAgentBtn = document.getElementById('add-agent-btn');
    this.modal = document.getElementById('agent-modal');
    this.modalTitle = document.getElementById('modal-title');
    this.agentNameInput = document.getElementById('agent-name');
    this.agentCommandInput = document.getElementById('agent-command');
    this.agentPathInput = document.getElementById('agent-path');
    this.saveAgentBtn = document.getElementById('save-agent-btn');
    this.cancelAgentBtn = document.getElementById('cancel-agent-btn');
    this.closeModalBtns = document.querySelectorAll('.close-modal');
    this.serverHost = document.getElementById('server-host');
    this.serverPort = document.getElementById('server-port');
    this.serverHttpsPort = document.getElementById('server-https-port');
    this.serverToken = document.getElementById('server-token');
    this.authPassword = document.getElementById('auth-password');
    this.toggleTokenBtn = document.getElementById('toggle-token');
    this.togglePasswordBtn = document.getElementById('toggle-password');
    this.maxHistory = document.getElementById('max-history');
    this.sessionTimeout = document.getElementById('session-timeout');
    this.toast = document.getElementById('toast');
    this.langSwitch = document.getElementById('lang-switch');
  }

  bindEvents() {
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    this.addAgentBtn.addEventListener('click', () => this.openAddModal());
    this.saveAgentBtn.addEventListener('click', () => this.saveAgent());
    this.cancelAgentBtn.addEventListener('click', () => this.closeModal());
    this.closeModalBtns.forEach(btn => {
      btn.addEventListener('click', () => this.closeModal());
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });

    this.toggleTokenBtn.addEventListener('click', () => {
      this.serverToken.type = this.serverToken.type === 'password' ? 'text' : 'password';
    });

    this.togglePasswordBtn.addEventListener('click', () => {
      this.authPassword.type = this.authPassword.type === 'password' ? 'text' : 'password';
    });

    if (this.langSwitch) {
      this.langSwitch.addEventListener('click', () => this.toggleLanguage());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.closeModal();
      }
    });
  }

  switchTab(tabName) {
    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    this.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
  }

  async loadConfig() {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      if (data.success) {
        this.config = data.data;
        this.renderServerConfig();
        this.renderSessionConfig();
      }
    } catch (error) {
      this.showToast(t('admin.error.loadConfig'), 'error');
    }
  }

  renderServerConfig() {
    if (!this.config) return;
    this.serverHost.value = this.config.server?.host || '';
    this.serverPort.value = this.config.server?.port || '';
    this.serverHttpsPort.value = this.config.server?.httpsPort || '';
    this.serverToken.value = this.config.server?.token || '';
    this.authPassword.value = this.config.server?.authPassword || '';
  }

  renderSessionConfig() {
    if (!this.config) return;
    this.maxHistory.value = this.config.session?.maxHistory || '';
    this.sessionTimeout.value = this.config.session?.timeout || '';
  }

  async loadAgents() {
    try {
      const res = await fetch('/api/admin/ai-agents');
      const data = await res.json();
      if (data.success) {
        this.agents = data.data;
        this.renderAgents();
      }
    } catch (error) {
      this.showToast(t('admin.error.loadAgents'), 'error');
    }
  }

  renderAgents() {
    const lang = getCurrentLang();
    const builtinText = lang === 'zh' ? '内置' : 'Built-in';
    const customText = lang === 'zh' ? '自定义' : 'Custom';
    const editText = lang === 'zh' ? '编辑' : 'Edit';
    const deleteText = lang === 'zh' ? '删除' : 'Delete';

    this.agentsList.innerHTML = this.agents.map(agent => `
      <div class="agent-item" data-key="${agent.key}">
        <div class="agent-name">
          ${agent.name}
          <span class="agent-badge ${agent.isPreset ? 'preset' : 'custom'}">${agent.isPreset ? builtinText : customText}</span>
        </div>
        <div class="agent-actions">
          <button class="edit-btn" data-key="${agent.key}">${editText}</button>
          ${!agent.isPreset ? `<button class="delete-btn" data-key="${agent.key}" data-name="${agent.name}">${deleteText}</button>` : ''}
        </div>
      </div>
    `).join('');

    // Bind edit buttons
    this.agentsList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const agent = this.agents.find(a => a.key === btn.dataset.key);
        if (agent) this.openEditModal(agent);
      });
    });

    // Bind delete buttons
    this.agentsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.deleteAgent(btn.dataset.key, btn.dataset.name);
      });
    });
  }

  openAddModal() {
    this.editingKey = null;
    this.modalTitle.textContent = t('admin.modal.add');
    this.agentNameInput.value = '';
    this.agentCommandInput.value = '';
    this.agentPathInput.value = '';
    this.modal.classList.remove('hidden');
    this.agentNameInput.focus();
  }

  openEditModal(agent) {
    this.editingKey = agent.key;
    this.modalTitle.textContent = t('admin.modal.edit');
    this.agentNameInput.value = agent.name;
    this.agentCommandInput.value = agent.command;
    this.agentPathInput.value = agent.fallbackPath || '';
    this.modal.classList.remove('hidden');
    this.agentNameInput.focus();
  }

  closeModal() {
    this.modal.classList.add('hidden');
    this.editingKey = null;
  }

  async saveAgent() {
    const name = this.agentNameInput.value.trim();
    const command = this.agentCommandInput.value.trim();
    const fallbackPath = this.agentPathInput.value.trim();

    if (!name || !command) {
      const lang = getCurrentLang();
      this.showToast(lang === 'zh' ? '名称和命令不能为空' : 'Name and command are required', 'error');
      return;
    }

    const agentData = { name, command, fallbackPath };

    try {
      let res;
      if (this.editingKey) {
        res = await fetch(`/api/admin/ai-agents/${this.editingKey}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentData)
        });
      } else {
        res = await fetch('/api/admin/ai-agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentData)
        });
      }

      const data = await res.json();
      const lang = getCurrentLang();

      if (data.success) {
        this.showToast(lang === 'zh' ? (this.editingKey ? '更新成功' : '添加成功') : (this.editingKey ? 'Updated' : 'Added'), 'success');
        this.closeModal();
        await this.loadAgents();
      } else {
        this.showToast((lang === 'zh' ? '保存失败: ' : 'Save failed: ') + data.error, 'error');
      }
    } catch (error) {
      const lang = getCurrentLang();
      this.showToast((lang === 'zh' ? '保存失败: ' : 'Save failed: ') + error.message, 'error');
    }
  }

  async deleteAgent(key, name) {
    const lang = getCurrentLang();
    if (!confirm(lang === 'zh' ? `确定要删除 "${name}" 吗？` : `Delete "${name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/ai-agents/${key}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        this.showToast(lang === 'zh' ? '删除成功' : 'Deleted', 'success');
        await this.loadAgents();
      } else {
        this.showToast((lang === 'zh' ? '删除失败: ' : 'Delete failed: ') + data.error, 'error');
      }
    } catch (error) {
      const lang = getCurrentLang();
      this.showToast((lang === 'zh' ? '删除失败: ' : 'Delete failed: ') + error.message, 'error');
    }
  }

  showToast(message, type = 'success') {
    this.toast.textContent = message;
    this.toast.className = `toast ${type}`;
    this.toast.classList.remove('hidden');

    setTimeout(() => {
      this.toast.classList.add('hidden');
    }, 3000);
  }
}

new AdminApp();
