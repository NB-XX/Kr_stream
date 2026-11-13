/**
 * KRStream Hub - Live Subtitle Engine
 * 专为 SOOP 与 CI.ME 打造的实时直播字幕与双语AI翻译引擎
 * 支持 B 站交互规范：开关控制、双语开关、主副字幕 8 语言切换、字号透明度自定义
 */

export const SUBTITLE_LANGS = [
  { id: 'zh-CN', label: '中文 简体', soopNum: 2, soopCode: 'zh_CN', transCode: 'zh-CN' },
  { id: 'ko',    label: '한국어',    soopNum: 0, soopCode: 'ko_KR', transCode: 'ko' },
  { id: 'en',    label: 'English',   soopNum: 1, soopCode: 'en_US', transCode: 'en' },
  { id: 'ja',    label: '日本語',    soopNum: 5, soopCode: 'ja_JP', transCode: 'ja' },
  { id: 'zh-TW', label: '中文 繁體', soopNum: 3, soopCode: 'zh_TW', transCode: 'zh-TW' },
  { id: 'th',    label: 'ไทย',       soopNum: 4, soopCode: 'th_TH', transCode: 'th' },
  { id: 'vi',    label: 'Tiếng Việt',soopNum: 6, soopCode: 'vi_VN', transCode: 'vi' },
  { id: 'id',    label: 'Bahasa Indonesia', soopNum: 7, soopCode: 'id_ID', transCode: 'id' }
];

export function getSubtitleLangObj(codeOrNum) {
  if (codeOrNum === undefined || codeOrNum === null) return null;
  const s = String(codeOrNum).trim();
  if (/^-?\d+$/.test(s)) {
    const num = parseInt(s, 10);
    return SUBTITLE_LANGS.find(l => l.soopNum === num) || null;
  }
  const str = s.toLowerCase().replace(/[-_]/g, '');
  return SUBTITLE_LANGS.find(l => {
    const lid = l.id.toLowerCase().replace(/[-_]/g, '');
    const lsc = l.soopCode.toLowerCase().replace(/[-_]/g, '');
    const ltc = l.transCode.toLowerCase().replace(/[-_]/g, '');
    return lid === str || lsc === str || ltc === str;
  }) || (str.startsWith('zh') ? SUBTITLE_LANGS[0] : (str.startsWith('ko') ? SUBTITLE_LANGS[1] : (str.startsWith('en') ? SUBTITLE_LANGS[2] : (str.startsWith('ja') ? SUBTITLE_LANGS[3] : null))));
}

export class SubtitleEngine {
  constructor(slot) {
    this.slot = slot;
    this.enabled = false;
    this.isBilingual = true;
    this.primaryLang = 'zh-CN';
    this.secondaryLang = 'ko';
    this.fontSize = 'medium'; // 'small', 'medium', 'large', 'xlarge'
    this.opacity = '100';     // '100', '80', '60', '40'
    this.fontColor = '#ffffff'; // '#ffffff', '#fef08a', '#67e8f9', '#86efac'
    this.textAlign = 'center'; // 'center', 'left'
    this.mode = 'bilingual';

    // 运行状态
    this.pollTimer = null;
    this.activeSocket = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.serverUuid = '00000000-0000-0000-0000-000000000000';
    this.recognition = null;
    this.lastSeq = -1;
    this.lastCaptionText = '';
    this.hideTimeout = null;
    this.translationCache = new Map();
    this.history = [];
    this.recentPrimary = { text: '', time: 0 };
    this.recentSecondary = { text: '', time: 0 };

    // DOM 引用
    this.overlayEl = null;
    this.boxEl = null;
    this.speakerEl = null;
    this.mainEl = null;
    this.secEl = null;
    this.btnEl = null;
    this.menuEl = null;

    this.initUI();
  }

  initUI() {
    const videoContainer = this.slot.dom.querySelector('.video-container');
    if (!videoContainer) return;

    // 1. 创建视频内字幕覆盖层
    const overlay = document.createElement('div');
    overlay.className = `slot-subtitle-overlay font-${this.fontSize} align-${this.textAlign}`;
    overlay.id = `sub-overlay-${this.slot.slotId}`;
    overlay.innerHTML = `
      <div class="subtitle-box" id="sub-box-${this.slot.slotId}">
        <div class="sub-speaker" id="sub-speaker-${this.slot.slotId}" style="display:none;"></div>
        <div class="sub-text-wrapper">
          <div class="sub-line sub-main" id="sub-main-${this.slot.slotId}" style="color:${this.fontColor}"></div>
          <div class="sub-line sub-sec" id="sub-sec-${this.slot.slotId}"></div>
        </div>
      </div>
    `;
    videoContainer.appendChild(overlay);

    this.overlayEl = overlay;
    this.boxEl = overlay.querySelector('.subtitle-box');
    this.speakerEl = overlay.querySelector('.sub-speaker');
    this.mainEl = overlay.querySelector('.sub-main');
    this.secEl = overlay.querySelector('.sub-sec');

    // 2. 绑定控制栏按钮 (左键打开/关闭菜单，右键唤出菜单，悬浮展开)
    this.btnEl = this.slot.dom.querySelector(`#btn-subs-${this.slot.slotId}`);
    if (this.btnEl) {
      this.btnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSettingsMenu(e);
      });

      this.btnEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showSettingsMenu(e);
      });

      let hoverTimer = null;
      this.btnEl.addEventListener('mouseenter', () => {
        hoverTimer = setTimeout(() => {
          this.showSettingsMenu();
        }, 180);
      });
      this.btnEl.addEventListener('mouseleave', () => {
        if (hoverTimer) clearTimeout(hoverTimer);
      });
    }

    // 3. 字幕画面层本身支持右键快速打开设置
    if (this.overlayEl) {
      this.overlayEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showSettingsMenu(e);
      });
    }

    // 4. 创建 B 站规格字幕浮动面板
    this.createSettingsMenu();
  }

  createSettingsMenu() {
    const menu = document.createElement('div');
    menu.className = 'sub-settings-menu bili-sub-panel';
    menu.id = `sub-menu-${this.slot.slotId}`;

    menu.innerHTML = `
      <!-- 主面板：语言选择与双语开关 -->
      <div class="bili-sub-view bili-sub-main-view" id="bili-main-view-${this.slot.slotId}">
        <div class="bili-sub-header">
          <span class="bili-sub-title">字幕</span>
          <button class="bili-sub-toggle-btn ${this.enabled ? 'active' : ''}" id="bili-toggle-${this.slot.slotId}">
            ${this.enabled ? '关闭' : '开启'}
          </button>
        </div>
        <div class="bili-sub-divider"></div>

        <div class="bili-sub-row">
          <span class="bili-sub-row-label">双语字幕</span>
          <label class="bili-switch">
            <input type="checkbox" id="bili-bilingual-chk-${this.slot.slotId}" ${this.isBilingual ? 'checked' : ''}>
            <span class="bili-switch-slider"></span>
          </label>
        </div>

        <div class="bili-sub-cols-header">
          <span class="bili-col-header-item">主字幕</span>
          <span class="bili-col-header-item ${this.isBilingual ? '' : 'disabled'}" id="bili-sec-header-${this.slot.slotId}">副字幕</span>
        </div>

        <div class="bili-sub-cols-grid">
          <!-- 左列: 主字幕 -->
          <div class="bili-sub-col" id="bili-col-primary-${this.slot.slotId}">
            ${SUBTITLE_LANGS.map(lang => `
              <button class="bili-lang-item ${this.primaryLang === lang.id ? 'active' : ''}" data-lang="${lang.id}" title="${lang.label}">
                <span class="bili-lang-text">${lang.label}</span>
                <span class="bili-ai-tag">AI</span>
              </button>
            `).join('')}
          </div>

          <!-- 右列: 副字幕 (双语关闭时变灰禁用) -->
          <div class="bili-sub-col ${this.isBilingual ? '' : 'disabled'}" id="bili-col-secondary-${this.slot.slotId}">
            ${SUBTITLE_LANGS.map(lang => `
              <button class="bili-lang-item ${this.secondaryLang === lang.id ? 'active' : ''}" data-lang="${lang.id}" title="${lang.label}">
                <span class="bili-lang-text">${lang.label}</span>
                <span class="bili-ai-tag">AI</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="bili-sub-divider"></div>

        <div class="bili-sub-footer-link" id="bili-btn-settings-${this.slot.slotId}">
          <span>字幕设置</span>
          <svg class="bili-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
      </div>

      <!-- 次级面板：字号、透明度、颜色与对齐设置 -->
      <div class="bili-sub-view bili-sub-settings-view" id="bili-settings-view-${this.slot.slotId}" style="display: none;">
        <div class="bili-sub-header">
          <button class="bili-sub-back-btn" id="bili-btn-back-${this.slot.slotId}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <span>返回</span>
          </button>
          <span class="bili-sub-title">字幕设置</span>
        </div>
        <div class="bili-sub-divider"></div>

        <div class="bili-settings-group">
          <div class="bili-settings-label">字幕字号</div>
          <div class="bili-pill-group" id="bili-size-group-${this.slot.slotId}">
            <button class="bili-pill-btn ${this.fontSize === 'small' ? 'active' : ''}" data-size="small">小 (12px)</button>
            <button class="bili-pill-btn ${this.fontSize === 'medium' ? 'active' : ''}" data-size="medium">中 (15px)</button>
            <button class="bili-pill-btn ${this.fontSize === 'large' ? 'active' : ''}" data-size="large">大 (18px)</button>
            <button class="bili-pill-btn ${this.fontSize === 'xlarge' ? 'active' : ''}" data-size="xlarge">特大 (22px)</button>
          </div>
        </div>

        <div class="bili-settings-group">
          <div class="bili-settings-label">不透明度</div>
          <div class="bili-pill-group" id="bili-opacity-group-${this.slot.slotId}">
            <button class="bili-pill-btn ${this.opacity === '100' ? 'active' : ''}" data-opacity="100">100%</button>
            <button class="bili-pill-btn ${this.opacity === '80' ? 'active' : ''}" data-opacity="80">80%</button>
            <button class="bili-pill-btn ${this.opacity === '60' ? 'active' : ''}" data-opacity="60">60%</button>
            <button class="bili-pill-btn ${this.opacity === '40' ? 'active' : ''}" data-opacity="40">40%</button>
          </div>
        </div>

        <div class="bili-settings-group">
          <div class="bili-settings-label">字体颜色</div>
          <div class="bili-color-group" id="bili-color-group-${this.slot.slotId}">
            <button class="bili-color-btn ${this.fontColor === '#ffffff' ? 'active' : ''}" data-color="#ffffff" style="background: #ffffff;" title="白色"></button>
            <button class="bili-color-btn ${this.fontColor === '#fef08a' ? 'active' : ''}" data-color="#fef08a" style="background: #fef08a;" title="明黄"></button>
            <button class="bili-color-btn ${this.fontColor === '#67e8f9' ? 'active' : ''}" data-color="#67e8f9" style="background: #67e8f9;" title="浅青"></button>
            <button class="bili-color-btn ${this.fontColor === '#86efac' ? 'active' : ''}" data-color="#86efac" style="background: #86efac;" title="纯绿"></button>
          </div>
        </div>

        <div class="bili-settings-group">
          <div class="bili-settings-label">字幕对齐</div>
          <div class="bili-pill-group cols-2" id="bili-align-group-${this.slot.slotId}">
            <button class="bili-pill-btn ${this.textAlign === 'center' ? 'active' : ''}" data-align="center">居中对齐</button>
            <button class="bili-pill-btn ${this.textAlign === 'left' ? 'active' : ''}" data-align="left">靠左对齐</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(menu);
    this.menuEl = menu;

    // 事件绑定
    // 1. 开启/关闭开关
    const toggleBtn = menu.querySelector(`#bili-toggle-${this.slot.slotId}`);
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    // 2. 双语开关
    const biChk = menu.querySelector(`#bili-bilingual-chk-${this.slot.slotId}`);
    if (biChk) {
      biChk.addEventListener('change', (e) => {
        e.stopPropagation();
        this.setBilingual(e.target.checked);
      });
    }

    // 3. 主字幕语言选择
    menu.querySelectorAll(`#bili-col-primary-${this.slot.slotId} .bili-lang-item`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = btn.dataset.lang;
        this.setPrimaryLang(lang);
        if (!this.enabled) this.toggle();
      });
    });

    // 4. 副字幕语言选择
    menu.querySelectorAll(`#bili-col-secondary-${this.slot.slotId} .bili-lang-item`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = btn.dataset.lang;
        this.setSecondaryLang(lang);
        if (!this.enabled) this.toggle();
      });
    });

    // 5. 视图翻转：前往详细设置
    const btnSettings = menu.querySelector(`#bili-btn-settings-${this.slot.slotId}`);
    const mainView = menu.querySelector(`#bili-main-view-${this.slot.slotId}`);
    const settingsView = menu.querySelector(`#bili-settings-view-${this.slot.slotId}`);
    if (btnSettings && mainView && settingsView) {
      btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        mainView.style.display = 'none';
        settingsView.style.display = 'flex';
      });
    }

    // 6. 视图翻转：返回语言面板
    const btnBack = menu.querySelector(`#bili-btn-back-${this.slot.slotId}`);
    if (btnBack && mainView && settingsView) {
      btnBack.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsView.style.display = 'none';
        mainView.style.display = 'flex';
      });
    }

    // 7. 字号设置
    menu.querySelectorAll(`#bili-size-group-${this.slot.slotId} .bili-pill-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFontSize(btn.dataset.size);
      });
    });

    // 8. 透明度设置
    menu.querySelectorAll(`#bili-opacity-group-${this.slot.slotId} .bili-pill-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setOpacity(btn.dataset.opacity);
      });
    });

    // 9. 颜色设置
    menu.querySelectorAll(`#bili-color-group-${this.slot.slotId} .bili-color-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFontColor(btn.dataset.color);
      });
    });

    // 10. 对齐设置
    menu.querySelectorAll(`#bili-align-group-${this.slot.slotId} .bili-pill-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setTextAlign(btn.dataset.align);
      });
    });

    // 11. 菜单移出与点击外部自动隐藏
    menu.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (this.menuEl && !this.menuEl.matches(':hover') && (!this.btnEl || !this.btnEl.matches(':hover'))) {
          this.menuEl.classList.remove('active');
        }
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target) && (!this.btnEl || !this.btnEl.contains(e.target))) {
        this.menuEl.classList.remove('active');
      }
    });
  }

  showSettingsMenu(e) {
    if (!this.menuEl || !this.btnEl) return;
    this.updateMenuUI();

    const rect = this.btnEl.getBoundingClientRect();
    const menuWidth = 250;
    let left = rect.left - (menuWidth / 2) + (rect.width / 2);
    left = Math.max(10, Math.min(window.innerWidth - menuWidth - 10, left));
    const bottom = Math.max(10, window.innerHeight - rect.top + 8);

    this.menuEl.style.bottom = `${bottom}px`;
    this.menuEl.style.left = `${left}px`;
    this.menuEl.classList.add('active');
  }

  hideSettingsMenu() {
    if (this.menuEl) {
      this.menuEl.classList.remove('active');
    }
  }

  toggleSettingsMenu(e) {
    if (!this.menuEl) return;
    if (this.menuEl.classList.contains('active')) {
      this.hideSettingsMenu();
    } else {
      this.showSettingsMenu(e);
    }
  }

  updateMenuUI() {
    if (!this.menuEl) return;
    const sid = this.slot.slotId;

    // 状态切换按钮
    const toggleBtn = this.menuEl.querySelector(`#bili-toggle-${sid}`);
    if (toggleBtn) {
      toggleBtn.textContent = this.enabled ? '关闭' : '开启';
      if (this.enabled) toggleBtn.classList.add('active');
      else toggleBtn.classList.remove('active');
    }

    // 双语开关与副字幕列禁用态
    const biChk = this.menuEl.querySelector(`#bili-bilingual-chk-${sid}`);
    if (biChk) biChk.checked = this.isBilingual;

    const secHeader = this.menuEl.querySelector(`#bili-sec-header-${sid}`);
    const secCol = this.menuEl.querySelector(`#bili-col-secondary-${sid}`);
    if (this.isBilingual) {
      secHeader?.classList.remove('disabled');
      secCol?.classList.remove('disabled');
    } else {
      secHeader?.classList.add('disabled');
      secCol?.classList.add('disabled');
    }

    // 主字幕列表高亮
    this.menuEl.querySelectorAll(`#bili-col-primary-${sid} .bili-lang-item`).forEach(b => {
      if (b.dataset.lang === this.primaryLang) b.classList.add('active');
      else b.classList.remove('active');
    });

    // 副字幕列表高亮
    this.menuEl.querySelectorAll(`#bili-col-secondary-${sid} .bili-lang-item`).forEach(b => {
      if (b.dataset.lang === this.secondaryLang) b.classList.add('active');
      else b.classList.remove('active');
    });

    // 字号高亮
    this.menuEl.querySelectorAll(`#bili-size-group-${sid} .bili-pill-btn`).forEach(b => {
      if (b.dataset.size === this.fontSize) b.classList.add('active');
      else b.classList.remove('active');
    });

    // 不透明度高亮
    this.menuEl.querySelectorAll(`#bili-opacity-group-${sid} .bili-pill-btn`).forEach(b => {
      if (b.dataset.opacity === this.opacity) b.classList.add('active');
      else b.classList.remove('active');
    });

    // 颜色高亮
    this.menuEl.querySelectorAll(`#bili-color-group-${sid} .bili-color-btn`).forEach(b => {
      if (b.dataset.color === this.fontColor) b.classList.add('active');
      else b.classList.remove('active');
    });

    // 对齐高亮
    this.menuEl.querySelectorAll(`#bili-align-group-${sid} .bili-pill-btn`).forEach(b => {
      if (b.dataset.align === this.textAlign) b.classList.add('active');
      else b.classList.remove('active');
    });
  }

  setPrimaryLang(langId) {
    this.primaryLang = langId;
    this.mode = this.isBilingual ? 'bilingual' : this.primaryLang;
    this.updateMenuUI();
    if (this.enabled && this.slot.currentStreamData?.platform === 'soop') {
      this.slot.danmakuEngine?.sendSubtitleLang(this.primaryLang, this.secondaryLang, this.isBilingual);
    }
    this.slot.slotManager?.saveState();
  }

  setSecondaryLang(langId) {
    this.secondaryLang = langId;
    this.mode = this.isBilingual ? 'bilingual' : this.primaryLang;
    this.updateMenuUI();
    if (this.enabled && this.slot.currentStreamData?.platform === 'soop') {
      this.slot.danmakuEngine?.sendSubtitleLang(this.primaryLang, this.secondaryLang, this.isBilingual);
    }
    this.slot.slotManager?.saveState();
  }

  setBilingual(isBilingual) {
    this.isBilingual = Boolean(isBilingual);
    this.mode = this.isBilingual ? 'bilingual' : this.primaryLang;
    this.updateMenuUI();
    if (this.enabled && this.slot.currentStreamData?.platform === 'soop') {
      this.slot.danmakuEngine?.sendSubtitleLang(this.primaryLang, this.secondaryLang, this.isBilingual);
    }
    this.slot.slotManager?.saveState();
  }

  setFontSize(size) {
    this.fontSize = size;
    if (this.overlayEl) {
      this.overlayEl.className = `slot-subtitle-overlay font-${size} align-${this.textAlign}`;
    }
    this.updateMenuUI();
    this.slot.slotManager?.saveState();
  }

  setOpacity(opacity) {
    this.opacity = String(opacity);
    if (this.boxEl) {
      this.boxEl.style.opacity = `${parseInt(this.opacity, 10) / 100}`;
    }
    this.updateMenuUI();
    this.slot.slotManager?.saveState();
  }

  setFontColor(color) {
    this.fontColor = color;
    if (this.mainEl) {
      this.mainEl.style.color = color;
    }
    this.updateMenuUI();
    this.slot.slotManager?.saveState();
  }

  setTextAlign(align) {
    this.textAlign = align;
    if (this.overlayEl) {
      this.overlayEl.className = `slot-subtitle-overlay font-${this.fontSize} align-${align}`;
    }
    this.updateMenuUI();
    this.slot.slotManager?.saveState();
  }

  // 兼容旧接口
  setMode(mode) {
    if (mode === 'bilingual') {
      this.isBilingual = true;
    } else if (mode === 'zh') {
      this.primaryLang = 'zh-CN';
      this.isBilingual = false;
    } else if (mode === 'ko') {
      this.primaryLang = 'ko';
      this.isBilingual = false;
    } else if (mode === 'en') {
      this.primaryLang = 'en';
      this.isBilingual = false;
    }
    this.mode = mode;
    this.updateMenuUI();
    if (this.enabled && this.slot.currentStreamData?.platform === 'soop') {
      this.slot.danmakuEngine?.sendSubtitleLang(this.primaryLang, this.secondaryLang, this.isBilingual);
    }
    this.slot.slotManager?.saveState();
  }

  toggle() {
    this.enabled = !this.enabled;
    this.updateButtonState();

    if (this.enabled) {
      this.start();
    } else {
      this.stop();
    }
    this.updateMenuUI();
    this.slot.slotManager?.saveState();
  }

  updateButtonState() {
    if (this.btnEl) {
      if (this.enabled) {
        this.btnEl.classList.add('active');
        this.btnEl.title = '字幕 (已开启，右键设置)';
      } else {
        this.btnEl.classList.remove('active');
        this.btnEl.title = '字幕 (已关闭，右键设置)';
      }
    }
    const toggleBtn = this.menuEl?.querySelector(`#bili-toggle-${this.slot.slotId}`);
    if (toggleBtn) {
      toggleBtn.textContent = this.enabled ? '关闭' : '开启';
      if (this.enabled) toggleBtn.classList.add('active');
      else toggleBtn.classList.remove('active');
    }
  }

  start() {
    this.stop();
    const streamData = this.slot.currentStreamData || this.slot.streamData;
    if (!streamData || !streamData.isLive) {
      if (this.slot.showToast) {
        this.slot.showToast('请先连接直播间以获取实时字幕');
      }
      return;
    }

    this.enabled = true;
    this.updateButtonState();

    switch (streamData.platform) {
      case 'cime':
        this.startCimeCaptions(streamData.channelId);
        break;
      case 'soop':
        this.startSoopCaptions(streamData);
        break;
      default:
        // 其他暂无官方字幕流的平台保持纯净静默，绝不调用用户麦克风
        break;
    }
  }

  stop() {
    if (this.slot.currentStreamData?.platform === 'soop') {
      this.slot.danmakuEngine?.sendSubtitleLang('off');
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.activeSocket) {
      try { this.activeSocket.close(); } catch (e) {}
      this.activeSocket = null;
    }
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
      this.recognition = null;
    }
    this.serverUuid = '00000000-0000-0000-0000-000000000000';
    this.clearSubtitle();
  }

  makeSoopPacket(opcode, body) {
    const len = new TextEncoder().encode(body).length;
    const lenStr = String(len).padStart(6, '0');
    return `\u001b\t${opcode}${lenStr}00${body}`;
  }

  /**
   * 统一字幕派发：根据用户选择的主字幕与副字幕动态配对渲染
   */
  async handleSubtitleReceived(originalText, sourceLang, speakerName) {
    if (!this.enabled || !originalText) return;
    const cleanOriginal = originalText.trim();
    if (!cleanOriginal) return;

    if (this.lastCaptionText === cleanOriginal) return;
    this.lastCaptionText = cleanOriginal;

    const matchedLang = getSubtitleLangObj(sourceLang);
    const primaryObj = getSubtitleLangObj(this.primaryLang) || SUBTITLE_LANGS[0];
    const secObj = getSubtitleLangObj(this.secondaryLang) || SUBTITLE_LANGS[1];

    let primaryText = '';
    let secText = '';

    // 情况 1: 收到语言为当前主字幕
    if (matchedLang && matchedLang.id === primaryObj.id) {
      primaryText = cleanOriginal;
      this.recentPrimary = { text: cleanOriginal, time: Date.now() };

      if (this.isBilingual) {
        if (Date.now() - this.recentSecondary.time < 4500 && this.recentSecondary.text) {
          secText = this.recentSecondary.text;
        } else {
          this.translate(cleanOriginal, primaryObj.transCode, secObj.transCode).then((trans) => {
            if (trans && this.isBilingual && this.recentPrimary.text === cleanOriginal) {
              this.recentSecondary = { text: trans, time: Date.now() };
              this.renderSubtitle(speakerName, { primary: cleanOriginal, secondary: trans });
              this.addHistoryItem({
                speaker: speakerName || this.slot.currentStreamData?.streamer || '主播',
                primary: cleanOriginal,
                secondary: trans,
                ko: primaryObj.id === 'ko' ? cleanOriginal : (secObj.id === 'ko' ? trans : ''),
                zh: primaryObj.id === 'zh-CN' ? cleanOriginal : (secObj.id === 'zh-CN' ? trans : ''),
                en: primaryObj.id === 'en' ? cleanOriginal : (secObj.id === 'en' ? trans : '')
              });
            }
          });
        }
      }
    }
    // 情况 2: 收到语言为当前副字幕
    else if (matchedLang && matchedLang.id === secObj.id) {
      secText = cleanOriginal;
      this.recentSecondary = { text: cleanOriginal, time: Date.now() };

      if (this.isBilingual) {
        if (Date.now() - this.recentPrimary.time < 4500 && this.recentPrimary.text) {
          primaryText = this.recentPrimary.text;
        } else {
          this.translate(cleanOriginal, secObj.transCode, primaryObj.transCode).then((trans) => {
            if (trans && this.recentSecondary.text === cleanOriginal) {
              this.recentPrimary = { text: trans, time: Date.now() };
              this.renderSubtitle(speakerName, { primary: trans, secondary: cleanOriginal });
              this.addHistoryItem({
                speaker: speakerName || this.slot.currentStreamData?.streamer || '主播',
                primary: trans,
                secondary: cleanOriginal,
                ko: secObj.id === 'ko' ? cleanOriginal : (primaryObj.id === 'ko' ? trans : ''),
                zh: primaryObj.id === 'zh-CN' ? trans : (secObj.id === 'zh-CN' ? cleanOriginal : ''),
                en: primaryObj.id === 'en' ? trans : (secObj.id === 'en' ? cleanOriginal : '')
              });
            }
          });
        }
      }
    }
    // 情况 3: 收到语言为原声（如韩语），但用户选择了其他组合（如中文+英文）
    else {
      const srcCode = matchedLang ? matchedLang.transCode : 'auto';
      primaryText = await this.translate(cleanOriginal, srcCode, primaryObj.transCode);
      if (this.isBilingual) {
        secText = await this.translate(cleanOriginal, srcCode, secObj.transCode);
      }
      this.recentPrimary = { text: primaryText, time: Date.now() };
      this.recentSecondary = { text: secText, time: Date.now() };
    }

    this.renderSubtitle(speakerName, {
      primary: primaryText,
      secondary: this.isBilingual ? secText : '',
      ko: primaryObj.id === 'ko' ? primaryText : (secObj.id === 'ko' ? secText : ''),
      zh: primaryObj.id === 'zh-CN' ? primaryText : (secObj.id === 'zh-CN' ? secText : ''),
      en: primaryObj.id === 'en' ? primaryText : (secObj.id === 'en' ? secText : '')
    });

    this.addHistoryItem({
      speaker: speakerName || this.slot.currentStreamData?.streamer || this.slot.currentStreamData?.channelId || '主播',
      primary: primaryText,
      secondary: this.isBilingual ? secText : '',
      ko: primaryObj.id === 'ko' ? primaryText : (secObj.id === 'ko' ? secText : ''),
      zh: primaryObj.id === 'zh-CN' ? primaryText : (secObj.id === 'zh-CN' ? secText : ''),
      en: primaryObj.id === 'en' ? primaryText : (secObj.id === 'en' ? secText : '')
    });
  }

  addHistoryItem(item) {
    if (!this.history) this.history = [];

    let frameThumbnail = null;
    const v = this.slot.video;
    if (v && v.videoWidth > 0 && !v.paused) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(640, v.videoWidth);
        canvas.height = Math.round(canvas.width * (v.videoHeight / v.videoWidth)) || 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        frameThumbnail = canvas.toDataURL('image/jpeg', 0.7);
      } catch (e) {}
    }

    const curTime = this.slot.video?.currentTime || 0;
    const livePos = this.slot.hls?.liveSyncPosition || curTime;
    const offset = Math.max(0, Math.round(livePos - curTime));

    const last = this.history[this.history.length - 1];
    const now = Date.now();
    if (last && (now - last.time < 2800) && (!last.secondary || !last.primary)) {
      if (!last.primary && item.primary) last.primary = item.primary;
      if (!last.secondary && item.secondary) last.secondary = item.secondary;
      if (item.zh && !last.zh) last.zh = item.zh;
      if (item.ko && !last.ko) last.ko = item.ko;
      if (frameThumbnail && !last.frameThumbnail) last.frameThumbnail = frameThumbnail;
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('krstream:subtitle-updated', { detail: { slotId: this.slot.slotId, item: last } }));
      }
      return;
    }

    const newItem = {
      id: `sub_${this.slot.slotId}_${now}_${Math.random().toString(36).slice(2, 7)}`,
      slotId: this.slot.slotId,
      speaker: item.speaker,
      primary: item.primary || item.zh || item.ko || '',
      secondary: item.secondary || (this.isBilingual ? item.ko : ''),
      ko: item.ko || '',
      zh: item.zh || '',
      en: item.en || '',
      time: now,
      currentTime: curTime,
      streamTime: curTime,
      liveOffset: offset,
      frameThumbnail: frameThumbnail
    };

    this.history.push(newItem);
    if (this.history.length > 300) {
      this.history.shift();
    }

    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('krstream:subtitle-added', { detail: { slotId: this.slot.slotId, item: newItem } }));
    }
  }

  /**
   * CI.ME 实时字幕接口轮询
   */
  startCimeCaptions(slug) {
    const rawSlug = slug || this.slot.currentStreamData?.channelId || '';
    const cleanSlug = String(rawSlug).replace(/^@/, '').trim();
    if (!cleanSlug) return;

    this.lastSeq = -1;
    this.seenCaptionKeys = new Set();

    const fetchCaptions = async () => {
      if (!this.enabled) return;
      try {
        const res = await fetch(`https://ci.me/api/app/live-captions/${encodeURIComponent(cleanSlug)}`, {
          headers: {
            'Origin': 'https://ci.me',
            'Referer': `https://ci.me/@${cleanSlug}`
          }
        });
        if (!res.ok) return;

        const json = await res.json();
        if (json && json.data && Array.isArray(json.data.items) && json.data.items.length > 0) {
          const items = json.data.items;

          if (this.lastSeq === -1) {
            const maxSeq = Math.max(...items.map((it) => (typeof it.seq === 'number' ? it.seq : 0)));
            this.lastSeq = Math.max(0, maxSeq - 1);
          }

          const newItems = items.filter((it) => {
            const seq = typeof it.seq === 'number' ? it.seq : 0;
            const key = `${seq}_${it.startedAt || ''}_${it.endedAt || ''}_${JSON.stringify(it.captions || '')}`;
            if (seq <= this.lastSeq || this.seenCaptionKeys.has(key)) return false;
            this.seenCaptionKeys.add(key);
            if (this.seenCaptionKeys.size > 200) {
              const firstKey = this.seenCaptionKeys.values().next().value;
              this.seenCaptionKeys.delete(firstKey);
            }
            return true;
          });

          for (const item of newItems) {
            if (typeof item.seq === 'number' && item.seq > this.lastSeq) {
              this.lastSeq = item.seq;
            }

            const speaker = item.speaker?.name || this.slot.currentStreamData?.streamer || cleanSlug;
            const captions = item.captions || {};
            const primaryObj = getSubtitleLangObj(this.primaryLang) || SUBTITLE_LANGS[0];
            const secObj = getSubtitleLangObj(this.secondaryLang) || SUBTITLE_LANGS[1];

            const rawKorean = (typeof captions === 'string' ? captions : captions.ko || item.text || '').trim();
            let primaryText = (typeof captions === 'string' ? captions : captions[primaryObj.id] || captions[primaryObj.transCode] || captions[primaryObj.soopCode] || '').trim();
            let secText = (captions[secObj.id] || captions[secObj.transCode] || captions[secObj.soopCode] || '').trim();

            if (!primaryText && rawKorean) {
              primaryText = await this.translate(rawKorean, 'ko', primaryObj.transCode);
            }
            if (this.isBilingual && !secText && rawKorean) {
              secText = await this.translate(rawKorean, 'ko', secObj.transCode);
            }

            if (!primaryText && !secText && !rawKorean) continue;

            this.renderSubtitle(speaker, { primary: primaryText || rawKorean, secondary: this.isBilingual ? secText : '' });
            this.addHistoryItem({
              speaker,
              primary: primaryText || rawKorean,
              secondary: this.isBilingual ? secText : '',
              ko: rawKorean,
              zh: primaryObj.id === 'zh-CN' ? primaryText : (secObj.id === 'zh-CN' ? secText : '')
            });
          }
        }
      } catch (e) {}
    };

    fetchCaptions();
    this.pollTimer = setInterval(fetchCaptions, 1000);
  }

  /**
   * SOOP 实时字幕接收 (WebSocket 0137/0136 + 官方 translate-api + 语音识别回退)
   */
  async startSoopCaptions(streamData) {
    let { channelId, bno, streamer } = streamData;
    const speakerName = streamer || channelId;
    let apiSuccess = false;
    let lastTime = 0;

    // 1. 信令通道订阅主副双语实时 AI 字幕 (SVC_USER_LANG_SET: 0137)
    if (this.slot.danmakuEngine) {
      if (!this.slot.danmakuEngine.isConnected) {
        this.slot.danmakuEngine.start(streamData);
      } else {
        this.slot.danmakuEngine.sendSubtitleLang(this.primaryLang, this.secondaryLang, this.isBilingual);
      }
    }

    // 2. 补全 bno
    if (!bno) {
      try {
        const body = new URLSearchParams({
          bid: channelId,
          bno: '',
          type: 'live',
          pwd: '',
          player_type: 'html5',
          stream_type: 'common',
          quality: 'original',
          mode: 'landing',
          from_api: '0',
          is_revive: 'false'
        });

        const res = await fetch(`https://live.sooplive.com/afreeca/player_live_api.php?bjid=${encodeURIComponent(channelId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://play.sooplive.com',
            'Referer': `https://play.sooplive.com/${channelId}`
          },
          body: body.toString()
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.CHANNEL?.BNO) {
            bno = json.CHANNEL.BNO;
            if (this.slot.currentStreamData) {
              this.slot.currentStreamData.bno = bno;
            }
          }
        }
      } catch (e) {}
    }

    // 3. 辅助链路：官方 translate-api (Timeshift)
    const pollSoopCaptions = async () => {
      if (!this.enabled || !bno) return;
      try {
        const primaryObj = getSubtitleLangObj(this.primaryLang) || SUBTITLE_LANGS[0];
        const secObj = getSubtitleLangObj(this.secondaryLang) || SUBTITLE_LANGS[1];

        if (this.isBilingual) {
          const [resP, resS] = await Promise.allSettled([
            fetch(`https://translate-api.sooplive.com/subtitle/live/${bno}?lang=${primaryObj.soopCode}`, {
              headers: { 'Origin': 'https://play.sooplive.com' }
            }),
            fetch(`https://translate-api.sooplive.com/subtitle/live/${bno}?lang=${secObj.soopCode}`, {
              headers: { 'Origin': 'https://play.sooplive.com' }
            })
          ]);

          let pList = [];
          let sList = [];
          if (resP.status === 'fulfilled' && resP.value.ok) {
            const dataP = await resP.value.json();
            pList = dataP.list || [];
          }
          if (resS.status === 'fulfilled' && resS.value.ok) {
            const dataS = await resS.value.json();
            sList = dataS.list || [];
          }

          if (pList.length > 0 || sList.length > 0) {
            apiSuccess = true;
            const targetList = pList.length > 0 ? pList : sList;

            if (lastTime === 0) {
              const latest = targetList[targetList.length - 1];
              lastTime = latest.time;
              const matchingSec = sList.find(s => Math.abs(s.time - latest.time) < 2500)?.msg || '';
              const matchingP = pList.find(p => Math.abs(p.time - latest.time) < 2500)?.msg || '';
              this.renderSubtitle(speakerName, {
                primary: matchingP || latest.msg,
                secondary: matchingSec || ''
              });
            } else {
              const newItems = targetList.filter(item => item.time > lastTime);
              for (const item of newItems) {
                lastTime = Math.max(lastTime, item.time);
                const matchingSec = sList.find(s => Math.abs(s.time - item.time) < 2500)?.msg || '';
                const matchingP = pList.find(p => Math.abs(p.time - item.time) < 2500)?.msg || '';
                this.renderSubtitle(speakerName, {
                  primary: matchingP || item.msg,
                  secondary: matchingSec || ''
                });
              }
            }
          }
        } else {
          const res = await fetch(`https://translate-api.sooplive.com/subtitle/live/${bno}?lang=${primaryObj.soopCode}`, {
            headers: { 'Origin': 'https://play.sooplive.com' }
          });
          if (res.ok) {
            const data = await res.json();
            const list = data.list || [];
            if (list.length > 0) {
              apiSuccess = true;
              if (lastTime === 0) {
                const latest = list[list.length - 1];
                lastTime = latest.time;
                this.renderSubtitle(speakerName, { primary: latest.msg });
              } else {
                const newItems = list.filter(item => item.time > lastTime);
                for (const item of newItems) {
                  lastTime = Math.max(lastTime, item.time);
                  this.renderSubtitle(speakerName, { primary: item.msg });
                }
              }
            }
          }
        }
      } catch (e) {}
    };

    if (bno) {
      pollSoopCaptions();
      this.pollTimer = setInterval(pollSoopCaptions, 1500);
    }
  }

  handleWsSubtitle(rawText, langCode, speaker) {
    if (!this.enabled || !rawText) return;
    this.handleSubtitleReceived(rawText, langCode, speaker);
  }

  renderSubtitle(speaker, content = {}) {
    if (!this.overlayEl || !this.boxEl) return;

    if (speaker && speaker.trim()) {
      this.speakerEl.textContent = speaker.trim();
      this.speakerEl.style.display = 'inline-block';
    } else {
      this.speakerEl.style.display = 'none';
    }

    const mainText = content.primary || content.zh || content.ko || content.en || '';
    const secText = this.isBilingual ? (content.secondary || (content.primary !== content.ko ? content.ko : '')) : '';

    this.mainEl.textContent = mainText;
    if (secText && this.isBilingual) {
      this.secEl.textContent = secText;
      this.secEl.style.display = 'block';
    } else {
      this.secEl.textContent = '';
      this.secEl.style.display = 'none';
    }

    if (mainText || secText) {
      this.boxEl.classList.add('visible');
      if (this.hideTimeout) clearTimeout(this.hideTimeout);
      this.hideTimeout = setTimeout(() => {
        this.boxEl.classList.remove('visible');
      }, 5500);
    }
  }

  clearSubtitle() {
    if (this.boxEl) {
      this.boxEl.classList.remove('visible');
    }
    if (this.mainEl) this.mainEl.textContent = '';
    if (this.secEl) this.secEl.textContent = '';
    if (this.speakerEl) this.speakerEl.style.display = 'none';
  }

  displayToast(msg) {
    if (this.slot.showToast) {
      this.slot.showToast(msg);
    }
  }

  async translate(text, sl = 'ko', tl = 'zh-CN') {
    if (!text || !text.trim() || sl === tl) return text || '';
    const cleanText = text.trim();
    const cacheKey = `${sl}_${tl}_${cleanText}`;
    if (this.translationCache.has(cacheKey)) {
      return this.translationCache.get(cacheKey);
    }

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(cleanText)}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const translated = json?.[0]?.[0]?.[0] || '';
        if (translated) {
          if (this.translationCache.size > 200) {
            const firstKey = this.translationCache.keys().next().value;
            this.translationCache.delete(firstKey);
          }
          this.translationCache.set(cacheKey, translated);
          return translated;
        }
      }
    } catch (e) {}

    return cleanText;
  }

  destroy() {
    this.stop();
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }
}
