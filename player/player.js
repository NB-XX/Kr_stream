/**
 * KRStream Hub - Standalone Workspace Player Logic
 * Features:
 * 1. Dynamic Multi-Screen Grid (1, 2, 3, 4, 6+ Windows, Add & Delete)
 * 2. Independent Per-Slot CDN Switcher (SOOP / Chzzk / CI.ME)
 * 3. Real-Time Live Subtitles & AI Translation (CI.ME & SOOP)
 * 4. MP4 Stream Recording (MediaRecorder with MP4 container & auto-download)
 * 5. SOOP Catch Archive Replay (实时回放 / 伪时光机)
 * 6. One-click Live Catch-up (一键追帧) & Real-world Stream Clock Auto-Sync
 * 7. Local Caching & Account Auto-Pull
 */

import { StreamResolver, PLATFORM_CDNS } from '../core/stream-resolver.js';
import { SubtitleEngine } from './subtitle-engine.js';
import { DanmakuEngine } from './danmaku-engine.js';

let nextSlotId = 1;

class StreamSlot {
  constructor(slotId, manager, initialData = null) {
    this.slotId = slotId;
    this.manager = manager;
    this.currentStreamData = initialData ? { ...initialData } : null;
    this.selectedCdn = initialData?.selectedCdn || 'default';

    this.hls = null;
    this.audioCtx = null;
    this.gainNode = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordingTimer = null;
    this.recordingSeconds = 0;

    // 时钟与追帧状态
    this.syncTimer = null;
    this.streamStartTime = 0;
    this.isCatchReplayMode = false;
    this.replayManifestUrl = null;
    this.replayTotalDuration = 0;

    this.renderDom();
    this.subtitleEngine = new SubtitleEngine(this);
    this.danmakuEngine = new DanmakuEngine(this);
    this.bindEvents();

    if (initialData) {
      this.loadStream(initialData);
    }
  }

  renderDom() {
    const slotEl = document.createElement('div');
    slotEl.className = 'stream-slot';
    slotEl.id = `slot-${this.slotId}`;

    slotEl.innerHTML = `
      <!-- 窗口顶部状态栏 -->
      <div class="slot-header">
        <div class="slot-header-left">
          <div class="slot-drag-handle" id="drag-handle-${this.slotId}" title="按住拖拽以调整多屏窗口布局顺序" draggable="true">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <circle cx="5" cy="3.5" r="1.2"/>
              <circle cx="11" cy="3.5" r="1.2"/>
              <circle cx="5" cy="8" r="1.2"/>
              <circle cx="11" cy="8" r="1.2"/>
              <circle cx="5" cy="12.5" r="1.2"/>
              <circle cx="11" cy="12.5" r="1.2"/>
            </svg>
          </div>
          <span class="slot-index-pill">#${this.slotId}</span>
          <span class="slot-streamer-label" id="label-streamer-${this.slotId}">等待载入</span>
          <div class="slot-sync-clock" id="clock-${this.slotId}">
            <span id="txt-duration-${this.slotId}">--:--:--</span>
            <span class="latency-tag good" id="tag-latency-${this.slotId}">延迟 --s</span>
          </div>
        </div>

        <div class="slot-header-right">
          <!-- 关闭此窗口 -->
          <button class="btn-close-slot" id="btn-close-${this.slotId}" title="关闭该窗口">&times;</button>
        </div>
      </div>

      <!-- 实时回看进度条 (时光机模式下显示) -->
      <div class="catch-replay-bar" id="replay-bar-${this.slotId}">
        <span class="replay-badge">时光机回看</span>
        <input type="range" class="replay-slider" id="replay-slider-${this.slotId}" min="0" max="100" value="100" />
        <span class="replay-time-text" id="replay-time-${this.slotId}">-00:00</span>
        <button class="btn-return-live" id="btn-return-live-${this.slotId}"><span class="live-dot-inline"></span>返回实时</button>
      </div>

      <!-- 视频播放容器 -->
      <div class="video-container">
        <video id="video-${this.slotId}" playsinline autoplay></video>
        <div class="loading-mask active" id="loading-${this.slotId}">
          <div class="spinner"></div>
          <div class="loading-msg" id="loading-msg-${this.slotId}">点击左侧主播卡片开始播放</div>
        </div>
      </div>

      <!-- 底部控制条 (追帧、时光机、历史字幕均置于此工具栏) -->
      <div class="slot-controls">
        <div class="controls-left">
          <button class="ctrl-icon-btn" id="btn-playpause-${this.slotId}" title="播放/暂停">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <button class="ctrl-icon-btn" id="btn-reload-${this.slotId}" title="刷新重连">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>

          <!-- 一键追帧 (微加速对齐至实时最新边缘) -->
          <button class="ctrl-icon-btn btn-ctrl-catchup" id="btn-ctrl-catchup-${this.slotId}" title="一键追帧至实时边缘 (微加速对齐)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span class="ctrl-btn-tag" id="ctrl-catchup-tag-${this.slotId}">追帧</span>
          </button>

          <!-- 实时回看 (时光机) -->
          <button class="ctrl-icon-btn btn-ctrl-replay" id="btn-ctrl-replay-${this.slotId}" title="开启实时回看 (时光机)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 8 14"/></svg>
            <span class="ctrl-replay-tag" id="ctrl-replay-tag-${this.slotId}">时光机</span>
          </button>

          <!-- 音量 & 300% 增益 -->
          <div class="volume-box">
            <button class="ctrl-icon-btn" id="btn-mute-${this.slotId}" title="静音">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            </button>
            <input type="range" class="vol-slider" id="vol-slider-${this.slotId}" min="0" max="300" value="100" />
            <span class="vol-text" id="vol-text-${this.slotId}">100%</span>
          </div>
        </div>

        <div class="controls-right">
          <!-- 画质选择 -->
          <select class="quality-dropdown" id="quality-${this.slotId}" title="清晰度切换">
            <option value="-1">原画</option>
          </select>
          <!-- 独立加速 CDN 选择 -->
          <select class="cdn-dropdown" id="cdn-${this.slotId}" title="为此窗口切换专属加速 CDN">
            <option value="default">CDN: 自动</option>
          </select>
          <!-- 实时字幕开关 -->
          <button class="ctrl-icon-btn btn-subs" id="btn-subs-${this.slotId}" title="开启实时字幕 (右键设置)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span class="btn-subs-tag" id="btn-subs-tag-${this.slotId}">字幕</span>
          </button>
          <!-- 历史字幕入口 (点击展开本窗口的历史转录字幕、回溯播放与长图分享) -->
          <button class="ctrl-icon-btn btn-ctrl-sub-history" id="btn-sub-history-${this.slotId}" title="查看此窗口的历史转录字幕、回放与长图分享">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l6 6v10a2 2 0 01-2 2z"/><path d="M14 2v4a2 2 0 002 2h4M10 12h4M10 16h4"/></svg>
            <span class="btn-sub-history-tag">历史字幕</span>
            <span class="ctrl-sub-badge" id="ctrl-sub-badge-${this.slotId}" style="display:none;">0</span>
          </button>
          <!-- 录制 MP4 -->
          <button class="ctrl-icon-btn" id="btn-record-${this.slotId}" title="录制直播并保存为 MP4">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
            <span id="record-txt-${this.slotId}" style="margin-left:3px;font-size:10px;">MP4</span>
          </button>
          <!-- 截图 -->
          <button class="ctrl-icon-btn" id="btn-snap-${this.slotId}" title="高清截图">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <!-- 悬浮小窗 (画中画) -->
          <button class="ctrl-icon-btn" id="btn-pip-${this.slotId}" title="悬浮小窗播放 (含弹幕与字幕 | 左键: 桌面置顶画中画, 右键: 独立弹出窗口)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M12 9h8v8h-8z"/></svg>
          </button>
          <!-- 全屏 -->
          <button class="ctrl-icon-btn" id="btn-fullscreen-${this.slotId}" title="全屏">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          </button>
        </div>
      </div>
    `;

    document.getElementById('viewport-grid').appendChild(slotEl);
    this.dom = slotEl;
    this.video = slotEl.querySelector(`#video-${this.slotId}`);
    this.loading = slotEl.querySelector(`#loading-${this.slotId}`);
    this.loadingMsg = slotEl.querySelector(`#loading-msg-${this.slotId}`);
    this.selectQuality = slotEl.querySelector(`#quality-${this.slotId}`);
    this.selectCdn = slotEl.querySelector(`#cdn-${this.slotId}`);
    this.btnSubs = slotEl.querySelector(`#btn-subs-${this.slotId}`);
    this.labelStreamer = slotEl.querySelector(`#label-streamer-${this.slotId}`);
    this.txtDuration = slotEl.querySelector(`#txt-duration-${this.slotId}`);
    this.tagLatency = slotEl.querySelector(`#tag-latency-${this.slotId}`);
    this.replayBar = slotEl.querySelector(`#replay-bar-${this.slotId}`);
    this.replaySlider = slotEl.querySelector(`#replay-slider-${this.slotId}`);
    this.replayTime = slotEl.querySelector(`#replay-time-${this.slotId}`);
    this.btnCtrlCatchup = slotEl.querySelector(`#btn-ctrl-catchup-${this.slotId}`);
    this.ctrlCatchupTag = slotEl.querySelector(`#ctrl-catchup-tag-${this.slotId}`);
    this.btnCtrlReplay = slotEl.querySelector(`#btn-ctrl-replay-${this.slotId}`);
    this.ctrlReplayTag = slotEl.querySelector(`#ctrl-replay-tag-${this.slotId}`);
    this.btnSubHistory = slotEl.querySelector(`#btn-sub-history-${this.slotId}`);
    this.ctrlSubBadge = slotEl.querySelector(`#ctrl-sub-badge-${this.slotId}`);
    this.btnRecord = slotEl.querySelector(`#btn-record-${this.slotId}`);
    this.recordTxt = slotEl.querySelector(`#record-txt-${this.slotId}`);
    this.videoContainer = slotEl.querySelector('.video-container');
    this.btnPip = slotEl.querySelector(`#btn-pip-${this.slotId}`);
  }

  bindEvents() {
    // 关闭窗口
    this.dom.querySelector(`#btn-close-${this.slotId}`).addEventListener('click', () => {
      this.manager.removeSlot(this.slotId);
    });

    // 播放 / 暂停
    const btnPlayPause = this.dom.querySelector(`#btn-playpause-${this.slotId}`);
    btnPlayPause.addEventListener('click', () => {
      if (this.video.paused) {
        this.video.play();
        btnPlayPause.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      } else {
        this.video.pause();
        btnPlayPause.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      }
    });

    // 刷新
    this.dom.querySelector(`#btn-reload-${this.slotId}`).addEventListener('click', () => {
      if (this.currentStreamData) {
        this.loadStream(this.currentStreamData);
      }
    });

    // 音量与静音
    const volSlider = this.dom.querySelector(`#vol-slider-${this.slotId}`);
    const volText = this.dom.querySelector(`#vol-text-${this.slotId}`);
    const btnMute = this.dom.querySelector(`#btn-mute-${this.slotId}`);

    volSlider.addEventListener('input', (e) => {
      this.setVolume(e.target.value);
    });

    btnMute.addEventListener('click', () => {
      if (this.video.muted) {
        this.setVolume(100);
      } else {
        this.setVolume(0);
      }
    });

    // 一键追帧 (底部工具栏)
    if (this.btnCtrlCatchup) {
      this.btnCtrlCatchup.addEventListener('click', () => {
        this.catchUpLiveEdge();
      });
    }

    // 实时回看 (时光机) (底部工具栏)
    if (this.btnCtrlReplay) {
      this.btnCtrlReplay.addEventListener('click', () => {
        this.toggleCatchReplay();
      });
    }

    // 历史字幕抽屉入口 (底部工具栏)
    if (this.btnSubHistory) {
      this.btnSubHistory.addEventListener('click', () => {
        window.__KRSTREAM_APP__?.rightDrawer?.toggleForSlot(this.slotId);
      });
    }

    // 监听本窗口字幕新增事件，更新底部工具栏角标数字
    window.addEventListener('krstream:subtitle-added', (e) => {
      if (e.detail?.slotId === this.slotId) {
        if (this.ctrlSubBadge) {
          const count = this.subtitleEngine?.history?.length || 0;
          this.ctrlSubBadge.textContent = String(count);
          this.ctrlSubBadge.style.display = count > 0 ? 'inline-block' : 'none';
        }
      }
    });

    // 返回实时直播
    this.dom.querySelector(`#btn-return-live-${this.slotId}`).addEventListener('click', () => {
      this.returnToLive();
    });

    // 时光机滑动条交互 (防频繁 seek 导致卡顿，拖拽中仅显示时间，松开或变化时才执行精确跳转)
    let isDraggingSlider = false;
    this.replaySlider.addEventListener('mousedown', () => { isDraggingSlider = true; });
    this.replaySlider.addEventListener('touchstart', () => { isDraggingSlider = true; }, { passive: true });

    this.replaySlider.addEventListener('input', (e) => {
      const seekSec = parseFloat(e.target.value);
      const maxPos = this.replayWindowEnd || parseFloat(this.replaySlider.max) || 600;
      const diff = Math.max(0, Math.round(maxPos - seekSec));
      this.replayTime.textContent = diff <= 3 ? '实时边缘' : `-${this.formatTime(diff)}`;
    });

    this.replaySlider.addEventListener('change', (e) => {
      const seekSec = parseFloat(e.target.value);
      this.video.currentTime = seekSec;
      isDraggingSlider = false;
    });

    this.replaySlider.addEventListener('mouseup', () => { isDraggingSlider = false; });
    this.replaySlider.addEventListener('touchend', () => { isDraggingSlider = false; });

    // 回看播放时，自动跟随更新滑动条当前进度
    this.video.addEventListener('timeupdate', () => {
      if (this.isCatchReplayMode && !isDraggingSlider) {
        const cur = this.video.currentTime || 0;
        this.replaySlider.value = cur;
        const maxPos = this.replayWindowEnd || parseFloat(this.replaySlider.max) || 600;
        const diff = Math.max(0, Math.round(maxPos - cur));
        this.replayTime.textContent = diff <= 3 ? '实时边缘' : `-${this.formatTime(diff)}`;
      }
    });

    // 录制 MP4
    this.btnRecord.addEventListener('click', () => {
      this.toggleRecordingMp4();
    });

    // 截图
    this.dom.querySelector(`#btn-snap-${this.slotId}`).addEventListener('click', () => {
      this.takeScreenshot();
    });

    // 悬浮画中画 (Document PiP 支持弹幕与双语字幕，右键支持独立弹出窗口)
    if (this.btnPip) {
      this.btnPip.addEventListener('click', async () => {
        await this.toggleDocumentPip();
      });
      this.btnPip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openStandalonePopupWindow();
      });
    }

    // 全屏
    this.dom.querySelector(`#btn-fullscreen-${this.slotId}`).addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        this.dom.requestFullscreen();
      }
    });

    // 拖拽窗口调整多屏网格布局顺序
    const dragHandle = this.dom.querySelector(`#drag-handle-${this.slotId}`);
    if (dragHandle) {
      dragHandle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(this.slotId));
        e.dataTransfer.effectAllowed = 'move';
        this.dom.classList.add('dragging');
      });
      dragHandle.addEventListener('dragend', () => {
        this.dom.classList.remove('dragging');
        document.querySelectorAll('.stream-slot').forEach((s) => s.classList.remove('drag-over'));
      });
    }

    this.dom.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!this.dom.classList.contains('dragging')) {
        this.dom.classList.add('drag-over');
      }
    });

    this.dom.addEventListener('dragleave', (e) => {
      if (!this.dom.contains(e.relatedTarget)) {
        this.dom.classList.remove('drag-over');
      }
    });

    this.dom.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dom.classList.remove('drag-over');
      const sourceSlotId = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (sourceSlotId && sourceSlotId !== this.slotId) {
        this.manager.reorderSlots(sourceSlotId, this.slotId);
      }
    });

    // 画质切换
    this.selectQuality.addEventListener('change', (e) => {
      const levelIdx = parseInt(e.target.value, 10);
      if (this.hls) {
        this.hls.currentLevel = levelIdx;
      }
    });

    // 独立加速 CDN 切换
    if (this.selectCdn) {
      this.selectCdn.addEventListener('change', (e) => {
        this.changeCdn(e.target.value);
      });
    }

    // 窗口尺寸自适应体积检测 (针对六屏与窄窗口自动切换纯图标精简模式)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          this.applyResponsiveLayout(w);
        }
      });
      this.resizeObserver.observe(this.dom);
    }
    this.applyResponsiveLayout();
  }

  updateCdnDropdown() {
    if (!this.selectCdn) return;
    const platform = this.currentStreamData?.platform;
    const cdns = (platform && PLATFORM_CDNS[platform]) ? PLATFORM_CDNS[platform] : [
      { key: 'default', name: '官方默认' }
    ];

    this.selectCdn.innerHTML = '';
    cdns.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = item.name;
      this.selectCdn.appendChild(opt);
    });

    if (this.selectedCdn) {
      this.selectCdn.value = this.selectedCdn;
    }
  }

  changeCdn(newCdnKey) {
    this.selectedCdn = newCdnKey;
    const platform = this.currentStreamData?.platform;
    const rawUrl = this.currentStreamData?.originalStreamUrl || this.currentStreamData?.streamUrl;
    if (!rawUrl || !platform) return;

    const finalUrl = StreamResolver.applyCdn(rawUrl, platform, newCdnKey);
    this.currentStreamData.streamUrl = finalUrl;
    this.currentStreamData.selectedCdn = newCdnKey;

    if (this.hls) {
      this.showLoading(`正在无缝切换至: ${newCdnKey}...`);
      this.hls.loadSource(finalUrl);
      this.hls.startLoad();
      this.video.play().catch(() => {});
      setTimeout(() => this.hideLoading(), 1000);
    }
    this.manager.saveState();
  }

  initAudio() {
    if (!this.audioCtx) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
        this.gainNode = this.audioCtx.createGain();
        const source = this.audioCtx.createMediaElementSource(this.video);
        source.connect(this.gainNode);
        this.gainNode.connect(this.audioCtx.destination);
      } catch (e) {
        console.warn('[KRStream] 音频增益节点初始化异常:', e);
      }
    }
  }

  setVolume(val) {
    const volumePercent = parseInt(val, 10);
    this.dom.querySelector(`#vol-text-${this.slotId}`).textContent = `${volumePercent}%`;
    this.dom.querySelector(`#vol-slider-${this.slotId}`).value = volumePercent;

    if (volumePercent === 0) {
      this.video.muted = true;
    } else {
      this.video.muted = false;
      if (volumePercent <= 100) {
        this.video.volume = volumePercent / 100;
        if (this.gainNode) this.gainNode.gain.value = 1.0;
      } else {
        this.video.volume = 1.0;
        this.initAudio();
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
        if (this.gainNode) {
          this.gainNode.gain.value = volumePercent / 100;
        }
      }
    }
  }

  showLoading(text = '正在加载直播流...') {
    this.loadingMsg.textContent = text;
    this.loading.classList.add('active');
  }

  hideLoading() {
    this.loading.classList.remove('active');
  }

  async loadStream(streamData) {
    this.currentStreamData = { ...streamData };
    if (streamData.selectedCdn) {
      this.selectedCdn = streamData.selectedCdn;
    }
    let { streamUrl, platform, streamer, title, channelId } = streamData;

    this.showLoading(`正在连接 ${streamer || channelId} 直播源...`);
    this.labelStreamer.textContent = streamer || channelId || '未知主播';
    this.isCatchReplayMode = false;
    this.replayBar.classList.remove('active');

    // 针对 SOOP 与 CHZZK 均支持实时回放/时光机
    const isReplaySupported = (platform === 'soop' || platform === 'chzzk');
    if (this.btnCtrlReplay) {
      this.btnCtrlReplay.style.display = isReplaySupported ? 'inline-flex' : 'none';
      this.btnCtrlReplay.classList.remove('active');
      this.btnCtrlReplay.title = platform === 'soop' ? '开启实时回看 (SOOP Catch 归档回看)' : '开启实时回看 (Chzzk 10分钟时光机)';
      if (this.ctrlReplayTag) this.ctrlReplayTag.textContent = platform === 'soop' ? '回看' : '时光机';
    }

    if (!streamUrl) {
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'RESOLVE_STREAM',
          payload: {
            input: `${platform === 'cime' ? 'https://ci.me/@' : platform === 'chzzk' ? 'https://chzzk.naver.com/live/' : 'https://play.sooplive.com/'}${channelId}`,
            options: { broadNo: streamData.broadNo, cdnPreference: this.selectedCdn }
          }
        });
        if (res.success && res.data?.streamUrl) {
          streamUrl = res.data.streamUrl;
          this.currentStreamData = { ...this.currentStreamData, ...res.data };
          if (res.data.btime) {
            this.streamStartTime = Date.now() - res.data.btime * 1000;
          }
        } else {
          this.showLoading(`获取直播流失败: ${res.error || '主播可能未开播'}`);
          return;
        }
      } catch (e) {
        this.showLoading(`解析异常: ${e.message}`);
        return;
      }
    }

    // 根据选定的 CDN 适配最终播放流
    if (this.selectedCdn && this.selectedCdn !== 'default') {
      streamUrl = StreamResolver.applyCdn(this.currentStreamData.originalStreamUrl || streamUrl, platform, this.selectedCdn);
      this.currentStreamData.streamUrl = streamUrl;
    }

    this.updateCdnDropdown();

    // 恢复字幕设置与引擎 (SOOP具备字幕或CI.ME默认自动获取)
    if (streamData.subtitlePrimaryLang) {
      this.subtitleEngine.setPrimaryLang(streamData.subtitlePrimaryLang);
    }
    if (streamData.subtitleSecondaryLang) {
      this.subtitleEngine.setSecondaryLang(streamData.subtitleSecondaryLang);
    }
    if (streamData.subtitleIsBilingual !== undefined) {
      this.subtitleEngine.setBilingual(Boolean(streamData.subtitleIsBilingual));
    } else if (streamData.subtitleMode) {
      this.subtitleEngine.setMode(streamData.subtitleMode);
    }
    if (streamData.subtitleFontSize) {
      this.subtitleEngine.setFontSize(streamData.subtitleFontSize);
    }
    if (streamData.subtitleOpacity) {
      this.subtitleEngine.setOpacity(streamData.subtitleOpacity);
    }
    if (streamData.subtitleColor) {
      this.subtitleEngine.setFontColor(streamData.subtitleColor);
    }
    if (streamData.subtitleAlign) {
      this.subtitleEngine.setTextAlign(streamData.subtitleAlign);
    }
    const shouldEnableSubs = streamData.subtitlesEnabled !== undefined
      ? !!streamData.subtitlesEnabled
      : (platform === 'cime' || !!streamData.isSubtitle);

    if (shouldEnableSubs) {
      this.subtitleEngine.enabled = true;
      this.subtitleEngine.updateButtonState();
      this.subtitleEngine.start();
    } else {
      this.subtitleEngine.enabled = false;
      this.subtitleEngine.updateButtonState();
      this.subtitleEngine.stop();
    }

    // 启动实时弹幕 (Bilibili/Niconico 弹幕引擎)
    if (streamData.danmakuEnabled !== undefined && this.danmakuEngine) {
      this.danmakuEngine.enabled = Boolean(streamData.danmakuEnabled);
      this.danmakuEngine.updateButtonState();
    }
    if (this.danmakuEngine) {
      this.danmakuEngine.start(this.currentStreamData);
    }

    this.startHlsPlay(streamUrl);
    this.startClockSync();
    this.manager.saveState();
  }

  startHlsPlay(url, options = {}) {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const isReplay = options.isReplay !== undefined ? options.isReplay : this.isCatchReplayMode;

    if (Hls.isSupported()) {
      const hlsConfig = {
        enableWorker: true,
        lowLatencyMode: !isReplay,
        backBufferLength: 600, // 本地保留 10 分钟 (600秒) 历史缓存
        maxBufferLength: isReplay ? 60 : 30,
        maxMaxBufferLength: 600,
        maxBufferSize: 60 * 1000 * 1000,
        xhrSetup: function (xhr) {
          xhr.withCredentials = false;
        }
      };

      if (!isReplay) {
        hlsConfig.liveSyncDurationCount = 3;
        hlsConfig.liveMaxLatencyDurationCount = 6;
      }

      this.hls = new Hls(hlsConfig);

      this.hls.loadSource(url);
      this.hls.attachMedia(this.video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.hideLoading();
        this.populateQualities(data.levels);
        if (options.startPosition !== undefined) {
          this.video.currentTime = options.startPosition;
        }
        this.video.play().catch(() => {});
      });

      this.hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        if (isReplay && data.details) {
          const frags = data.details.fragments || [];
          if (frags.length > 0) {
            const start = frags[0].start || 0;
            const end = data.details.edge || (start + (data.details.totalduration || 600));
            this.replayWindowStart = start;
            this.replayWindowEnd = end;
            this.replaySlider.min = Math.floor(start);
            this.replaySlider.max = Math.ceil(end);
            this.replayTotalDuration = end - start;
          }
        }
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn(`[KRStream] 窗口 #${this.slotId} 网络中断，尝试自愈重连...`, data);
              this.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn(`[KRStream] 窗口 #${this.slotId} 解码错误，执行恢复...`, data);
              this.hls.recoverMediaError();
              break;
            default:
              this.showLoading('直播流连接中断或未响应');
              this.hls.destroy();
              break;
          }
        }
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = url;
      this.video.addEventListener('loadedmetadata', () => {
        this.hideLoading();
        this.video.play().catch(() => {});
      });
    }
  }

  // 时钟同步与实时延迟监控
  startClockSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);

    this.syncTimer = setInterval(() => {
      if (this.isCatchReplayMode) return;
      if (!this.video || this.video.paused) return;

      // 1. 计算已播时长
      if (this.streamStartTime > 0) {
        const elapsedSec = Math.floor((Date.now() - this.streamStartTime) / 1000);
        this.txtDuration.textContent = `开播 ${this.formatTime(elapsedSec)}`;
      } else {
        const cur = Math.floor(this.video.currentTime || 0);
        this.txtDuration.textContent = `播放 ${this.formatTime(cur)}`;
      }

      // 2. 计算当前延迟落后秒数
      const livePos = this.hls?.liveSyncPosition || this.video.duration || 0;
      const latency = Math.max(0, livePos - this.video.currentTime);
      const latencyFixed = latency.toFixed(1);

      if (latency < 2.5) {
        this.tagLatency.className = 'latency-tag good';
        this.tagLatency.textContent = `延迟 ${latencyFixed}s`;
      } else if (latency < 6.0) {
        this.tagLatency.className = 'latency-tag medium';
        this.tagLatency.textContent = `延迟 ${latencyFixed}s`;
      } else {
        this.tagLatency.className = 'latency-tag bad';
        this.tagLatency.textContent = `延迟 ${latencyFixed}s`;
      }
    }, 1000);
  }

  // 一键追帧 (微加速 + 跃进实时边缘)
  catchUpLiveEdge() {
    if (!this.video || !this.hls) return;
    const livePos = this.hls.liveSyncPosition || this.video.duration || 0;
    const target = Math.max(0, livePos - 0.4);
    this.video.currentTime = target;

    // 启动 1.15x 微加速直至对齐
    this.video.playbackRate = 1.15;
    if (this.btnCtrlCatchup) {
      this.btnCtrlCatchup.classList.add('active');
    }
    if (this.ctrlCatchupTag) {
      this.ctrlCatchupTag.textContent = '追帧中';
    }

    const checkInterval = setInterval(() => {
      const curDelay = (this.hls.liveSyncPosition || 0) - this.video.currentTime;
      if (curDelay <= 0.8 || this.video.paused) {
        this.video.playbackRate = 1.0;
        clearInterval(checkInterval);
        if (this.btnCtrlCatchup) {
          this.btnCtrlCatchup.classList.remove('active');
        }
        if (this.ctrlCatchupTag) {
          this.ctrlCatchupTag.textContent = '追帧';
        }
      }
    }, 500);
  }

  // 实时回看 (SOOP Catch 归档 / CHZZK 时光机)
  async toggleCatchReplay() {
    if (!this.currentStreamData) {
      this.showToast('请先选择并播放一个直播频道');
      return;
    }

    if (this.isCatchReplayMode) {
      this.returnToLive();
      return;
    }

    const platform = this.currentStreamData.platform;
    const channelId = this.currentStreamData.channelId;

    if (!['soop', 'chzzk'].includes(platform)) {
      this.showToast('实时回放功能当前专用于 SOOP 与 Chzzk 直播');
      return;
    }

    const broadNo = this.currentStreamData.bno || this.currentStreamData.broadNo;
    const platformLabel = platform === 'soop' ? 'SOOP Catch 归档' : 'Chzzk 10分钟时光机';
    this.showLoading(`正在请求 ${platformLabel} 实时回看流...`);

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'GET_STREAM_REPLAY',
        payload: {
          platform,
          channelId,
          extra: { bno: broadNo, cdnPreference: this.selectedCdn }
        }
      });

      if (res && res.success && res.data?.replayUrl) {
        this.isCatchReplayMode = true;
        this.replayManifestUrl = res.data.replayUrl;
        this.replayTotalDuration = parseFloat(res.data.totalDuration) || 600;

        // 切换 Hls 源到回看流，指定 isReplay: true，彻底规避因延迟落后而被强制跳回直播边缘
        this.startHlsPlay(this.replayManifestUrl, { isReplay: true });
        this.replayBar.classList.add('active');
        this.replaySlider.min = 0;
        this.replaySlider.max = this.replayTotalDuration;
        this.replaySlider.value = this.replayTotalDuration;
        this.replayTime.textContent = '实时边缘';

        if (this.btnCtrlReplay) {
          this.btnCtrlReplay.classList.add('active');
          this.btnCtrlReplay.title = '点击返回实时直播边缘';
          if (this.ctrlReplayTag) this.ctrlReplayTag.textContent = '回看中';
        }
      } else {
        alert('无法获取实时回看流: ' + (res?.error || '该直播暂无时光机或归档尚未生成'));
        this.hideLoading();
      }
    } catch (e) {
      alert('回放请求异常: ' + e.message);
      this.hideLoading();
    }
  }

  // 从时光机返回实时直播
  returnToLive() {
    this.isCatchReplayMode = false;
    this.replayBar.classList.remove('active');

    const platform = this.currentStreamData?.platform;
    if (this.btnCtrlReplay) {
      this.btnCtrlReplay.classList.remove('active');
      this.btnCtrlReplay.title = platform === 'soop' ? '开启实时回看 (SOOP Catch 归档回看)' : '开启实时回看 (Chzzk 10分钟时光机)';
      if (this.ctrlReplayTag) this.ctrlReplayTag.textContent = platform === 'soop' ? '回看' : '时光机';
    }

    if (this.currentStreamData?.streamUrl) {
      this.startHlsPlay(this.currentStreamData.streamUrl, { isReplay: false });
      this.catchUpLiveEdge();
    }
  }

  // 录制 HLS 流并自动封装为 MP4 保存
  toggleRecordingMp4() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.stopRecordingMp4();
    } else {
      this.startRecordingMp4();
    }
  }

  startRecordingMp4() {
    try {
      const stream = this.video.captureStream ? this.video.captureStream() : this.video.mozCaptureStream();
      this.recordedChunks = [];

      // 优先采用原生 video/mp4 容器
      let mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/mp4';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp9,opus';
      }

      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        this.finishDownloadMp4(mimeType);
      };

      this.mediaRecorder.start(1000);
      this.btnRecord.classList.add('recording');
      this.recordingSeconds = 0;
      this.recordingTimer = setInterval(() => {
        this.recordingSeconds++;
        this.recordTxt.textContent = this.formatDuration(this.recordingSeconds);
      }, 1000);
    } catch (e) {
      alert('录制启动失败: ' + e.message);
    }
  }

  stopRecordingMp4() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    clearInterval(this.recordingTimer);
    this.btnRecord.classList.remove('recording');
    this.recordTxt.textContent = 'MP4';
  }

  finishDownloadMp4(mimeType) {
    const isNativeMp4 = mimeType.includes('mp4');
    const finalMime = isNativeMp4 ? 'video/mp4' : 'video/mp4'; // 自动封装为 mp4 扩展名
    const blob = new Blob(this.recordedChunks, { type: finalMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = this.currentStreamData?.streamer || `slot_${this.slotId}`;
    a.download = `${name}_${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  takeScreenshot() {
    if (!this.video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    const name = this.currentStreamData?.streamer || `slot_${this.slotId}`;
    a.download = `${name}_${Date.now()}.png`;
    a.click();
  }

  populateQualities(levels) {
    this.selectQuality.innerHTML = '<option value="-1">原画 (最高/Auto)</option>';
    if (!levels || levels.length <= 1) return;

    levels.forEach((lvl, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      const height = lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`;
      opt.textContent = `${height} (${Math.round(lvl.bitrate / 1000)} kbps)`;
      this.selectQuality.appendChild(opt);
    });
  }

  formatTime(totalSec) {
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return h === '00' ? `${m}:${s}` : `${h}:${m}:${s}`;
  }

  formatDuration(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  /**
   * 开启/关闭桌面置顶悬浮画中画 (Document Picture-in-Picture)
   * 区别于传统底层 Video PiP，支持完整 DOM 渲染，实时同步显示弹幕、AI 双语字幕与迷你控制条
   */
  async toggleDocumentPip() {
    // 1. 如果已有悬浮小窗处于开启状态，再次触发则关闭并收回
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
      return;
    }

    // 2. 检查浏览器环境是否支持 Document Picture-in-Picture API
    if (!('documentPictureInPicture' in window)) {
      console.warn('[KRStream PiP] 当前浏览器不支持 Document PiP，自动切换为独立弹出窗口模式');
      this.openStandalonePopupWindow();
      return;
    }

    try {
      // 3. 请求系统级置顶悬浮小窗 (Always-on-Top)
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 854,
        height: 480,
      });
      this.pipWindow = pipWindow;

      // 4. 将主窗口的所有外部样式和行内样式拷贝至悬浮窗口，确保弹幕动画与字幕样式无损
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          if (styleSheet.href) {
            const link = pipWindow.document.createElement('link');
            link.rel = 'stylesheet';
            link.type = styleSheet.type || 'text/css';
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          } else if (styleSheet.cssRules) {
            const style = pipWindow.document.createElement('style');
            for (const rule of styleSheet.cssRules) {
              style.appendChild(pipWindow.document.createTextNode(rule.cssText));
            }
            pipWindow.document.head.appendChild(style);
          }
        } catch (e) {
          if (styleSheet.href) {
            const link = pipWindow.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          }
        }
      });

      // 注入悬浮小窗专用控制层样式
      const customStyle = pipWindow.document.createElement('style');
      customStyle.textContent = `
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: #000;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          user-select: none;
        }
        .pip-window-shell {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: #000;
          overflow: hidden;
        }
        .pip-window-shell .video-container {
          position: relative;
          width: 100% !important;
          height: 100% !important;
          flex: 1 1 auto;
          background: #000;
          overflow: hidden;
        }
        .pip-window-shell .video-container video {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain;
        }
        .pip-window-shell .slot-subtitle-overlay {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 44px;
          pointer-events: none;
          z-index: 20;
          display: flex;
          justify-content: center;
        }
        .pip-window-shell .slot-danmaku-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 12;
        }
        .pip-mini-controls {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 42px;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.5) 75%, transparent 100%);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          box-sizing: border-box;
          opacity: 0;
          transition: opacity 0.25s ease;
          z-index: 50;
          pointer-events: auto;
        }
        .pip-window-shell:hover .pip-mini-controls {
          opacity: 1;
        }
        .pip-ctrl-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pip-info-tag {
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          max-width: 180px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        }
        .pip-btn {
          background: rgba(255, 255, 255, 0.16);
          border: 1px solid rgba(255, 255, 255, 0.22);
          color: #f1f5f9;
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          line-height: 1;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .pip-btn:hover {
          background: rgba(255, 255, 255, 0.3);
          border-color: rgba(255, 255, 255, 0.45);
          color: #fff;
        }
        .pip-btn.active {
          background: rgba(0, 255, 163, 0.22);
          border-color: #00ffa3;
          color: #00ffa3;
          font-weight: bold;
        }
        .pip-btn-retrieve {
          background: #2563eb;
          border-color: #3b82f6;
          color: #fff;
          font-weight: 500;
        }
        .pip-btn-retrieve:hover {
          background: #1d4ed8;
        }
      `;
      pipWindow.document.head.appendChild(customStyle);

      // 5. 在原主窗口槽位中放置优雅占位符
      const placeholder = document.createElement('div');
      placeholder.className = 'pip-slot-placeholder';
      placeholder.id = `pip-placeholder-${this.slotId}`;
      placeholder.innerHTML = `
        <div class="pip-slot-placeholder-inner">
          <div class="pip-ph-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg></div>
          <div class="pip-ph-title">已开启桌面置顶悬浮小窗</div>
          <div class="pip-ph-subtitle">直播画面、实时弹幕与 AI 双语字幕正在悬浮小窗中同步显示</div>
          <button class="btn-pip-restore-main" type="button">收回至主工作台</button>
        </div>
      `;

      placeholder.querySelector('.btn-pip-restore-main').addEventListener('click', () => {
        if (this.pipWindow && !this.pipWindow.closed) {
          this.pipWindow.close();
        }
      });

      if (this.videoContainer && this.videoContainer.parentNode) {
        this.videoContainer.parentNode.insertBefore(placeholder, this.videoContainer);
      }

      // 6. 构造 PiP 外壳并移入视频容器及迷你控制条
      const shell = pipWindow.document.createElement('div');
      shell.className = 'pip-window-shell';
      shell.appendChild(this.videoContainer);

      const miniBar = pipWindow.document.createElement('div');
      miniBar.className = 'pip-mini-controls';

      const streamerName = this.currentStreamData?.streamer || `窗口 #${this.slotId}`;
      const platformName = (this.currentStreamData?.platform || 'Live').toUpperCase();

      miniBar.innerHTML = `
        <div class="pip-ctrl-group">
          <span class="pip-info-tag" title="${streamerName}">[${platformName}] ${streamerName}</span>
          <button class="pip-btn" id="pip-btn-play" title="播放/暂停"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></button>
          <button class="pip-btn" id="pip-btn-mute" title="静音切换"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
        </div>
        <div class="pip-ctrl-group">
          <button class="pip-btn ${this.danmakuEngine?.enabled ? 'active' : ''}" id="pip-btn-danmaku" title="切换弹幕">弹幕</button>
          <button class="pip-btn ${this.subtitleEngine?.enabled ? 'active' : ''}" id="pip-btn-subs" title="切换字幕">字幕</button>
          <button class="pip-btn" id="pip-btn-catchup" title="一键追帧">追帧</button>
          <button class="pip-btn pip-btn-retrieve" id="pip-btn-retrieve" title="收回至主工作台窗口">收回</button>
        </div>
      `;

      shell.appendChild(miniBar);
      pipWindow.document.body.appendChild(shell);

      // 绑定 miniBar 按钮事件
      const btnPlay = miniBar.querySelector('#pip-btn-play');
      const btnMute = miniBar.querySelector('#pip-btn-mute');
      const btnDanmaku = miniBar.querySelector('#pip-btn-danmaku');
      const btnSubs = miniBar.querySelector('#pip-btn-subs');
      const btnCatchup = miniBar.querySelector('#pip-btn-catchup');
      const btnRetrieve = miniBar.querySelector('#pip-btn-retrieve');

      const updatePlayState = () => {
        if (this.video.paused) {
          btnPlay.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        } else {
          btnPlay.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        }
      };
      updatePlayState();
      this.video.addEventListener('play', updatePlayState);
      this.video.addEventListener('pause', updatePlayState);

      btnPlay.addEventListener('click', () => {
        if (this.video.paused) {
          this.video.play();
        } else {
          this.video.pause();
        }
      });

      const updateMuteState = () => {
        const isMuted = this.video.muted || this.video.volume === 0;
        btnMute.innerHTML = isMuted
          ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="1" y1="1" x2="23" y2="23"/><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'
          : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
      };
      updateMuteState();
      this.video.addEventListener('volumechange', updateMuteState);

      btnMute.addEventListener('click', () => {
        this.video.muted = !this.video.muted;
      });

      btnDanmaku.addEventListener('click', () => {
        if (this.danmakuEngine) {
          this.danmakuEngine.toggle();
          if (this.danmakuEngine.enabled) {
            btnDanmaku.classList.add('active');
          } else {
            btnDanmaku.classList.remove('active');
          }
        }
      });

      btnSubs.addEventListener('click', () => {
        if (this.subtitleEngine) {
          this.subtitleEngine.toggle();
          if (this.subtitleEngine.enabled) {
            btnSubs.classList.add('active');
          } else {
            btnSubs.classList.remove('active');
          }
        }
      });

      btnCatchup.addEventListener('click', () => {
        this.catchUpLiveEdge();
      });

      btnRetrieve.addEventListener('click', () => {
        pipWindow.close();
      });

      // 7. 更新底部 PiP 按钮状态为激活
      this.btnPip?.classList.add('active');
      if (this.btnPip) this.btnPip.title = '收回桌面悬浮小窗至主窗口';

      // 8. 监听 PiP 窗口关闭事件
      const onPipClose = () => {
        pipWindow.removeEventListener('pagehide', onPipClose);
        this.video.removeEventListener('play', updatePlayState);
        this.video.removeEventListener('pause', updatePlayState);
        this.video.removeEventListener('volumechange', updateMuteState);

        // 将 this.videoContainer 无损还原回主窗口原位置
        if (placeholder.parentNode) {
          placeholder.parentNode.insertBefore(this.videoContainer, placeholder);
          placeholder.remove();
        } else {
          this.dom.querySelector('.slot-controls')?.before(this.videoContainer);
        }

        this.pipWindow = null;
        this.btnPip?.classList.remove('active');
        if (this.btnPip) this.btnPip.title = '悬浮小窗播放 (含弹幕与字幕 | 左键: 桌面置顶画中画, 右键: 独立弹出窗口)';
      };

      pipWindow.addEventListener('pagehide', onPipClose);

    } catch (err) {
      console.error('[KRStream PiP] 打开 Document PiP 失败，降级为独立弹出窗口:', err);
      this.openStandalonePopupWindow();
    }
  }

  /**
   * 打开独立弹出窗口模式 (Popup Player Window)
   * 支持多显示器独立摆放，全屏无边框，同时渲染视频、弹幕与实时字幕
   */
  openStandalonePopupWindow() {
    if (!this.currentStreamData || !this.currentStreamData.streamUrl) {
      alert('请先选择或加载一个直播流');
      return;
    }

    const d = this.currentStreamData;
    const params = new URLSearchParams();
    params.set('standalone', 'true');
    params.set('platform', d.platform || 'soop');
    params.set('streamer', d.streamer || 'Live');
    params.set('title', d.title || '');
    params.set('channelId', d.channelId || '');
    params.set('streamUrl', d.streamUrl || '');
    params.set('danmaku', this.danmakuEngine?.enabled ? '1' : '0');
    params.set('subs', this.subtitleEngine?.enabled ? '1' : '0');
    params.set('subP', this.subtitleEngine?.primaryLang || 'zh-CN');
    params.set('subS', this.subtitleEngine?.secondaryLang || 'ko');
    params.set('subBi', this.subtitleEngine?.isBilingual ? '1' : '0');
    params.set('subSize', this.subtitleEngine?.fontSize || 'medium');
    params.set('subMode', this.subtitleEngine?.mode || 'bilingual');
    params.set('cdn', this.selectedCdn || 'default');

    const popupUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ?
      chrome.runtime.getURL(`player/player.html?${params.toString()}`) :
      `player.html?${params.toString()}`;

    const width = 960;
    const height = 540;
    const left = Math.max(0, Math.round((screen.width - width) / 2));
    const top = Math.max(0, Math.round((screen.height - height) / 2));

    const popupWin = window.open(
      popupUrl,
      `krstream_popup_${this.slotId}_${Date.now()}`,
      `popup=1,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (popupWin) {
      popupWin.focus();
    }
  }

  /**
   * 窗口尺寸体积检测与自适应布局
   * 当处于六屏或小尺寸槽位 (width < 600px / 780px) 时，自适应隐藏文字标签，仅展示图标，并收拢音量条与下拉框
   */
  applyResponsiveLayout(width) {
    if (!this.dom) return;
    const w = width !== undefined ? width : (this.dom.clientWidth || 0);
    if (w <= 0) return;

    if (w < 430) {
      this.dom.classList.add('slot-nano', 'slot-mini', 'slot-compact');
    } else if (w < 600) {
      this.dom.classList.add('slot-mini', 'slot-compact');
      this.dom.classList.remove('slot-nano');
    } else if (w < 780) {
      this.dom.classList.add('slot-compact');
      this.dom.classList.remove('slot-mini', 'slot-nano');
    } else {
      this.dom.classList.remove('slot-compact', 'slot-mini', 'slot-nano');
    }
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.pipWindow && !this.pipWindow.closed) {
      try {
        this.pipWindow.close();
      } catch (e) {}
      this.pipWindow = null;
    }
    if (this.danmakuEngine) {
      this.danmakuEngine.destroy();
      this.danmakuEngine = null;
    }
    if (this.subtitleEngine) {
      this.subtitleEngine.destroy();
      this.subtitleEngine = null;
    }
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.recordingTimer) clearInterval(this.recordingTimer);
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.dom) {
      this.dom.remove();
    }
  }
}

// 动态多屏网格调度管理器
class SlotManager {
  constructor() {
    this.slots = new Map();
    this.slotOrder = []; // 窗口自定义排列顺序 [slotId1, slotId2, ...]
    this.currentLayout = '1';
    this.gridContainer = document.getElementById('viewport-grid');
  }

  createSlot(initialData = null) {
    const id = nextSlotId++;
    const defaultCdn = 'default';
    const data = initialData ? { ...initialData } : null;
    if (data && !data.selectedCdn) {
      data.selectedCdn = defaultCdn;
    }
    const slot = new StreamSlot(id, this, data);
    if (slot && (!slot.selectedCdn || slot.selectedCdn === 'default')) {
      slot.selectedCdn = defaultCdn;
    }
    this.slots.set(id, slot);
    this.slotOrder.push(id);
    this.updateSlotOrderStyles();
    this.adjustLayout();
    this.saveState();
    return slot;
  }

  removeSlot(slotId) {
    const slot = this.slots.get(slotId);
    if (slot) {
      slot.destroy();
      this.slots.delete(slotId);
      this.slotOrder = this.slotOrder.filter((id) => id !== slotId);
      this.updateSlotOrderStyles();
      this.adjustLayout();
      this.saveState();
    }
  }

  reorderSlots(sourceId, targetId) {
    const srcIdx = this.slotOrder.indexOf(sourceId);
    const tgtIdx = this.slotOrder.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return;
    this.slotOrder.splice(srcIdx, 1);
    this.slotOrder.splice(tgtIdx, 0, sourceId);
    this.updateSlotOrderStyles();
    this.saveState();
  }

  updateSlotOrderStyles() {
    this.slotOrder.forEach((id, index) => {
      const slot = this.slots.get(id);
      if (slot && slot.dom) {
        slot.dom.style.order = index;
      }
    });
  }

  setLayout(preset) {
    this.currentLayout = preset;
    document.querySelectorAll('.preset-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.layout === String(preset));
    });
    this.gridContainer.className = `viewport-grid layout-${preset}`;
    // 立即刷新所有槽位的体积自适应模式
    setTimeout(() => {
      for (const slot of this.slots.values()) {
        slot.applyResponsiveLayout();
      }
    }, 50);
    this.saveState();
  }

  adjustLayout() {
    const count = this.slots.size;
    if (this.currentLayout !== 'auto') {
      if (count === 1) this.setLayout('1');
      else if (count === 2) this.setLayout('2');
      else if (count === 3) this.setLayout('3');
      else if (count === 4) this.setLayout('4');
      else if (count > 4) this.setLayout('6');
    }
  }

  findAvailableSlot() {
    for (const [id, slot] of this.slots.entries()) {
      if (!slot.currentStreamData) return slot;
    }
    return null;
  }

  clearAll() {
    for (const [id, slot] of this.slots.entries()) {
      slot.destroy();
    }
    this.slots.clear();
    this.slotOrder = [];
    this.createSlot(); // 保留 1 个默认窗口
    this.saveState();
  }

  saveState() {
    if (document.body.classList.contains('mode-standalone')) return;
    window.__KRSTREAM_APP__?.rightDrawer?.updateSlotSelector();
    const state = [];
    for (const id of this.slotOrder) {
      const slot = this.slots.get(id);
      if (slot && slot.currentStreamData) {
        state.push({
          ...slot.currentStreamData,
          selectedCdn: slot.selectedCdn || 'default',
          danmakuEnabled: slot.danmakuEngine?.enabled !== false,
          subtitlesEnabled: slot.subtitleEngine?.enabled || false,
          subtitlePrimaryLang: slot.subtitleEngine?.primaryLang || 'zh-CN',
          subtitleSecondaryLang: slot.subtitleEngine?.secondaryLang || 'ko',
          subtitleIsBilingual: slot.subtitleEngine?.isBilingual !== false,
          subtitleMode: slot.subtitleEngine?.mode || 'bilingual',
          subtitleFontSize: slot.subtitleEngine?.fontSize || 'medium',
          subtitleOpacity: slot.subtitleEngine?.opacity || '100',
          subtitleColor: slot.subtitleEngine?.fontColor || '#ffffff',
          subtitleAlign: slot.subtitleEngine?.textAlign || 'center'
        });
      }
    }
    localStorage.setItem('krstream_active_slots', JSON.stringify(state));
    localStorage.setItem('krstream_active_layout', this.currentLayout);
  }

  restoreState() {
    const isStandalone = new URLSearchParams(location.search).get('standalone') === 'true' || 
                         new URLSearchParams(location.search).get('popup') === '1';
    if (isStandalone) {
      this.setLayout('1');
      return;
    }
    try {
      const savedLayout = localStorage.getItem('krstream_active_layout');
      if (savedLayout) this.setLayout(savedLayout);

      const savedSlots = JSON.parse(localStorage.getItem('krstream_active_slots') || '[]');
      if (savedSlots.length > 0) {
        for (const data of savedSlots) {
          this.createSlot(data);
        }
      } else {
        this.createSlot();
      }
    } catch (e) {
      this.createSlot();
    }
  }
}

// ===================================================================
// 右侧字幕历史抽屉、10分钟本地缓存回溯与电影台词式长图生成器
// ===================================================================
class RightDrawerManager {
  constructor(app) {
    this.app = app;
    this.drawerEl = document.getElementById('right-drawer');
    this.toggleBtn = document.getElementById('btn-toggle-right-drawer');
    this.closeBtn = document.getElementById('btn-close-right-drawer');
    this.slotSelect = document.getElementById('drawer-slot-select');
    this.searchInput = document.getElementById('sub-search-input');
    this.selectAllBtn = document.getElementById('btn-sub-select-all');
    this.clearSelectBtn = document.getElementById('btn-sub-clear-select');
    this.selectedCountLabel = document.getElementById('selected-sub-count');
    this.genLongImageBtn = document.getElementById('btn-gen-long-image');
    this.subList = document.getElementById('drawer-sub-list');
    this.countBadge = document.getElementById('sub-history-count-badge');

    // 模态弹窗相关
    this.modal = document.getElementById('modal-long-image');
    this.modalCloseBtn = document.getElementById('btn-close-modal');
    this.canvas = document.getElementById('long-image-canvas');
    this.previewImg = document.getElementById('long-image-preview-img');
    this.copyBtn = document.getElementById('btn-copy-long-image');
    this.downloadBtn = document.getElementById('btn-download-long-image');

    this.selectedIds = new Set();
    this.currentSlotId = null;
    this.searchKeyword = '';

    this.init();
  }

  init() {
    this.bindEvents();
    this.updateSlotSelector();
  }

  bindEvents() {
    this.closeBtn?.addEventListener('click', () => {
      this.close();
    });

    this.slotSelect?.addEventListener('change', (e) => {
      this.currentSlotId = e.target.value;
      this.selectedIds.clear();
      this.renderHistoryList();
      this.updateSlotButtonStates();
    });

    this.searchInput?.addEventListener('input', (e) => {
      this.searchKeyword = e.target.value.trim().toLowerCase();
      this.renderHistoryList();
    });

    this.selectAllBtn?.addEventListener('click', () => {
      const history = this.getCurrentSlotHistory();
      history.forEach((item) => this.selectedIds.add(item.id));
      this.updateSelectionUI();
    });

    this.clearSelectBtn?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.updateSelectionUI();
    });

    this.genLongImageBtn?.addEventListener('click', () => {
      this.generateLongImage();
    });

    this.modalCloseBtn?.addEventListener('click', () => {
      this.modal.style.display = 'none';
    });

    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) this.modal.style.display = 'none';
    });

    document.querySelectorAll('input[name="long-img-style"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (this.modal.style.display !== 'none') {
          this.generateLongImage(radio.value);
        }
      });
    });

    this.copyBtn?.addEventListener('click', () => this.copyLongImage());
    this.downloadBtn?.addEventListener('click', () => this.downloadLongImage());

    // 监听全局字幕事件
    window.addEventListener('krstream:subtitle-added', (e) => {
      this.updateBadgeCount();
      if (this.drawerEl.classList.contains('open') && e.detail?.slotId === this.getActiveSlotId()) {
        this.renderHistoryList();
      }
    });

    window.addEventListener('krstream:subtitle-updated', (e) => {
      if (this.drawerEl.classList.contains('open') && e.detail?.slotId === this.getActiveSlotId()) {
        this.renderHistoryList();
      }
    });
  }

  toggleForSlot(slotId) {
    if (this.drawerEl.classList.contains('open') && this.currentSlotId === slotId) {
      this.close();
      return;
    }
    this.openForSlot(slotId);
  }

  openForSlot(slotId) {
    this.currentSlotId = slotId;
    this.updateSlotSelector();
    if (this.slotSelect) {
      this.slotSelect.value = slotId;
    }
    this.drawerEl.classList.add('open');
    this.renderHistoryList();
    this.updateSlotButtonStates();
  }

  close() {
    this.drawerEl.classList.remove('open');
    this.updateSlotButtonStates();
  }

  updateSlotButtonStates() {
    const isOpen = this.drawerEl.classList.contains('open');
    for (const slot of this.app.slotManager.slots.values()) {
      const btn = slot.dom?.querySelector(`#btn-sub-history-${slot.slotId}`);
      if (btn) {
        btn.classList.toggle('active', isOpen && this.currentSlotId === slot.slotId);
      }
    }
  }

  getActiveSlotId() {
    if (this.currentSlotId && this.app.slotManager.slots.has(this.currentSlotId)) {
      return this.currentSlotId;
    }
    // 默认选用第一个活动中的窗口
    for (const [id, slot] of this.app.slotManager.slots) {
      if (slot.currentStreamData) return id;
    }
    return this.app.slotManager.slots.keys().next().value || 'slot-1';
  }

  getCurrentSlotHistory() {
    const slotId = this.getActiveSlotId();
    const slot = this.app.slotManager.slots.get(slotId);
    return slot?.subtitleEngine?.history || [];
  }

  updateSlotSelector() {
    if (!this.slotSelect) return;
    const slots = Array.from(this.app.slotManager.slots.values());
    this.slotSelect.innerHTML = '';
    slots.forEach((slot, idx) => {
      const opt = document.createElement('option');
      opt.value = slot.slotId;
      const streamer = slot.currentStreamData?.streamer || slot.currentStreamData?.channelId || `空闲窗口`;
      const platform = (slot.currentStreamData?.platform || '').toUpperCase();
      opt.textContent = `窗口 #${slot.slotId} (${platform ? platform + ' ' : ''}${streamer})`;
      if (slot.slotId === this.getActiveSlotId()) opt.selected = true;
      this.slotSelect.appendChild(opt);
    });
    this.updateBadgeCount();
  }

  updateBadgeCount() {
    for (const slot of this.app.slotManager.slots.values()) {
      const count = slot.subtitleEngine?.history?.length || 0;
      const badge = slot.dom?.querySelector(`#ctrl-sub-badge-${slot.slotId}`);
      if (badge) {
        badge.textContent = String(count);
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    }
    if (this.countBadge) {
      let total = 0;
      for (const slot of this.app.slotManager.slots.values()) {
        total += slot.subtitleEngine?.history?.length || 0;
      }
      this.countBadge.textContent = String(total);
    }
  }

  updateSelectionUI() {
    this.selectedCountLabel.textContent = `已选: ${this.selectedIds.size}`;
    const checkboxes = this.subList.querySelectorAll('.sub-card-checkbox');
    checkboxes.forEach((cb) => {
      const card = cb.closest('.sub-card');
      const id = cb.dataset.id;
      cb.checked = this.selectedIds.has(id);
      card?.classList.toggle('selected', cb.checked);
    });
  }

  renderHistoryList() {
    if (!this.subList) return;
    const history = this.getCurrentSlotHistory();
    const filtered = this.searchKeyword
      ? history.filter((item) =>
          (item.zh && item.zh.toLowerCase().includes(this.searchKeyword)) ||
          (item.ko && item.ko.toLowerCase().includes(this.searchKeyword)) ||
          (item.speaker && item.speaker.toLowerCase().includes(this.searchKeyword))
        )
      : history;

    if (filtered.length === 0) {
      this.subList.innerHTML = `<div class="sub-empty-tip">${this.searchKeyword ? '无匹配的历史字幕' : '暂无转录字幕记录，开启实时字幕后自动记录...'}</div>`;
      return;
    }

    // 倒序展示：最新出现在最上方，便于直观阅读
    const displayList = [...filtered].reverse();
    this.subList.innerHTML = '';

    displayList.forEach((item) => {
      const card = document.createElement('div');
      card.className = `sub-card ${this.selectedIds.has(item.id) ? 'selected' : ''}`;
      card.dataset.id = item.id;

      const date = new Date(item.time);
      const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
      const diffSec = Math.max(0, Math.round((Date.now() - item.time) / 1000));
      const diffStr = diffSec < 60 ? `${diffSec}秒前` : `-${Math.floor(diffSec / 60)}分${diffSec % 60}秒`;

      const thumbHtml = item.frameThumbnail
        ? `<div class="sub-card-thumb-wrap">
             <img src="${item.frameThumbnail}" class="sub-card-thumb" alt="帧预览" />
             <div class="sub-card-thumb-play"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
           </div>`
        : `<div class="sub-card-thumb-wrap" style="display:flex;align-items:center;justify-content:center;background:#1e293b;color:#64748b;font-size:10px;">
             <span>无画面</span>
           </div>`;

      card.innerHTML = `
        <input type="checkbox" class="sub-card-checkbox" data-id="${item.id}" ${this.selectedIds.has(item.id) ? 'checked' : ''} />
        ${thumbHtml}
        <div class="sub-card-content">
          <div class="sub-card-meta">
            <span class="sub-card-speaker">${item.speaker || '主播'}</span>
            <span class="sub-card-time" title="发生时间: ${timeStr}">${timeStr} (${diffStr})</span>
          </div>
          ${item.zh ? `<div class="sub-card-zh">${item.zh}</div>` : ''}
          ${item.ko ? `<div class="sub-card-ko">${item.ko}</div>` : ''}
        </div>
      `;

      // 点击复选框只切换选择
      const checkbox = card.querySelector('.sub-card-checkbox');
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          this.selectedIds.add(item.id);
          card.classList.add('selected');
        } else {
          this.selectedIds.delete(item.id);
          card.classList.remove('selected');
        }
        this.selectedCountLabel.textContent = `已选: ${this.selectedIds.size}`;
      });

      // 点击卡片其余部分：触发跳转到对应时间播放
      card.addEventListener('click', () => {
        this.jumpToSubtitle(item);
        this.subList.querySelectorAll('.sub-card').forEach((c) => c.classList.remove('playing'));
        card.classList.add('playing');
      });

      this.subList.appendChild(card);
    });
  }

  /**
   * 点击历史字幕卡片跳转至该时间播放画面与本地缓存
   */
  jumpToSubtitle(item) {
    const slotId = this.getActiveSlotId();
    const slot = this.app.slotManager.slots.get(slotId);
    if (!slot || !slot.video) return;

    const targetTime = item.currentTime;
    console.log(`[KRStream] 点击字幕跳转播放: slot=${slotId}, targetTime=${targetTime}, offset=${item.liveOffset}s`);

    // 1. 如果已处于时光机 / Catch 模式
    if (slot.isCatchReplayMode) {
      slot.video.currentTime = targetTime;
      slot.video.play().catch(() => {});
      slot.showToast(`已跳转至时光机历史画面: -${Math.round(item.liveOffset || 0)}秒`);
      return;
    }

    // 2. 本地缓存检查 (由于配置了 backBufferLength: 600，10分钟以内的历史帧已缓存在 MediaSource 中)
    let inBuffer = false;
    const buffered = slot.video.buffered;
    for (let i = 0; i < buffered.length; i++) {
      if (targetTime >= buffered.start(i) && targetTime <= buffered.end(i)) {
        inBuffer = true;
        break;
      }
    }

    if (inBuffer) {
      slot.video.currentTime = targetTime;
      slot.video.play().catch(() => {});
      slot.showToast(`已跳转至 10 分钟本地缓存画面 (${item.zh || item.ko})`);
    } else {
      // 3. 超出当前 MSE 缓冲区，自动拉起官方时光机并精确定位
      slot.toggleCatchReplay().then(() => {
        setTimeout(() => {
          if (slot.video) {
            slot.video.currentTime = targetTime;
            slot.video.play().catch(() => {});
            slot.showToast(`启动时光机并定位至历史时刻 (${item.zh || item.ko})`);
          }
        }, 800);
      });
    }
  }

  /**
   * 一键转换字幕长图 (经典台词切片模式 vs 全幅平铺模式)
   */
  async generateLongImage(styleOverride) {
    const history = this.getCurrentSlotHistory();
    let selected = history.filter((item) => this.selectedIds.has(item.id));

    // 若未手动选择，自动取最近 4 条
    if (selected.length === 0) {
      if (history.length === 0) {
        alert('当前窗口暂无已转录的字幕记录！');
        return;
      }
      selected = history.slice(-4);
      selected.forEach((it) => this.selectedIds.add(it.id));
      this.updateSelectionUI();
    }

    // 按时间正序排列
    selected.sort((a, b) => a.time - b.time);

    const style = styleOverride || document.querySelector('input[name="long-img-style"]:checked')?.value || 'movie';
    const W = 1280;
    const H_HEADER = 80;
    const H_FIRST = Math.round((W * 9) / 16); // 720px
    const H_SLICE = style === 'movie' ? 140 : H_FIRST;
    const H_FOOTER = 50;

    const totalHeight = H_HEADER + H_FIRST + (selected.length - 1) * H_SLICE + H_FOOTER;

    this.canvas.width = W;
    this.canvas.height = totalHeight;
    const ctx = this.canvas.getContext('2d');

    // 1. 绘制背景与 Header
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, W, totalHeight);

    // Header 深色底栏与 1px 细边框
    ctx.fillStyle = '#101013';
    ctx.fillRect(0, 0, W, H_HEADER);
    ctx.fillStyle = '#232328';
    ctx.fillRect(0, H_HEADER - 1, W, 1);

    const slot = this.app.slotManager.slots.get(this.getActiveSlotId());
    const streamerName = slot?.currentStreamData?.streamer || 'KRStream 主播';
    const streamTitle = slot?.currentStreamData?.title || '精彩直播时刻记录';

    ctx.fillStyle = '#ededed';
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(`${streamerName} · 实时字幕集锦`, 30, 42);

    ctx.fillStyle = '#888892';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const dateStr = new Date(selected[0].time).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    ctx.fillText(`${streamTitle}  |  记录时间: ${dateStr}  |  共 ${selected.length} 句台词`, 30, 68);

    // 辅助加载图片 Promise
    const loadImage = (src) =>
      new Promise((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    const loadedImgs = await Promise.all(selected.map((s) => loadImage(s.frameThumbnail)));

    // 2. 绘制首张完整画面 (Top Full Image)
    const firstImg = loadedImgs[0];
    const topY = H_HEADER;
    if (firstImg) {
      ctx.drawImage(firstImg, 0, topY, W, H_FIRST);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, topY, W, H_FIRST);
    }

    // 绘制首图字幕条 (带半透明遮罩与柔和阴影)
    this.drawSubtitleBar(ctx, selected[0], 0, topY + H_FIRST - 120, W, 120);

    // 3. 绘制后续切片行 (Subsequent Slices)
    for (let i = 1; i < selected.length; i++) {
      const item = selected[i];
      const img = loadedImgs[i] || firstImg;
      const curY = topY + H_FIRST + (i - 1) * H_SLICE;

      if (style === 'movie') {
        // 经典台词模式：取该画面底部切片
        if (img) {
          const sy = Math.max(0, img.height - Math.round(img.height * (H_SLICE / H_FIRST)));
          const sh = img.height - sy;
          ctx.drawImage(img, 0, sy, img.width, sh, 0, curY, W, H_SLICE);
        } else {
          ctx.fillStyle = '#172033';
          ctx.fillRect(0, curY, W, H_SLICE);
        }
        // 切片分割线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, curY);
        ctx.lineTo(W, curY);
        ctx.stroke();

        this.drawSubtitleBar(ctx, item, 0, curY, W, H_SLICE);
      } else {
        // 全幅平铺模式
        if (img) {
          ctx.drawImage(img, 0, curY, W, H_FIRST);
        } else {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, curY, W, H_FIRST);
        }
        this.drawSubtitleBar(ctx, item, 0, curY + H_FIRST - 120, W, 120);
      }
    }

    // 4. Footer
    const footerY = totalHeight - H_FOOTER;
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, footerY, W, H_FOOTER);
    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KRStream Hub • 多平台多屏直播与 AI 实时多语言同传 • 生成并分享', W / 2, footerY + 30);
    ctx.textAlign = 'left';

    // 导出显示
    const dataUrl = this.canvas.toDataURL('image/png');
    this.previewImg.src = dataUrl;
    this.modal.style.display = 'flex';
  }

  drawSubtitleBar(ctx, item, x, y, w, h) {
    // 阴影渐变背景
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // 文字绘制
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const hasZh = Boolean(item.zh);
    const hasKo = Boolean(item.ko);

    if (hasZh && hasKo) {
      // 双语：中文在上(显眼黄色/纯白大字)，韩语在下
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 25px sans-serif';
      ctx.fillText(item.zh, x + 35, y + Math.round(h * 0.45));

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '18px sans-serif';
      ctx.fillText(item.ko, x + 35, y + Math.round(h * 0.8));
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(item.zh || item.ko || '', x + 35, y + Math.round(h * 0.6));
    }

    // 重置 shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  async copyLongImage() {
    this.canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        alert('字幕长图已成功复制到剪贴板，可以直接在社交平台或聊天软件中粘贴 (Ctrl+V) 分享。');
      } catch (err) {
        alert('复制失败，请点击下载长图: ' + err.message);
      }
    }, 'image/png');
  }

  downloadLongImage() {
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timeStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `KRStream_字幕长图_${timeStr}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}

// 主应用程序 Hub
class AppHub {
  constructor() {
    this.slotManager = new SlotManager();
    this.followings = [];
    this.currentFilter = 'all';
    this.pollTimer = null;

    this.sidebar = document.getElementById('sidebar');
    this.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    this.btnExpandSidebar = document.getElementById('btn-expand-sidebar');
    this.btnDetect = document.getElementById('btn-detect-accounts');
    this.btnSyncAll = document.getElementById('btn-sync-all');
    this.customInput = document.getElementById('custom-stream-input');
    this.btnCustomPlay = document.getElementById('btn-custom-play');
    this.streamerListContainer = document.getElementById('streamer-list');
    this.btnAddWindow = document.getElementById('btn-add-window');
    this.btnClearAll = document.getElementById('btn-clear-all');

    this.init();
  }

  init() {
    const isStandalone = new URLSearchParams(location.search).get('standalone') === 'true' || 
                         new URLSearchParams(location.search).get('popup') === '1';
    if (isStandalone) {
      document.body.classList.add('mode-standalone');
    }

    this.bindEvents();
    if (localStorage.getItem('krstream_sidebar_collapsed') === 'true') {
      this.sidebar.classList.add('collapsed');
    }
    this.rightDrawer = new RightDrawerManager(this);
    this.slotManager.restoreState();
    if (!isStandalone) {
      this.checkAccounts();
      this.loadSavedFollowings();
      this.startAutoRefresh();
    }
    this.parseUrlParams();
  }

  bindEvents() {
    // 侧边栏折叠与展开 (修复收起后无法再次弹出的 Bug)
    this.btnToggleSidebar.addEventListener('click', () => {
      this.sidebar.classList.toggle('collapsed');
      localStorage.setItem('krstream_sidebar_collapsed', this.sidebar.classList.contains('collapsed'));
    });
    this.btnExpandSidebar?.addEventListener('click', () => {
      this.sidebar.classList.remove('collapsed');
      localStorage.setItem('krstream_sidebar_collapsed', 'false');
    });

    // 布局切换
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.slotManager.setLayout(btn.dataset.layout);
      });
    });

    // 增加窗口 / 清空网格
    this.btnAddWindow.addEventListener('click', () => {
      this.slotManager.createSlot();
    });
    this.btnClearAll.addEventListener('click', () => {
      if (confirm('确定清空所有已打开的播放窗口？')) {
        this.slotManager.clearAll();
      }
    });

    // 账号检测与同步
    this.btnDetect.addEventListener('click', () => this.checkAccounts());
    this.btnSyncAll.addEventListener('click', () => this.syncFollowings());

    // 过滤标签切换
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.renderStreamerList();
      });
    });

    // 自定义输入播放
    this.btnCustomPlay.addEventListener('click', () => this.handleCustomPlay());
    this.customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleCustomPlay();
    });

    // 页面可见性恢复时，立即执行一次主播开播状态静默同步
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.silentRefreshFollowings();
      }
    });
  }

  async checkAccounts() {
    const badgeSoop = document.getElementById('acc-soop');
    const badgeChzzk = document.getElementById('acc-chzzk');
    const badgeCime = document.getElementById('acc-cime');

    chrome.runtime.sendMessage({ action: 'GET_ACCOUNTS_STATUS' }, (res) => {
      if (res && res.success && res.data) {
        const { soop, chzzk, cime } = res.data;

        if (soop.isLoggedIn) {
          badgeSoop.className = 'acc-badge online';
          badgeSoop.title = `SOOP: 已连接 (${soop.username || '已登录'})`;
          badgeSoop.querySelector('.name').textContent = `SOOP: 已连接 (${soop.username || '已登录'})`;
          badgeSoop.onclick = null;
        } else {
          badgeSoop.className = 'acc-badge';
          badgeSoop.title = '未登录 SOOP，点击可在新标签页打开 sooplive.com 登录';
          badgeSoop.querySelector('.name').textContent = 'SOOP: 未登录';
          badgeSoop.onclick = () => window.open('https://www.sooplive.com', '_blank');
        }

        if (chzzk.isLoggedIn) {
          badgeChzzk.className = 'acc-badge online';
          badgeChzzk.title = `CHZZK: 已连接 (${chzzk.username || 'Naver已登录'})`;
          badgeChzzk.querySelector('.name').textContent = `CHZZK: 已连接 (${chzzk.username || 'Naver已登录'})`;
          badgeChzzk.onclick = null;
        } else {
          badgeChzzk.className = 'acc-badge';
          badgeChzzk.title = '未登录 Naver/Chzzk，点击可在新标签页打开 chzzk.naver.com 登录';
          badgeChzzk.querySelector('.name').textContent = 'CHZZK: 未登录';
          badgeChzzk.onclick = () => window.open('https://chzzk.naver.com', '_blank');
        }

        if (cime.isLoggedIn) {
          badgeCime.className = 'acc-badge online';
          badgeCime.querySelector('.name').textContent = 'CI.ME: 已连接';
        } else {
          badgeCime.className = 'acc-badge';
          badgeCime.querySelector('.name').textContent = 'CI.ME: 未登录/访客';
        }
      }
    });
  }

  async syncFollowings() {
    const syncText = document.getElementById('sync-btn-text');
    syncText.textContent = '正在拉取三大平台关注主播...';
    this.btnSyncAll.disabled = true;

    chrome.runtime.sendMessage({ action: 'SYNC_FOLLOWINGS' }, (res) => {
      this.btnSyncAll.disabled = false;
      syncText.textContent = '一键导入并同步关注主播';

      if (res && res.success && res.data) {
        this.followings = res.data;
        this.renderStreamerList();
        this.updateCounts();
        this.startAutoRefresh(); // 重置自动轮询间隔
      } else {
        alert('拉取关注失败: ' + (res?.error || '网络错误'));
      }
    });
  }

  // 侧边栏关注主播开播/下播状态定期自动静默刷新 (默认每 20 秒轮询一次)
  startAutoRefresh(intervalMs = 20000) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (!document.hidden) {
        this.silentRefreshFollowings();
      }
    }, intervalMs);
  }

  // 静默更新：若关注列表或开播状态发生变动，平滑刷新卡片指示器与计数
  silentRefreshFollowings() {
    chrome.runtime.sendMessage({ action: 'SYNC_FOLLOWINGS' }, (res) => {
      if (res && res.success && res.data) {
        const oldSign = JSON.stringify(this.followings.map((f) => `${f.channelId}_${f.isLive}_${f.title}_${f.viewers}`));
        const newSign = JSON.stringify(res.data.map((f) => `${f.channelId}_${f.isLive}_${f.title}_${f.viewers}`));
        this.followings = res.data;
        if (oldSign !== newSign) {
          this.renderStreamerList();
          this.updateCounts();
        }
      }
    });
  }

  loadSavedFollowings() {
    chrome.storage.local.get(['syncedFollowings'], (res) => {
      if (res.syncedFollowings && res.syncedFollowings.length > 0) {
        this.followings = res.syncedFollowings;
        this.renderStreamerList();
        this.updateCounts();
      }
      // 无论本地是否有历史缓存，打开页面时均立即在后台刷新一次最新的直播信息，无需等待 20 秒
      this.syncFollowings();
    });
  }

  updateCounts() {
    const countAll = document.getElementById('count-all');
    const countLive = document.getElementById('count-live');
    if (countAll) countAll.textContent = this.followings.length;
    if (countLive) countLive.textContent = this.followings.filter((f) => f.isLive).length;
  }

  renderStreamerList() {
    let filtered = [...this.followings];

    if (this.currentFilter === 'live') {
      filtered = filtered.filter((f) => f.isLive);
    } else if (['soop', 'chzzk', 'cime'].includes(this.currentFilter)) {
      filtered = filtered.filter((f) => f.platform === this.currentFilter);
    }

    filtered.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return (b.viewers || 0) - (a.viewers || 0);
    });

    if (filtered.length === 0) {
      this.streamerListContainer.innerHTML = `
        <div class="empty-state">该分类下暂无主播，请点击上方【一键导入并同步关注主播】刷新。</div>
      `;
      return;
    }

    this.streamerListContainer.innerHTML = '';
    filtered.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'streamer-card';

      card.innerHTML = `
        <div class="avatar-wrapper">
          <img class="streamer-avatar" src="${item.avatar || item.thumbnail || '../icons/icon48.png'}" alt="" onerror="this.onerror=null;this.src='../icons/icon48.png';" />
          <span class="live-indicator ${item.isLive ? 'live' : 'offline'}"></span>
        </div>
        <div class="streamer-info">
          <div class="info-row-top">
            <span class="platform-pill ${item.platform}">${item.platform.toUpperCase()}</span>
            <span class="streamer-title-name">${item.streamer || item.channelId}</span>
            ${item.isLive ? `<span class="viewers-badge">${item.viewers ? item.viewers + ' 人' : '直播'}</span>` : ''}
          </div>
          <div class="stream-sub-title">${item.title || (item.isLive ? '正在直播' : '离线')}</div>
        </div>

        <div class="card-hover-actions">
          <button class="card-btn btn-play-new" title="加入或新建窗口播放">播放</button>
          <button class="card-btn btn-copy" title="复制 M3U8 直链">直链</button>
        </div>
      `;

      // 点击主体或【+ 播放】：优先放入空闲窗口，若无空闲窗口则新建窗口
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-copy')) return;
        let slot = this.slotManager.findAvailableSlot();
        if (!slot) {
          slot = this.slotManager.createSlot();
        }
        slot.loadStream(item);
      });

      // 复制直链
      card.querySelector('.btn-copy').addEventListener('click', async (e) => {
        e.stopPropagation();
        const copyBtn = card.querySelector('.btn-copy');
        copyBtn.textContent = '...';
        try {
          const res = await chrome.runtime.sendMessage({
            action: 'RESOLVE_STREAM',
            payload: {
              input: `${item.platform === 'cime' ? 'https://ci.me/@' : item.platform === 'chzzk' ? 'https://chzzk.naver.com/live/' : 'https://play.sooplive.com/'}${item.channelId}`
            }
          });
          if (res?.data?.streamUrl) {
            await navigator.clipboard.writeText(res.data.streamUrl);
            copyBtn.textContent = '已复制';
            setTimeout(() => (copyBtn.textContent = '直链'), 1500);
          } else {
            alert('获取直链失败: ' + (res?.error || '主播可能未开播'));
            copyBtn.textContent = '直链';
          }
        } catch (err) {
          alert('解析异常: ' + err.message);
          copyBtn.textContent = '直链';
        }
      });

      this.streamerListContainer.appendChild(card);
    });
  }

  async handleCustomPlay(options = {}) {
    const text = this.customInput.value.trim();
    if (!text) return;

    let slot = this.slotManager.findAvailableSlot();
    if (!slot) {
      slot = this.slotManager.createSlot();
    }
    slot.showLoading('正在解析输入链接...');

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'RESOLVE_STREAM', payload: { input: text } },
        (res) => {
          if (res && res.success && res.data?.isLive) {
            slot.loadStream(res.data).then(() => {
              if (options.mode === 'replay') {
                setTimeout(() => slot.toggleCatchReplay(), 800);
              }
              resolve(slot);
            });
            this.customInput.value = '';
          } else {
            alert('解析失败: ' + (res?.error || res?.data?.message || '主播未开播'));
            slot.hideLoading();
            resolve(null);
          }
        }
      );
    });
  }

  parseUrlParams() {
    const params = new URLSearchParams(location.search);
    const isStandalone = params.get('standalone') === 'true' || params.get('popup') === '1';
    if (isStandalone) {
      document.body.classList.add('mode-standalone');
    }

    const streamUrl = params.get('streamUrl');
    const input = params.get('input');
    const mode = params.get('mode');

    if (streamUrl) {
      const streamer = params.get('streamer') || 'Live';
      if (isStandalone) {
        document.title = `${streamer} - KRStream 悬浮小窗播放器`;
      }
      const slot = this.slotManager.findAvailableSlot() || this.slotManager.createSlot();
      const cdn = params.get('cdn') || 'default';
      slot.selectedCdn = cdn;
      const danmakuEnabled = params.get('danmaku') !== '0';
      const subsEnabled = params.get('subs') === '1';
      const subMode = params.get('subMode') || 'bilingual';
      const subP = params.get('subP') || 'zh-CN';
      const subS = params.get('subS') || 'ko';
      const subBi = params.get('subBi') !== '0';
      const subSize = params.get('subSize') || 'medium';

      slot.loadStream({
        streamUrl,
        platform: params.get('platform') || 'soop',
        streamer: streamer,
        title: params.get('title') || '',
        channelId: params.get('channelId') || '',
        danmakuEnabled: danmakuEnabled,
        subtitlesEnabled: subsEnabled,
        subtitlePrimaryLang: subP,
        subtitleSecondaryLang: subS,
        subtitleIsBilingual: subBi,
        subtitleFontSize: subSize,
        subtitleMode: subMode
      }).then(() => {
        if (subsEnabled && slot.subtitleEngine) {
          slot.subtitleEngine.enabled = true;
          slot.subtitleEngine.setPrimaryLang(subP);
          slot.subtitleEngine.setSecondaryLang(subS);
          slot.subtitleEngine.setBilingual(subBi);
          slot.subtitleEngine.setFontSize(subSize);
          slot.subtitleEngine.updateButtonState();
          slot.subtitleEngine.start();
        }
        if (mode === 'replay') {
          setTimeout(() => slot.toggleCatchReplay(), 800);
        }
      });
    } else if (input) {
      this.customInput.value = input;
      this.handleCustomPlay({ mode });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__KRSTREAM_APP__ = new AppHub();
});
