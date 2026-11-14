/**
 * KRStream Hub - Live Danmaku Engine (弹幕引擎)
 * 专为 SOOP、Chzzk 与 CI.ME 打造的原生实时弹幕 (Niconico / Bilibili 弹幕样式)
 */

export class DanmakuEngine {
  constructor(slot) {
    this.slot = slot;
    this.enabled = true; // 默认开启
    this.opacity = 0.9;
    this.fontSize = 20; // 默认 20px
    this.speed = 6.5; // 默认 6.5 秒飞过全屏
    this.screenArea = 0.8; // 默认占用屏幕上方 80%，避让底部字幕
    
    // 网络与连接
    this.activeSocket = null;
    this.pingTimer = null;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.isConnected = false;

    // 弹幕去重缓存 (防止双重连接或重传造成弹幕出现两遍)
    this.recentDanmaku = new Map();

    // 表情映射缓存 (支持 Chzzk {:id:} 及 SOOP 签名表情与基础表情)
    this.emojiCache = new Map();
    this._soopManifestLoaded = false;

    // 弹幕轨道调度 (防止重叠碰撞)
    this.tracks = []; // 记录每个轨道的可用时间戳 (ms)

    // 高并发保护与 DOM 对象池 (防止万人直播间弹幕风暴造成卡顿与内存溢出)
    this.maxOnScreen = 50; // 同屏弹幕上限，超额平滑丢弃普通弹幕
    this.domPool = []; // DOM 对象池复用，杜绝频繁 GC 抖动

    // DOM 引用
    this.containerEl = null;
    this.btnEl = null;
    this.menuEl = null;

    this.initUI();
  }

  initUI() {
    const videoContainer = this.slot.dom.querySelector('.video-container');
    if (!videoContainer) return;

    // 1. 创建视频内弹幕图层 (置于视频上方，字幕下方，pointer-events: none)
    const container = document.createElement('div');
    container.className = 'slot-danmaku-overlay';
    container.id = `danmaku-overlay-${this.slot.slotId}`;
    videoContainer.appendChild(container);
    this.containerEl = container;

    // 2. 控制栏按钮 (右侧)
    const controlsRight = this.slot.dom.querySelector('.controls-right');
    if (controlsRight) {
      const btn = document.createElement('button');
      btn.className = `ctrl-icon-btn btn-danmaku ${this.enabled ? 'active' : ''}`;
      btn.id = `btn-danmaku-${this.slot.slotId}`;
      btn.title = '实时弹幕: 开启 (右键设置)';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          <line x1="9" y1="10" x2="15" y2="10"/>
        </svg>
        <span class="btn-danmaku-tag" id="btn-danmaku-tag-${this.slot.slotId}">弹幕</span>
      `;

      // 插入在清晰度/字幕按钮附近
      const btnSubs = this.slot.dom.querySelector(`#btn-subs-${this.slot.slotId}`);
      if (btnSubs) {
        controlsRight.insertBefore(btn, btnSubs);
      } else {
        controlsRight.appendChild(btn);
      }

      this.btnEl = btn;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showSettingsMenu();
      });
    }

    // 3. 创建弹幕设置菜单 (底栏弹幕按钮右键可呼出)
    this.createSettingsMenu();
  }

  createSettingsMenu() {
    const menu = document.createElement('div');
    menu.className = 'danmaku-settings-menu';
    menu.id = `danmaku-menu-${this.slot.slotId}`;
    menu.innerHTML = `
      <div class="sub-menu-header">
        <span class="sub-menu-title">实时弹幕设置</span>
        <span class="sub-menu-status" id="danmaku-status-${this.slot.slotId}">${this.enabled ? '已开启' : '已关闭'}</span>
      </div>
      <div class="sub-menu-group">
        <label class="sub-group-label">不透明度:</label>
        <div class="sub-options" id="danmaku-opacity-opts-${this.slot.slotId}">
          <button class="sub-opt-btn ${this.opacity === 1.0 ? 'active' : ''}" data-val="1.0">100%</button>
          <button class="sub-opt-btn ${this.opacity === 0.8 ? 'active' : ''}" data-val="0.8">80%</button>
          <button class="sub-opt-btn ${this.opacity === 0.6 ? 'active' : ''}" data-val="0.6">60%</button>
          <button class="sub-opt-btn ${this.opacity === 0.4 ? 'active' : ''}" data-val="0.4">40%</button>
        </div>
      </div>
      <div class="sub-menu-group">
        <label class="sub-group-label">弹幕字号:</label>
        <div class="sub-options" id="danmaku-size-opts-${this.slot.slotId}">
          <button class="sub-opt-btn ${this.fontSize === 16 ? 'active' : ''}" data-val="16">小 (16px)</button>
          <button class="sub-opt-btn ${this.fontSize === 20 ? 'active' : ''}" data-val="20">中 (20px)</button>
          <button class="sub-opt-btn ${this.fontSize === 24 ? 'active' : ''}" data-val="24">大 (24px)</button>
        </div>
      </div>
      <div class="sub-menu-group">
        <label class="sub-group-label">飞行速度:</label>
        <div class="sub-options" id="danmaku-speed-opts-${this.slot.slotId}">
          <button class="sub-opt-btn ${this.speed === 8.5 ? 'active' : ''}" data-val="8.5">慢速 (8.5s)</button>
          <button class="sub-opt-btn ${this.speed === 6.5 ? 'active' : ''}" data-val="6.5">标准 (6.5s)</button>
          <button class="sub-opt-btn ${this.speed === 4.8 ? 'active' : ''}" data-val="4.8">极速 (4.8s)</button>
        </div>
      </div>
      <div class="sub-menu-group">
        <label class="sub-group-label">展示区域:</label>
        <div class="sub-options" id="danmaku-area-opts-${this.slot.slotId}">
          <button class="sub-opt-btn ${this.screenArea === 0.5 ? 'active' : ''}" data-val="0.5">半屏 (50%)</button>
          <button class="sub-opt-btn ${this.screenArea === 0.8 ? 'active' : ''}" data-val="0.8">大部 (80%)</button>
          <button class="sub-opt-btn ${this.screenArea === 1.0 ? 'active' : ''}" data-val="1.0">全屏 (100%)</button>
        </div>
      </div>
      <div class="sub-menu-tip">
        采用 GPU 硬件加速平滑滚动，已针对 SOOP / Chzzk 自动防重叠分轨。
      </div>
    `;

    document.body.appendChild(menu);
    this.menuEl = menu;

    // 绑定事件
    const bindOpts = (id, callback) => {
      menu.querySelectorAll(`#${id}-${this.slot.slotId} .sub-opt-btn`).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = parseFloat(btn.dataset.val);
          callback(val);
          menu.querySelectorAll(`#${id}-${this.slot.slotId} .sub-opt-btn`).forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    };

    bindOpts('danmaku-opacity-opts', (v) => { this.opacity = v; });
    bindOpts('danmaku-size-opts', (v) => { this.fontSize = v; });
    bindOpts('danmaku-speed-opts', (v) => { this.speed = v; });
    bindOpts('danmaku-area-opts', (v) => { this.screenArea = v; });

    document.addEventListener('click', (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target) && e.target !== this.btnEl) {
        this.menuEl.classList.remove('active');
      }
    });
  }

  showSettingsMenu(x = null, y = null) {
    if (!this.menuEl) return;
    if (x !== null && y !== null) {
      const menuWidth = 250;
      const menuHeight = 280;
      const left = Math.min(window.innerWidth - menuWidth - 10, Math.max(10, x));
      const top = Math.min(window.innerHeight - menuHeight - 10, Math.max(10, y - menuHeight));
      this.menuEl.style.left = `${left}px`;
      this.menuEl.style.top = `${top}px`;
      this.menuEl.style.bottom = 'auto';
      this.menuEl.classList.add('active');
    } else if (this.btnEl) {
      const rect = this.btnEl.getBoundingClientRect();
      this.menuEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      this.menuEl.style.top = 'auto';
      this.menuEl.style.left = `${Math.max(10, rect.left - 80)}px`;
      this.menuEl.classList.toggle('active');
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    this.updateButtonState();
    if (this.containerEl) {
      this.containerEl.style.display = this.enabled ? 'block' : 'none';
      if (!this.enabled) {
        this.containerEl.innerHTML = '';
      }
    }
    const statusEl = this.menuEl?.querySelector(`#danmaku-status-${this.slot.slotId}`);
    if (statusEl) statusEl.textContent = this.enabled ? '已开启' : '已关闭';
  }

  updateButtonState() {
    if (!this.btnEl) return;
    if (this.enabled) {
      this.btnEl.classList.add('active');
      this.btnEl.title = '实时弹幕: 已开启 (右键设置)';
    } else {
      this.btnEl.classList.remove('active');
      this.btnEl.title = '实时弹幕: 已关闭 (右键设置)';
    }
  }

  /**
   * 启动实时聊天弹幕获取
   */
  start(streamData) {
    const data = streamData || this.slot.currentStreamData;
    if (!data || !data.isLive) return;

    // 若当前连接已处于连接中或开启状态，且为相同频道，无需重复建立底层 Socket
    if (this.activeSocket && 
        (this.activeSocket.readyState === WebSocket.OPEN || this.activeSocket.readyState === WebSocket.CONNECTING) &&
        this.currentChannelId === data.channelId &&
        this.currentPlatform === data.platform) {
      if (data.platform === 'soop' && this.slot.subtitleEngine?.enabled && this.isConnected) {
        this.sendSubtitleLang(this.slot.subtitleEngine.mode);
      }
      return;
    }

    this.stop();
    this.currentChannelId = data.channelId;
    this.currentPlatform = data.platform;

    switch (data.platform) {
      case 'chzzk':
        this.startChzzkChat(data);
        break;
      case 'soop':
        this.startSoopChat(data);
        break;
      case 'cime':
        this.startCimeChat(data);
        break;
    }
  }

  stop() {
    this.currentChannelId = null;
    this.currentPlatform = null;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.activeSocket) {
      try { this.activeSocket.close(); } catch (e) {}
      this.activeSocket = null;
    }
    this.closeSecondarySocket();
    this.isConnected = false;
    this.tracks = [];
    if (this.containerEl) {
      this.containerEl.innerHTML = '';
    }
  }

  /**
   * 加载 SOOP 官方默认表情清单 (含 350+ 个经典表情如 /샤방/, /윽/)
   */
  async initSoopManifest() {
    if (this._soopManifestLoaded) return;
    this._soopManifestLoaded = true;
    try {
      const res = await fetch('https://res.sooplive.com/manifests/chat/emoticons.json');
      if (res.ok) {
        const data = await res.json();
        const base = 'https://res.sooplive.com/images/chat/emoticon/big/';
        const all = [...(data.default || []), ...(data.subscribe || [])];
        for (const item of all) {
          if (item.keyword && item.fileName) {
            const url = base + item.fileName;
            this.emojiCache.set(item.keyword, url);
            const cleanWord = item.keyword.replace(/\//g, '');
            this.emojiCache.set(cleanWord, url);
          }
        }
      }
    } catch (e) {}
  }

  /**
   * 加载当前 SOOP 主播的专属签名表情 (Signature Emoticons)
   */
  async loadSoopSignatureEmoticons(bjId) {
    if (!bjId) return;
    try {
      const url = 'https://live.sooplive.com/api/signature_emoticon_api.php';
      const body = new URLSearchParams({ work: 'list', v: 'tier', szBjId: bjId });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (res.ok) {
        const data = await res.json();
        const imgPath = data.img_path || `https://static.file.sooplive.com/signature_emoticon/${bjId}/`;
        const list = [...(data.data?.tier1 || []), ...(data.data?.tier2 || [])];
        for (const item of list) {
          const imgName = item.pc_img || item.mobile_img;
          if (imgName && item.title) {
            const fullUrl = imgPath + imgName;
            this.emojiCache.set(item.title, fullUrl);
            this.emojiCache.set(`/${item.title}/`, fullUrl);
          }
        }
      }
    } catch (e) {}
  }

  /**
   * ==========================================
   * 1. SOOP 弹幕接入
   * ==========================================
   */
  async startSoopChat(streamData) {
    let { channelId, chatDomain, chatPort, chatNo } = streamData;

    // 若流信息中未携带，从 API 补充
    if (!chatDomain || !chatPort || !chatNo) {
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
          if (json?.CHANNEL) {
            chatDomain = json.CHANNEL.CHDOMAIN || chatDomain;
            chatPort = json.CHANNEL.CHPT ? parseInt(json.CHANNEL.CHPT, 10) : chatPort;
            chatNo = json.CHANNEL.CHATNO || chatNo;
          }
        }
      } catch (e) {}
    }

    if (!chatDomain || !chatPort || !chatNo) return;

    // 预加载当前主播的专属签名表情与官方默认表情
    this.initSoopManifest();
    this.loadSoopSignatureEmoticons(channelId);

    try {
      const STARTER = '\u001d\t';
      const SEPARATOR = '\x0c';
      this.assignedUuid = '00000000-0000-0000-0000-000000000000';
      const makePacket = (opcode, payload) => {
        const len = new TextEncoder().encode(payload).length;
        const lenStr = String(len).padStart(6, '0');
        return `${STARTER}${opcode}${lenStr}00${this.assignedUuid}${payload}`;
      };
      this.makeSoopPacket = makePacket;

      const port = parseInt(chatPort, 10) + 1;
      const wsUrl = `wss://${chatDomain.toLowerCase()}:${port}/Websocket/${encodeURIComponent(channelId)}`;
      console.log(`[KRStream Danmaku] 窗口 #${this.slot.slotId} 连接 SOOP 弹幕 WS: ${wsUrl}`);

      const ws = new WebSocket(wsUrl, 'chat');
      this.activeSocket = ws;

      ws.onopen = () => {
        this.isConnected = true;
        // 1. 发送连接握手 (0001)
        const connectPayload = `${SEPARATOR.repeat(3)}0${SEPARATOR}`;
        ws.send(makePacket('0001', connectPayload));
      };

      ws.onmessage = async (event) => {
        let text = event.data;
        if (text instanceof ArrayBuffer) {
          text = new TextDecoder('utf-8').decode(text);
        } else if (text instanceof Blob) {
          text = await text.text();
        }
        if (typeof text !== 'string') return;

        const isHeader = text.startsWith('\u001b\t') || text.startsWith('\u001d\t');
        if (isHeader) {
          const opcode = text.slice(2, 6);
          if (text.length >= 50) {
            const uuid = text.slice(14, 50).trim();
            if (uuid && uuid !== '00000000-0000-0000-0000-000000000000') {
              this.assignedUuid = uuid;
            }
          }
          let payload = text.length >= 50 ? text.slice(50) : text.slice(14);
          if (payload.length >= 36 && payload.slice(0, 36).includes('-')) {
            payload = payload.slice(36);
          }

          if (opcode === '0001') {
            // 保存服务端下发的会话 UUID (偏移 14-50)
            this.assignedUuid = text.slice(14, 50);
            // 2. 发送进房指令 (0002)
            const joinPayload = `${SEPARATOR}${chatNo}${SEPARATOR}${SEPARATOR}0${SEPARATOR}${SEPARATOR}${SEPARATOR}`;
            ws.send(makePacket('0002', joinPayload));

            // 心跳保持 (每 30 秒)
            if (this.pingTimer) clearInterval(this.pingTimer);
            this.pingTimer = setInterval(() => {
              if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
                this.activeSocket.send(makePacket('0000', SEPARATOR));
              }
            }, 30000);
            return;
          }

          if (opcode === '0002') {
            console.log(`[KRStream Danmaku] 窗口 #${this.slot.slotId} SOOP 直播信道接通 (#${chatNo})`);
            // 若当前窗口已开启字幕，立即向服务端订阅字幕 (SVC_USER_LANG_SET: 0137)
            if (this.slot.subtitleEngine?.enabled) {
              const eng = this.slot.subtitleEngine;
              this.sendSubtitleLang(eng.primaryLang || 'zh-CN', eng.secondaryLang || 'ko', eng.isBilingual !== false);
            }
            return;
          }

          if (opcode === '0005') {
            // 收到用户弹幕
            const parts = payload.split(SEPARATOR);
            const comment = parts[1];
            const user = parts[6] || parts[2] || '';
            if (comment) {
              this.addDanmaku(comment, user);
            }
          }

          // 转发官方 SVC_GLOBAL_SUBTITLE (0136) 与备用字幕信令
          if ((opcode === '0136' || opcode === '0122' || opcode === '0139') && this.slot.subtitleEngine?.enabled) {
            const cleanParts = payload.split(SEPARATOR).filter(p => p !== '');
            // cleanParts: [chno, bjId, lang, subtitle, timestamp, ...]
            let lang = '';
            let subText = '';
            if (cleanParts.length >= 4) {
              lang = cleanParts[2];
              subText = cleanParts[3];
            } else if (cleanParts.length >= 2) {
              subText = cleanParts[cleanParts.length - 1];
            } else if (cleanParts.length === 1) {
              subText = cleanParts[0];
            }
            if (subText && typeof subText === 'string') {
              console.log(`[KRStream] 窗口 #${this.slot.slotId} 收到 SOOP 官方实时字幕 [${lang}]: ${subText}`);
              this.slot.subtitleEngine.handleSubtitleReceived(subText.trim(), lang, streamData.streamer || channelId);
            }
          }
        }

        // GreasyFork 591429 字幕流协议兼容检查
        let parseText = text;
        if (!parseText.includes(SEPARATOR) && /^[A-Za-z0-9+/=]+$/.test(parseText) && parseText.length > 20) {
          try {
            const bin = atob(parseText);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            parseText = new TextDecoder('utf-8').decode(bytes);
          } catch (e) {}
        }
        if (parseText.includes(SEPARATOR) && this.slot.subtitleEngine?.enabled) {
          const parts = parseText.split(SEPARATOR);
          const idIndex = parts.indexOf(channelId);
          if (idIndex !== -1 && (idIndex + 2) < parts.length) {
            const rawSub = parts[idIndex + 2];
            const langCode = parts[idIndex + 1];
            if (rawSub && typeof rawSub === 'string' && langCode && langCode.length < 5) {
              this.slot.subtitleEngine.handleSubtitleReceived(rawSub.trim(), langCode, streamData.streamer || channelId);
            }
          }
        }
      };

      ws.onclose = () => {
        this.isConnected = false;
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (this.enabled && this.activeSocket === ws) {
          this.reconnectTimer = setTimeout(() => {
            if (this.enabled) this.startSoopChat(streamData);
          }, 6000);
        }
      };
    } catch (e) {
      console.warn('[KRStream Danmaku] SOOP 弹幕连接异常:', e);
    }
  }

  /**
   * 关闭次级双语辅助 WebSocket
   */
  closeSecondarySocket() {
    if (this.secondarySocket) {
      try { this.secondarySocket.close(); } catch (e) {}
      this.secondarySocket = null;
    }
  }

  /**
   * 建立 SOOP 双语辅助信道：专门订阅次级语言 (Opcode 0137: langNum)
   * 主信道接收弹幕与主语言官方翻译，次级信道接收次级语言，实现真正的低延迟多语言双语字幕同屏
   */
  startSoopSecondarySocket(streamData, langNum = 0, langLabel = '한국어') {
    this.closeSecondarySocket();
    const data = streamData || this.slot.currentStreamData || this.slot.streamData;
    if (!data) return;
    const { channelId, chatDomain, chatPort, chatNo } = data;
    if (!chatDomain || !chatPort || !chatNo) return;

    // 预加载当前主播的专属签名表情与官方默认表情
    this.initSoopManifest();
    this.loadSoopSignatureEmoticons(channelId);

    try {
      const port = parseInt(chatPort, 10) + 1;
      const wsUrl = `wss://${chatDomain.toLowerCase()}:${port}/Websocket/${encodeURIComponent(channelId)}`;
      const ws = new WebSocket(wsUrl, 'chat');
      this.secondarySocket = ws;

      let secUuid = '00000000-0000-0000-0000-000000000000';
      const STARTER = '\u001d\t';
      const SEPARATOR = '\x0c';
      const makePacket = (opcode, payload) => {
        const len = new TextEncoder().encode(payload).length;
        const lenStr = String(len).padStart(6, '0');
        return `${STARTER}${opcode}${lenStr}00${secUuid}${payload}`;
      };

      ws.onopen = () => {
        // 握手 0001
        const connectPayload = `${SEPARATOR}${SEPARATOR}${SEPARATOR}0${SEPARATOR}`;
        ws.send(makePacket('0001', connectPayload));
      };

      ws.onmessage = async (event) => {
        let text = event.data;
        if (text instanceof ArrayBuffer) text = new TextDecoder('utf-8').decode(text);
        else if (text instanceof Blob) text = await text.text();
        if (typeof text !== 'string') return;

        if (text.startsWith('\u001b\t') || text.startsWith('\u001d\t')) {
          const opcode = text.slice(2, 6);
          if (text.length >= 50) {
            const uuid = text.slice(14, 50).trim();
            if (uuid && uuid !== '00000000-0000-0000-0000-000000000000') secUuid = uuid;
          }
          const payload = text.length >= 50 ? text.slice(50) : text.slice(14);

          if (opcode === '0001') {
            secUuid = text.slice(14, 50);
            const joinPayload = `${SEPARATOR}${chatNo}${SEPARATOR}${SEPARATOR}0${SEPARATOR}${SEPARATOR}${SEPARATOR}`;
            ws.send(makePacket('0002', joinPayload));
          } else if (opcode === '0002') {
            // 进房成功，立即向服务端订阅次级语言 (langNum)
            ws.send(makePacket('0137', `${SEPARATOR}${langNum}${SEPARATOR}`));
            console.log(`[KRStream Danmaku] 窗口 #${this.slot.slotId} SOOP 次级双语信道订阅 (${langLabel}: ${langNum})`);
          } else if (opcode === '0136' && this.slot.subtitleEngine?.enabled) {
            const cleanParts = payload.split(SEPARATOR).filter(p => p !== '');
            let subText = '';
            if (cleanParts.length >= 4) {
              subText = cleanParts[3];
            } else if (cleanParts.length >= 2) {
              subText = cleanParts[cleanParts.length - 1];
            } else if (cleanParts.length === 1) {
              subText = cleanParts[0];
            }
            if (subText && typeof subText === 'string') {
              this.slot.subtitleEngine.handleSubtitleReceived(subText.trim(), String(langNum), data.streamer || channelId);
            }
          }
        }
      };

      ws.onclose = () => {
        if (this.secondarySocket === ws) this.secondarySocket = null;
      };
    } catch (e) {
      console.warn('[KRStream] SOOP 双语次级信道建立失败:', e);
    }
  }

  makeSoopPacket(opcode, payload, uuid = this.assignedUuid || '00000000-0000-0000-0000-000000000000') {
    const STARTER = '\u001d\t';
    const len = new TextEncoder().encode(payload).length;
    const lenStr = String(len).padStart(6, '0');
    return `${STARTER}${opcode}${lenStr}00${uuid}${payload}`;
  }

  /**
   * 向 SOOP 服务端订阅指定语言的实时 AI 字幕 (SVC_USER_LANG_SET: 0137)
   * 支持中繁简日韩英泰越印尼 8 种语言动态主副字幕订阅
   */
  sendSubtitleLang(primaryLang = 'zh-CN', secondaryLang = 'ko', isBilingual = true) {
    const isOpen = this.activeSocket && (this.activeSocket.readyState === 1 || (typeof WebSocket !== 'undefined' && this.activeSocket.readyState === WebSocket.OPEN));
    if (!isOpen) {
      return;
    }
    const SEPARATOR = '\x0c';

    // 兼容旧模式字符 ('off', 'bilingual', 'zh', 'ko', 'en')
    if (typeof primaryLang === 'string') {
      if (primaryLang === 'off') {
        this.closeSecondarySocket();
        this.activeSocket.send(this.makeSoopPacket('0137', `${SEPARATOR}-1${SEPARATOR}`));
        return;
      }
      if (primaryLang === 'zh') { primaryLang = 'zh-CN'; isBilingual = false; }
      else if (primaryLang === 'ko') { primaryLang = 'ko'; isBilingual = false; }
      else if (primaryLang === 'en') { primaryLang = 'en'; isBilingual = false; }
      else if (primaryLang === 'bilingual') { primaryLang = 'zh-CN'; secondaryLang = 'ko'; isBilingual = true; }
    }

    const SUB_LANG_MAP = {
      'zh-CN': { num: 2, label: '中文 简体' },
      'ko':    { num: 0, label: '한국어' },
      'en':    { num: 1, label: 'English' },
      'ja':    { num: 5, label: '日本語' },
      'zh-TW': { num: 3, label: '中文 繁體' },
      'th':    { num: 4, label: 'ไทย' },
      'vi':    { num: 6, label: 'Tiếng Việt' },
      'id':    { num: 7, label: 'Bahasa Indonesia' }
    };

    const p = SUB_LANG_MAP[primaryLang] || SUB_LANG_MAP['zh-CN'];
    const s = SUB_LANG_MAP[secondaryLang] || SUB_LANG_MAP['ko'];

    // 1. 发送主连接订阅
    const payload = `${SEPARATOR}${p.num}${SEPARATOR}`;
    const pkt = this.makeSoopPacket('0137', payload);
    console.log(`[KRStream Danmaku] 窗口 #${this.slot.slotId} 发送 SOOP 主字幕语言订阅 (0137): ${p.label} (langNum=${p.num})`);
    this.activeSocket.send(pkt);

    // 2. 双语模式管理次级独立连接 (主副语言不同时开启)
    if (isBilingual && p.num !== s.num) {
      const data = this.slot.currentStreamData || this.slot.streamData;
      if (data && data.platform === 'soop') {
        this.startSoopSecondarySocket(data, s.num, s.label);
      }
    } else {
      this.closeSecondarySocket();
    }
  }

  /**
   * ==========================================
   * 2. CHZZK 弹幕接入 (Engine.IO JSON 协议)
   * ==========================================
   */
  async startChzzkChat(streamData) {
    const channelId = streamData.channelId;
    let chatChannelId = streamData.chatChannelId;

    // 1. 若没有 chatChannelId，从 live-detail 查询
    if (!chatChannelId) {
      try {
        const detailRes = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${channelId}/live-detail`, {
          headers: {
            'front-client-platform-type': 'PC',
            'Origin': 'https://chzzk.naver.com',
            'Referer': 'https://chzzk.naver.com/'
          }
        });
        if (detailRes.ok) {
          const detailJson = await detailRes.json();
          chatChannelId = detailJson?.content?.chatChannelId;
        }
      } catch (e) {}
    }

    if (!chatChannelId) return;

    // 2. 获取 Access Token
    let accTkn = '';
    try {
      const tokenUrl = `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${chatChannelId}&chatType=STREAMING`;
      const tokenRes = await fetch(tokenUrl, {
        headers: {
          'Origin': 'https://chzzk.naver.com',
          'Referer': 'https://chzzk.naver.com/'
        }
      });
      if (tokenRes.ok) {
        const tokenJson = await tokenRes.json();
        accTkn = tokenJson?.content?.accessToken;
      }
    } catch (e) {}

    if (!accTkn) return;

    try {
      const wsUrl = 'wss://kr-ss1.chat.naver.com/chat';
      console.log(`[KRStream Danmaku] 窗口 #${this.slot.slotId} 连接 Chzzk 弹幕 WS: ${chatChannelId}`);

      const ws = new WebSocket(wsUrl);
      this.activeSocket = ws;

      ws.onopen = () => {
        this.isConnected = true;
        // 发送握手报文 (cmd 100)
        const handshake = {
          ver: '3',
          cmd: 100,
          svcid: 'game',
          cid: chatChannelId,
          bdy: {
            uid: null,
            devType: 2001,
            accTkn: accTkn,
            auth: 'READ'
          },
          tid: 1
        };
        ws.send(JSON.stringify(handshake));

        // 心跳 Ping/Pong (每 20 秒发送 cmd 0)
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
            this.activeSocket.send(JSON.stringify({ ver: '3', cmd: 0 }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const cmd = data?.cmd;
          // 93101: 聊天消息
          if (cmd === 93101) {
            const bdy = data.bdy || [];
            for (const item of bdy) {
              const msgText = item.msg || '';
              let nick = '观众';
              try {
                if (item.profile) {
                  const prof = typeof item.profile === 'string' ? JSON.parse(item.profile) : item.profile;
                  nick = prof.nickname || nick;
                }
              } catch (e) {}

              // 提取并解析表情包映射 (Chzzk 专属表情与订阅表情)
              let emojis = item.emojis || {};
              if (typeof emojis === 'string') {
                try { emojis = JSON.parse(emojis); } catch (e) {}
              }
              if (!emojis || Object.keys(emojis).length === 0) {
                try {
                  const extras = typeof item.extras === 'string' ? JSON.parse(item.extras) : (item.extras || {});
                  if (extras.emojis) {
                    emojis = typeof extras.emojis === 'string' ? JSON.parse(extras.emojis) : extras.emojis;
                  }
                } catch (e) {}
              }

              if (msgText) {
                this.addDanmaku(msgText, nick, { emojis });
              }
            }
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        this.isConnected = false;
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (this.enabled && this.activeSocket === ws) {
          this.reconnectTimer = setTimeout(() => {
            if (this.enabled) this.startChzzkChat(streamData);
          }, 6000);
        }
      };
    } catch (e) {
      console.warn('[KRStream Danmaku] Chzzk 弹幕连接异常:', e);
    }
  }

  /**
   * ==========================================
   * 3. CI.ME 弹幕接入 (轮询)
   * ==========================================
   */
  startCimeChat(streamData) {
    const slug = String(streamData.channelId).replace(/^@/, '');
    const pollCaptions = async () => {
      if (!this.enabled) return;
      try {
        const res = await fetch(`https://ci.me/api/app/live-captions/${slug}`, {
          headers: { 'Origin': 'https://ci.me', 'Referer': `https://ci.me/@${slug}` }
        });
        if (res.ok) {
          const json = await res.json();
          const items = json?.data?.items || [];
          if (items.length > 0) {
            const latest = items[items.length - 1];
            const text = latest.text || latest.captions?.ko || '';
            const speaker = latest.speaker?.name || '';
            if (text && text !== this.lastCimeText) {
              this.lastCimeText = text;
              this.addDanmaku(text, speaker, { isSpeaker: true });
            }
          }
        }
      } catch (e) {}
    };

    pollCaptions();
    this.pollTimer = setInterval(pollCaptions, 2000);
  }

  /**
   * ==========================================
   * 4. 核心：Niconico / Bilibili 弹幕渲染引擎
   * ==========================================
   */
  addDanmaku(text, user = '', options = {}) {
    if (!this.enabled || !this.containerEl) return;
    const cleanText = String(text).trim();
    if (!cleanText) return;

    // 0. 高并发超额保护 (优先保留主播发言与醒目弹幕，普通弹幕超额平滑丢弃，保障 60 FPS 流畅度)
    if (this.containerEl.childElementCount >= this.maxOnScreen) {
      if (!options.isSpeaker && !options.isHighlight) {
        return;
      }
      const oldest = this.containerEl.querySelector('.danmaku-item:not(.danmaku-speaker)');
      if (oldest) {
        this.recycleDanmakuElement(oldest);
      }
    }

    // 弹幕消息去重 (3 秒滑动窗口，相同发送者和内容只展示一次)
    const hash = `${user}:${cleanText}`;
    const now = Date.now();
    if (this.recentDanmaku.has(hash) && (now - this.recentDanmaku.get(hash)) < 3000) {
      return; // 过滤重复弹幕
    }
    this.recentDanmaku.set(hash, now);
    if (this.recentDanmaku.size > 200) {
      for (const [k, t] of this.recentDanmaku) {
        if (now - t > 6000) this.recentDanmaku.delete(k);
      }
    }

    // 1. 缓存传入的表情映射字典 (Chzzk / 外部消息携带)
    if (options.emojis && typeof options.emojis === 'object') {
      for (const [k, v] of Object.entries(options.emojis)) {
        if (k && v && typeof v === 'string') {
          this.emojiCache.set(k, v);
        }
      }
    }

    // 2. 解析表情占位符并渲染为 <img> 图标
    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let renderedHtml = escapeHtml(cleanText);

    // 解析 Chzzk / 通用表情代码: {:emoticon_id:}
    const tokenRegex = /\{:([a-zA-Z0-9_-]+):\}/g;
    renderedHtml = renderedHtml.replace(tokenRegex, (match, code) => {
      const url = (options.emojis && options.emojis[code]) || this.emojiCache.get(code);
      if (url) {
        return `<img class="danmaku-emoji" src="${url}" alt="${code}" />`;
      }
      // 通用 CDN 兜底，若加载失败自动回滚为原代码
      const fallbackUrl = `https://ssl.pstatic.net/static/nng/glive/icon/${code}.gif`;
      return `<img class="danmaku-emoji" src="${fallbackUrl}" alt="${code}" onerror="this.outerHTML='${match}';" />`;
    });

    // 解析 SOOP 传统斜杠表情: /샤방/、/품어/ 等
    const slashRegex = /\/([가-힣a-zA-Z0-9_]{1,10})\//g;
    renderedHtml = renderedHtml.replace(slashRegex, (match, word) => {
      const url = this.emojiCache.get(word) || this.emojiCache.get(match);
      if (url) {
        return `<img class="danmaku-emoji" src="${url}" alt="${word}" />`;
      }
      return match;
    });

    // 估算可视长度 (每个表情约占 2 个汉字宽度，确保弹幕平滑飞过不重叠)
    const charLen = cleanText.replace(/\{:[^:]+:\}/g, '  ').replace(/\/([^\/]+)\//g, '  ').length;

    const containerHeight = this.containerEl.clientHeight || 360;
    const trackHeight = this.fontSize + 10;
    const maxTracks = Math.max(1, Math.floor((containerHeight * this.screenArea) / trackHeight));

    // 初始化轨道
    while (this.tracks.length < maxTracks) {
      this.tracks.push(0);
    }
    // 裁剪超额轨道
    if (this.tracks.length > maxTracks) {
      this.tracks.length = maxTracks;
    }

    // 挑选最快空闲的轨道
    let bestTrack = 0;
    let minTime = Infinity;
    for (let i = 0; i < maxTracks; i++) {
      if (this.tracks[i] < now) {
        bestTrack = i;
        minTime = 0;
        break;
      }
      if (this.tracks[i] < minTime) {
        minTime = this.tracks[i];
        bestTrack = i;
      }
    }

    // 更新该轨道预计被占用的时间 (根据文字与表情长度估算安全间隔)
    const gapMs = Math.max(900, Math.min(3000, charLen * 180));
    this.tracks[bestTrack] = Math.max(now, this.tracks[bestTrack]) + gapMs;

    const topPos = bestTrack * trackHeight + 10;

    // 从对象池获取或创建弹幕 DOM 节点 (适配 Document PiP 悬浮窗上下文)
    const danmakuEl = this.getDanmakuElement();
    danmakuEl.className = 'danmaku-item';
    if (options.isSpeaker) {
      danmakuEl.classList.add('danmaku-speaker');
    }

    danmakuEl.style.top = `${topPos}px`;
    danmakuEl.style.fontSize = `${this.fontSize}px`;
    danmakuEl.style.opacity = `${this.opacity}`;
    danmakuEl.style.animationDuration = `${this.speed}s`;
    danmakuEl.innerHTML = renderedHtml;

    this.containerEl.appendChild(danmakuEl);

    // 动画结束后归还至对象池复用，杜绝 DOM 膨胀与 GC 暂停
    danmakuEl.addEventListener('animationend', () => {
      this.recycleDanmakuElement(danmakuEl);
    }, { once: true });

    // 兜底超时清理
    setTimeout(() => {
      if (danmakuEl.parentNode) {
        this.recycleDanmakuElement(danmakuEl);
      }
    }, (this.speed + 1) * 1000);
  }

  // DOM 对象池：获取可用节点
  getDanmakuElement() {
    const ownerDoc = this.containerEl?.ownerDocument || document;
    if (this.domPool.length > 0) {
      const el = this.domPool.pop();
      el.className = 'danmaku-item';
      el.style.cssText = '';
      return el;
    }
    return ownerDoc.createElement('div');
  }

  // DOM 对象池：回收节点并重置状态
  recycleDanmakuElement(el) {
    if (!el) return;
    if (el.parentNode) {
      el.remove();
    }
    el.oncontextmenu = null;
    el.innerHTML = '';
    el.className = 'danmaku-item';
    el.style.cssText = '';
    if (this.domPool.length < 60) {
      this.domPool.push(el);
    }
  }

  destroy() {
    this.stop();
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    if (this.containerEl) {
      while (this.containerEl.firstChild) {
        this.containerEl.removeChild(this.containerEl.firstChild);
      }
      this.containerEl.remove();
      this.containerEl = null;
    }
    this.domPool = [];
  }
}
