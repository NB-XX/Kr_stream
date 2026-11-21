/**
 * KRStream - YouTube-Style SuperChat / Gift / Subscription Banner & History Engine
 */

export class SuperChatEngine {
  constructor(slot) {
    this.slot = slot;
    this.enabled = this.loadEnabledState();
    this.history = [];
    this.maxHistory = 200;
    this.maxFloatingCards = 3;
    this.filterType = 'all'; // 'all' | 'donation' | 'subscription'

    this.overlayEl = null;
    this.btnEl = null;
    this.badgeEl = null;
    this.panelEl = null;

    this.initUI();
  }

  loadEnabledState() {
    try {
      const val = localStorage.getItem('krstream_sc_enabled');
      return val === null ? true : val === 'true';
    } catch (e) {
      return true;
    }
  }

  saveEnabledState() {
    try {
      localStorage.setItem('krstream_sc_enabled', String(this.enabled));
    } catch (e) {}
  }

  initUI() {
    const videoContainer = this.slot.dom?.querySelector('.video-container');
    if (videoContainer) {
      const overlay = document.createElement('div');
      overlay.className = 'slot-sc-overlay';
      overlay.id = `sc-overlay-${this.slot.slotId}`;
      videoContainer.appendChild(overlay);
      this.overlayEl = overlay;
    }

    const controlsRight = this.slot.dom?.querySelector('.controls-right');
    if (controlsRight) {
      const btn = document.createElement('button');
      btn.className = `ctrl-icon-btn btn-sc ${this.enabled ? 'active' : ''}`;
      btn.id = `btn-sc-${this.slot.slotId}`;
      btn.title = 'SC醒目条 (右键打赏记录)';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <path d="M14.8 9A2.8 2.8 0 0 0 12 7.5c-1.5 0-2.5.9-2.5 2s1 1.8 2.5 2.2c1.5.4 2.8 1 2.8 2.3s-1.2 2.2-2.8 2.2a2.8 2.8 0 0 1-2.8-1.5"/>
          <path d="M12 6v1.5M12 16.5V18"/>
        </svg>
        <span class="btn-sc-tag" id="btn-sc-tag-${this.slot.slotId}">SC</span>
        <span class="ctrl-sc-badge" id="ctrl-sc-badge-${this.slot.slotId}" style="display:none;">0</span>
      `;

      const btnDanmaku = this.slot.dom.querySelector(`#btn-danmaku-${this.slot.slotId}`);
      const btnSubs = this.slot.dom.querySelector(`#btn-subs-${this.slot.slotId}`);
      const anchor = btnDanmaku || btnSubs;
      if (anchor) {
        controlsRight.insertBefore(btn, anchor);
      } else {
        controlsRight.appendChild(btn);
      }

      this.btnEl = btn;
      this.badgeEl = btn.querySelector(`#ctrl-sc-badge-${this.slot.slotId}`);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleHistoryPanel();
      });
    }

    this.createHistoryPanel();
  }

  createHistoryPanel() {
    if (typeof document === 'undefined') return;
    const panel = document.createElement('div');
    panel.className = 'sc-history-panel';
    panel.id = `sc-history-panel-${this.slot.slotId}`;
    panel.innerHTML = `
      <div class="sc-panel-header">
        <span class="sc-panel-title">打赏记录 (<span id="sc-panel-count-${this.slot.slotId}">0</span>)</span>
        <div class="sc-panel-actions">
          <button class="sc-filter-btn active" data-filter="all">全部</button>
          <button class="sc-filter-btn" data-filter="donation">打赏</button>
          <button class="sc-filter-btn" data-filter="subscription">订阅</button>
          <button class="sc-clear-btn" id="sc-clear-btn-${this.slot.slotId}">清空</button>
        </div>
      </div>
      <div class="sc-panel-list" id="sc-panel-list-${this.slot.slotId}">
        <div class="sc-panel-empty">暂无打赏记录</div>
      </div>
    `;

    document.body.appendChild(panel);
    this.panelEl = panel;

    panel.querySelectorAll('.sc-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filterType = btn.dataset.filter || 'all';
        panel.querySelectorAll('.sc-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderHistoryPanel();
      });
    });

    const clearBtn = panel.querySelector(`#sc-clear-btn-${this.slot.slotId}`);
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.history = [];
        this.updateBadge();
        this.renderHistoryPanel();
      });
    }

    document.addEventListener('click', (e) => {
      if (this.panelEl && this.panelEl.classList.contains('active')) {
        if (!this.panelEl.contains(e.target) && e.target !== this.btnEl && !this.btnEl?.contains(e.target)) {
          this.panelEl.classList.remove('active');
        }
      }
    });
  }

  toggle() {
    this.enabled = !this.enabled;
    this.saveEnabledState();
    this.updateButtonState();
    if (!this.enabled && this.overlayEl) {
      this.overlayEl.innerHTML = '';
    }
  }

  updateButtonState() {
    if (!this.btnEl) return;
    this.btnEl.classList.toggle('active', this.enabled);
  }

  toggleHistoryPanel() {
    if (!this.panelEl) return;
    if (this.panelEl.classList.contains('active')) {
      this.panelEl.classList.remove('active');
      return;
    }

    this.renderHistoryPanel();
    this.panelEl.classList.add('active');

    if (this.btnEl) {
      const rect = this.btnEl.getBoundingClientRect();
      const panelWidth = 300;
      const panelHeight = 340;
      const left = Math.min(window.innerWidth - panelWidth - 10, Math.max(10, rect.left - panelWidth / 2 + rect.width / 2));
      const top = Math.max(10, rect.top - panelHeight - 8);
      this.panelEl.style.left = `${left}px`;
      this.panelEl.style.top = `${top}px`;
    }
  }

  reset() {
    this.history = [];
    if (this.overlayEl) {
      this.overlayEl.innerHTML = '';
    }
    this.updateBadge();
    if (this.panelEl?.classList.contains('active')) {
      this.renderHistoryPanel();
    }
  }

  /**
   * 根据打赏类型与金额计算 YouTube SuperChat 配色等级
   */
  static getYouTubeTier(event) {
    if (event.type === 'subscription' || event.type === 'gift') {
      return {
        name: 'sub-green',
        headerBg: '#0b8043',
        bodyBg: '#0f9d58',
        textColor: '#ffffff',
        durationMs: 7000
      };
    }

    // 统一换算为等效 KRW 价值: Chzzk 1 치즈 ≈ 1 KRW, SOOP 1 별풍선 ≈ 100 KRW
    const rawAmount = Number(event.amount) || 0;
    const krwValue = event.platform === 'soop' ? rawAmount * 100 : rawAmount;

    if (krwValue >= 100000) {
      return {
        name: 'sc-red',
        headerBg: '#c2185b',
        bodyBg: '#e91e63',
        textColor: '#ffffff',
        durationMs: 15000
      };
    }
    if (krwValue >= 50000) {
      return {
        name: 'sc-orange',
        headerBg: '#e65100',
        bodyBg: '#f57c00',
        textColor: '#ffffff',
        durationMs: 12000
      };
    }
    if (krwValue >= 10000) {
      return {
        name: 'sc-yellow',
        headerBg: '#f57f17',
        bodyBg: '#ffb300',
        textColor: '#111827',
        durationMs: 10000
      };
    }
    if (krwValue >= 5000) {
      return {
        name: 'sc-cyan',
        headerBg: '#00838f',
        bodyBg: '#00acc1',
        textColor: '#ffffff',
        durationMs: 8000
      };
    }
    return {
      name: 'sc-blue',
      headerBg: '#1565c0',
      bodyBg: '#1e88e5',
      textColor: '#ffffff',
      durationMs: 6500
    };
  }

  handleEvent(rawEvent) {
    if (!rawEvent) return;
    const tier = SuperChatEngine.getYouTubeTier(rawEvent);
    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: rawEvent.type || 'donation', // 'donation' | 'subscription' | 'gift'
      platform: rawEvent.platform || this.slot.currentStreamData?.platform || 'chzzk',
      sender: String(rawEvent.sender || '观众').trim(),
      avatar: rawEvent.avatar || '',
      amount: Number(rawEvent.amount) || 0,
      amountLabel: String(rawEvent.amountLabel || '').trim(),
      message: String(rawEvent.message || '').trim(),
      time: rawEvent.time || Date.now(),
      tier
    };

    // 始终记录到历史列表 (即使暂时关闭画面浮层)
    this.history.unshift(record);
    if (this.history.length > this.maxHistory) {
      this.history.length = this.maxHistory;
    }
    this.updateBadge();

    if (this.panelEl?.classList.contains('active')) {
      this.renderHistoryPanel();
    }

    if (this.enabled) {
      this.showFloatingCard(record);
    }
  }

  updateBadge() {
    if (!this.badgeEl) return;
    const count = this.history.length;
    this.badgeEl.textContent = count > 99 ? '99+' : String(count);
    this.badgeEl.style.display = count > 0 ? 'inline-block' : 'none';
  }

  buildCardHtml(record, isHistory = false) {
    const escapeHtml = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const safeSender = escapeHtml(record.sender);
    const safeAmount = escapeHtml(record.amountLabel);
    const safeMsg = escapeHtml(record.message);
    const initial = escapeHtml((record.sender || 'U').slice(0, 1).toUpperCase());

    const avatarHtml = record.avatar
      ? `<img class="yt-sc-avatar" src="${escapeHtml(record.avatar)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="yt-sc-avatar-fallback" style="display:none;">${initial}</span>`
      : `<span class="yt-sc-avatar-fallback">${initial}</span>`;

    const d = new Date(record.time);
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

    const closeBtnHtml = isHistory
      ? `<span class="yt-sc-time">${timeStr}</span>`
      : `<button class="yt-sc-close" type="button" title="关闭">&times;</button>`;

    const bodyHtml = safeMsg
      ? `<div class="yt-sc-body" style="background:${record.tier.bodyBg};color:${record.tier.textColor};">${safeMsg}</div>`
      : '';

    return `
      <div class="yt-sc-header" style="background:${record.tier.headerBg};color:${record.tier.textColor};">
        <div class="yt-sc-avatar-wrap">${avatarHtml}</div>
        <div class="yt-sc-meta">
          <div class="yt-sc-author" title="${safeSender}">${safeSender}</div>
          <div class="yt-sc-amount">${safeAmount}</div>
        </div>
        ${closeBtnHtml}
      </div>
      ${bodyHtml}
    `;
  }

  showFloatingCard(record) {
    if (!this.overlayEl) return;

    while (this.overlayEl.childElementCount >= this.maxFloatingCards) {
      const oldest = this.overlayEl.firstElementChild;
      if (oldest) {
        if (oldest._dismissTimer) clearTimeout(oldest._dismissTimer);
        oldest.remove();
      } else {
        break;
      }
    }

    const card = document.createElement('div');
    card.className = `yt-sc-card ${record.tier.name}`;
    card.innerHTML = this.buildCardHtml(record, false);

    const closeBtn = card.querySelector('.yt-sc-close');
    const dismiss = () => {
      if (card._dismissTimer) clearTimeout(card._dismissTimer);
      card.classList.add('leaving');
      setTimeout(() => card.remove(), 220);
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
      });
    }

    this.overlayEl.appendChild(card);
    card._dismissTimer = setTimeout(dismiss, record.tier.durationMs || 8000);
  }

  renderHistoryPanel() {
    if (!this.panelEl) return;
    const countEl = this.panelEl.querySelector(`#sc-panel-count-${this.slot.slotId}`);
    const listEl = this.panelEl.querySelector(`#sc-panel-list-${this.slot.slotId}`);
    if (!listEl) return;

    const filtered = this.history.filter((item) => {
      if (this.filterType === 'all') return true;
      if (this.filterType === 'subscription') return item.type === 'subscription' || item.type === 'gift';
      return item.type === 'donation';
    });

    if (countEl) countEl.textContent = String(this.history.length);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="sc-panel-empty">暂无打赏记录</div>`;
      return;
    }

    listEl.innerHTML = '';
    for (const item of filtered) {
      const card = document.createElement('div');
      card.className = `yt-sc-card yt-sc-history-card ${item.tier.name}`;
      card.innerHTML = this.buildCardHtml(item, true);
      listEl.appendChild(card);
    }
  }

  destroy() {
    if (this.overlayEl) this.overlayEl.remove();
    if (this.panelEl) this.panelEl.remove();
  }
}
