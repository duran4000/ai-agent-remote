const MIN_COLS = 20;
const MIN_ROWS = 5;

export class Terminal {
  constructor(container, onResize = null, onInput = null) {
    this.container = container;
    this.history = [];
    this.maxHistory = 1000;
    this.autoScroll = true;
    this.onResize = onResize;
    this.onInput = onInput;
    this.lastCols = 0;
    this.lastRows = 0;
    this.lastDevicePixelRatio = window.devicePixelRatio;
    this.minSizeWarning = null;
    this.connected = false;
    this.lineBufferMode = false;
    this.inputBuffer = '';
    this.bufferStartRow = 0;
    this.bufferStartCol = 0;
    this.cursorPos = 0;
    this.lastEnterTime = 0;
    this.enterDebounceDelay = 300;
    this.escSequenceBuffer = '';
    this.escSequenceTimer = null;
    this.aiAgent = null;
    
    this.term = new window.Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#1a1a1a',
        selection: 'rgba(255, 255, 255, 0.3)'
      },
      fontFamily: 'Consolas, Monaco, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      allowTransparency: true,
      disableStdin: false,
      cursorBlink: true,
      cursorStyle: 'block',
      rendererType: 'canvas',
      convertEol: true,
      windowsMode: true,
      // 禁用光标轮廓
      drawBoldTextInBrightColors: false,
      letterSpacing: 0
    });
    
    const FitAddonClass = window.FitAddon.FitAddon || window.FitAddon;
    if (typeof FitAddonClass !== 'function') {
      throw new Error('FitAddon not loaded correctly');
    }
    
    this.fitAddon = new FitAddonClass();
    this.term.loadAddon(this.fitAddon);
    
    this.term.open(container);

    // 修复 xterm.js 辅助 textarea 的位置问题
    this.fixHelperTextareaPosition(container);

    // 持续监控并修复
    this._fixInterval = setInterval(() => {
      this.fixHelperTextareaPosition(container);
    }, 500);

    this.fit();
    
    this.term.onData((data) => {
      console.log('[Terminal] onData triggered, connected:', this.connected, 'data:', JSON.stringify(data));
      if (this.connected && this.onInput) {
        if (this.isFocusEventSequence(data)) {
          console.log('[Terminal] Ignoring focus event sequence:', JSON.stringify(data));
          return;
        }
        if (this.lineBufferMode) {
          this.handleLineBufferInput(data);
        } else {
          console.log('[Terminal] Sending input to server');
          this.onInput(data);
        }
      }
    });
    
    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(container);
    
    window.addEventListener('resize', () => {
      this.fit();
    });
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        this.handleZoomChange();
      });
    }
    
    this.zoomCheckInterval = setInterval(() => {
      if (window.devicePixelRatio !== this.lastDevicePixelRatio) {
        this.handleZoomChange();
      }
    }, 200);
  }

  handleZoomChange() {
    if (window.devicePixelRatio !== this.lastDevicePixelRatio) {
      this.lastDevicePixelRatio = window.devicePixelRatio;
      setTimeout(() => this.fit(), 50);
    }
  }

  fixHelperTextareaPosition(container) {
    // 使用更强的选择器找到并隐藏光标轮廓
    const xtermScreen = container.querySelector('.xterm-screen');
    if (xtermScreen) {
      const cursorOutlines = xtermScreen.querySelectorAll('.xterm-cursor-outline');
      cursorOutlines.forEach(el => {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
      });
    }
  }

  isFocusEventSequence(data) {
    if (data === '\x1b[O' || data === '\x1b[I') {
      return true;
    }
    if (/^\x1b\[\d*[OI]$/.test(data)) {
      return true;
    }
    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data)) {
      return true;
    }
    if (this.aiAgent === 'opencode') {
      if (/^\x1b\[\?\d+(;\d+)*\$y$/.test(data)) {
        return true;
      }
      if (/^\x1b\[>\d+(;\d+)*c$/.test(data)) {
        return true;
      }
      if (/^\x1b\[\d+;\d+R$/.test(data)) {
        return true;
      }
      if (/^\x1b\][^\x07\x1b]*(\x07|\x1b\\)$/.test(data)) {
        return true;
      }
      if (/^\x1b_[^\x1b]*\x1b\\$/.test(data)) {
        return true;
      }
      if (/^\x1bP[\x20-\x7e]*\x1b\\$/.test(data)) {
        return true;
      }
      if (/^\x1b\[\d+(;\d+)*t$/.test(data)) {
        return true;
      }
    }
    return false;
  }

  setAIAgent(aiAgent) {
    this.aiAgent = aiAgent;
  }

  showMinSizeWarning() {
    if (!this.minSizeWarning) {
      this.minSizeWarning = document.createElement('div');
      this.minSizeWarning.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(233, 69, 96, 0.9);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1000;
        text-align: center;
        white-space: nowrap;
      `;
      this.minSizeWarning.textContent = `窗口太小，请放大浏览器窗口`;
      this.container.style.position = 'relative';
      this.container.appendChild(this.minSizeWarning);
    }
  }

  hideMinSizeWarning() {
    if (this.minSizeWarning) {
      this.minSizeWarning.remove();
      this.minSizeWarning = null;
    }
  }

  fit(force = false) {
    try {
      this.fitAddon.fit();
      let cols = this.term.cols;
      let rows = this.term.rows;

      if (cols < MIN_COLS || rows < MIN_ROWS) {
        this.showMinSizeWarning();
        cols = Math.max(cols, MIN_COLS);
        rows = Math.max(rows, MIN_ROWS);
      } else {
        this.hideMinSizeWarning();
      }

      if (this.onResize && (force || cols !== this.lastCols || rows !== this.lastRows)) {
        this.lastCols = cols;
        this.lastRows = rows;
        this.onResize(cols, rows);
      }

      // 强制刷新终端，修复光标位置问题
      this.term.refresh(0, this.term.rows - 1);

      // 确保辅助 textarea 位置正确
      this.fixHelperTextareaPosition(this.container);

    } catch (e) {
      console.error('Fit error:', e);
    }
  }

  getSize() {
    return {
      cols: this.term.cols,
      rows: this.term.rows
    };
  }

  setConnected(connected) {
    this.connected = connected;
    if (connected) {
      this.inputBuffer = '';
      this.cursorPos = 0;
    }
  }

  handleLineBufferInput(data) {
    const now = Date.now();
    
    // 处理 ESC 键和转义序列
    if (data === '\x1b') {
      this.escSequenceBuffer = '\x1b';
      if (this.escSequenceTimer) {
        clearTimeout(this.escSequenceTimer);
      }
      this.escSequenceTimer = setTimeout(() => {
        // 如果 50ms 内没有后续字符，认为是单独的 ESC 键
        if (this.escSequenceBuffer === '\x1b') {
          console.log('[Terminal] ESC key pressed, clearing buffer');
          const deleteCount = this.inputBuffer.length;
          for (let i = 0; i < deleteCount; i++) {
            this.term.write('\b \b');
          }
          this.inputBuffer = '';
          this.cursorPos = 0;
        }
        this.escSequenceBuffer = '';
      }, 50);
      return;
    }
    
    // 如果正在等待转义序列，累积字符
    if (this.escSequenceBuffer) {
      this.escSequenceBuffer += data;
      if (this.escSequenceTimer) {
        clearTimeout(this.escSequenceTimer);
      }
      this.escSequenceTimer = setTimeout(() => {
        // 处理完整的转义序列
        const seq = this.escSequenceBuffer;
        this.escSequenceBuffer = '';
        
        if (seq === '\x1b[D') {
          if (this.cursorPos > 0) {
            this.cursorPos--;
            this.term.write('\x1b[D');
          }
        } else if (seq === '\x1b[C') {
          if (this.cursorPos < this.inputBuffer.length) {
            this.cursorPos++;
            this.term.write('\x1b[C');
          }
        } else if (seq === '\x1b[H') {
          while (this.cursorPos > 0) {
            this.cursorPos--;
            this.term.write('\x1b[D');
          }
        } else if (seq === '\x1b[F') {
          while (this.cursorPos < this.inputBuffer.length) {
            this.cursorPos++;
            this.term.write('\x1b[C');
          }
        } else if (seq === '\x1b[3~') {
          if (this.cursorPos < this.inputBuffer.length) {
            this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) + this.inputBuffer.slice(this.cursorPos + 1);
            this.term.write('\x1b[P');
          }
        } else {
          // 其他转义序列直接发送到服务器
          console.log('[Terminal] Sending escape sequence:', JSON.stringify(seq));
          this.onInput(seq);
        }
      }, 50);
      return;
    }
    
    // 处理完整的转义序列（一次性传入的情况）
    if (data.startsWith('\x1b[')) {
      if (data === '\x1b[D') {
        if (this.cursorPos > 0) {
          this.cursorPos--;
          this.term.write('\x1b[D');
        }
      } else if (data === '\x1b[C') {
        if (this.cursorPos < this.inputBuffer.length) {
          this.cursorPos++;
          this.term.write('\x1b[C');
        }
      } else if (data === '\x1b[H') {
        while (this.cursorPos > 0) {
          this.cursorPos--;
          this.term.write('\x1b[D');
        }
      } else if (data === '\x1b[F') {
        while (this.cursorPos < this.inputBuffer.length) {
          this.cursorPos++;
          this.term.write('\x1b[C');
        }
      } else if (data === '\x1b[3~') {
        if (this.cursorPos < this.inputBuffer.length) {
          this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) + this.inputBuffer.slice(this.cursorPos + 1);
          this.term.write('\x1b[P');
        }
      } else {
        // 其他转义序列直接发送到服务器
        console.log('[Terminal] Sending escape sequence:', JSON.stringify(data));
        this.onInput(data);
      }
      return;
    }
    
    if (data === '\r' || data === '\n') {
      if (this.inputBuffer.length > 0) {
        const len = this.inputBuffer.length;
        for (let i = 0; i < len; i++) {
          this.term.write('\b \b');
        }
        console.log('[Terminal] Sending line to server:', this.inputBuffer);
        this.onInput(this.inputBuffer + '\n');
        this.inputBuffer = '';
        this.cursorPos = 0;
      } else {
        this.onInput('\n');
      }
    } else if (data === '\x7f' || data === '\b') {
      if (this.cursorPos > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos - 1) + this.inputBuffer.slice(this.cursorPos);
        this.cursorPos--;
        this.term.write('\b \b');
      }
    } else if (data === '\x03') {
      this.term.write('^C\r\n');
      this.inputBuffer = '';
      this.cursorPos = 0;
      this.onInput('\x03');
    } else if (data === '\x01') {
      while (this.cursorPos > 0) {
        this.cursorPos--;
        this.term.write('\x1b[D');
      }
    } else if (data === '\x05') {
      while (this.cursorPos < this.inputBuffer.length) {
        this.cursorPos++;
        this.term.write('\x1b[C');
      }
    } else if (data === '\x15') {
      while (this.cursorPos > 0) {
        this.inputBuffer = this.inputBuffer.slice(1);
        this.cursorPos--;
        this.term.write('\b \b');
      }
      this.inputBuffer = '';
    } else if (data.length >= 1 && data.charCodeAt(0) >= 32) {
      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) + char + this.inputBuffer.slice(this.cursorPos);
        
        if (this.cursorPos === this.inputBuffer.length - 1) {
          // 在行尾，直接写入字符
          this.term.write(char);
        } else {
          // 在中间插入，需要重新渲染整行
          const before = this.inputBuffer.slice(0, this.cursorPos + 1);
          const after = this.inputBuffer.slice(this.cursorPos + 1);
          
          // 移动到行首
          this.term.write('\r');
          // 清除行
          this.term.write('\x1b[K');
          // 写入新内容
          this.term.write(before + after);
          // 移动光标到正确位置
          const moveBack = after.length;
          if (moveBack > 0) {
            this.term.write(`\x1b[${moveBack}D`);
          }
        }
        
        this.cursorPos++;
      }
    } else {
      console.log('[Terminal] Unhandled input in line buffer mode:', JSON.stringify(data));
    }
  }

  focus() {
    this.term.focus();
  }

  write(content, type = '') {
    const processedContent = content.replace(/\x1b\[3J/g, '');

    let coloredContent = processedContent;
    if (type === 'success') {
      coloredContent = `\x1b[32m${processedContent}\x1b[0m`;
    } else if (type === 'error') {
      coloredContent = `\x1b[31m${processedContent}\x1b[0m`;
    } else if (type === 'info') {
      coloredContent = `\x1b[33m${processedContent}\x1b[0m`;
    }

    this.term.write(coloredContent, () => {
      // 写入完成后移除错误位置的光标轮廓
      this.fixHelperTextareaPosition(this.container);
    });

    this.history.push({ content, type, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    if (this.autoScroll) this.scrollToBottom();
  }

  clear() {
    this.term.clear();
    this.history = [];
  }

  scrollToBottom() {
    this.term.scrollToBottom();
  }

  getHistory() {
    return this.history || [];
  }

  setFontSize(size) {
    this.term.options.fontSize = size;
    // 先隐藏最小尺寸警告，避免字体调整时闪烁
    this.hideMinSizeWarning();
    // 延迟调用 fit，让 xterm 有时间重新计算尺寸
    setTimeout(() => {
      this.fit(true);
    }, 50);
    localStorage.setItem('claude-remote-font-size', size);
  }

  getFontSize() {
    return this.term.options.fontSize;
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.zoomCheckInterval) {
      clearInterval(this.zoomCheckInterval);
    }
    this.term.dispose();
  }
}
