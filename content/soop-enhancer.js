/**
 * KRStream Direct & Enhancer
 * SOOP Content Script (Player Overlay & Host Integration)
 */

(function () {
  'use strict';

  // 1. 注入主世界页面拦截脚本
  function injectMainWorldScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/soop-injected.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
  injectMainWorldScript();

  // 从 URL 获取当前主播 ID
  function getChannelId() {
    const match = location.pathname.match(/\/([a-zA-Z0-9_]+)/);
    return match ? match[1] : null;
  }

  // 2. 初始化浮动增强控制条
  let audioContext = null;
  let gainNode = null;
  let audioSource = null;

  function initAudioBooster(video) {
    if (!audioContext) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        gainNode = audioContext.createGain();
        audioSource = audioContext.createMediaElementSource(video);
        audioSource.connect(gainNode);
        gainNode.connect(audioContext.destination);
      } catch (e) {
        console.warn('[KRStream] 音频增益初始化失败:', e);
      }
    }
  }

  function setAudioGain(multiplier) {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (gainNode) {
      gainNode.gain.value = multiplier;
    }
  }

  function buildOverlay() {
    if (document.getElementById('krstream-soop-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'krstream-soop-overlay';
    overlay.className = 'krstream-bar';
    overlay.innerHTML = `
      <div class="krstream-badge">KRStream</div>
      
      <!-- 独立播放 -->
      <button class="krstream-btn highlight" id="btn-kr-open" title="绕过官方网页资源，在独立轻量播放器中打开">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <span>独立播放</span>
      </button>

      <!-- 实时回看 (Catch 伪时光机) -->
      <button class="krstream-btn highlight-pink" id="btn-kr-replay" title="以实时回看模式打开独立播放器 (Catch 归档伪时光机)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 8 14"/></svg>
        <span>回看</span>
      </button>

      <!-- 复制直链 -->
      <button class="krstream-btn" id="btn-kr-copy" title="复制 M3U8 直播直链">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span>复制直链</span>
      </button>

      <!-- CDN 选择 -->
      <div class="krstream-dropdown">
        <button class="krstream-btn" id="btn-kr-cdn" title="切换最优 CDN 节点加速">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span id="label-kr-cdn">Global CDN</span>
        </button>
        <div class="krstream-menu" id="menu-kr-cdn">
          <div class="krstream-menu-item active" data-cdn="live-global-cdn-v02.sooplive.com" data-label="Global CDN">
            <span>Global (大陆推荐)</span>
            <span class="krstream-ping" id="ping-global">...</span>
          </div>
          <div class="krstream-menu-item" data-cdn="live-global-cdn-v02.sooplive.co.kr" data-label="Global KR">
            <span>Global KR</span>
            <span class="krstream-ping" id="ping-globalkr">...</span>
          </div>
          <div class="krstream-menu-item" data-cdn="live-pcweb-kr-cdn-z02.sooplive.com" data-label="KR Zone">
            <span>KR Zone (首尔原站)</span>
            <span class="krstream-ping" id="ping-krzone">...</span>
          </div>
        </div>
      </div>

      <!-- 画质锁定 -->
      <button class="krstream-btn active" id="btn-kr-quality" title="锁定原画 1080p60，禁止自动降速">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span>锁定原画</span>
      </button>

      <!-- 音量增强 -->
      <div class="krstream-dropdown">
        <button class="krstream-btn" id="btn-kr-audio" title="音量放大增强">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          <span id="label-kr-volume">100%</span>
        </button>
        <div class="krstream-menu krstream-volume-menu">
          <div class="krstream-volume-control">
            <label>音量放大: <span id="val-kr-volume">100%</span></label>
            <input type="range" id="slider-kr-volume" min="100" max="300" step="25" value="100" />
          </div>
        </div>
      </div>

      <!-- 画中画 -->
      <button class="krstream-btn" id="btn-kr-pip" title="画中画播放">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M12 9h8v8h-8z"/></svg>
      </button>

      <!-- 截图 -->
      <button class="krstream-btn" id="btn-kr-screenshot" title="截取当前帧画面">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>

      <!-- 实时字幕 -->
      <button class="krstream-btn" id="btn-kr-sub" title="开启/关闭直播实时双语字幕">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>字幕</span>
      </button>
    `;

    document.body.appendChild(overlay);
    bindEvents(overlay);
  }

  function bindEvents(overlay) {
    const channelId = getChannelId();

    // 独立播放
    overlay.querySelector('#btn-kr-open').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER',
        payload: { input: location.href, channelId, platform: 'soop' }
      });
    });

    // 实时回看 (Catch 伪时光机)
    overlay.querySelector('#btn-kr-replay').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER',
        payload: { input: location.href, channelId, platform: 'soop', mode: 'replay' }
      });
    });

    // 复制直链
    overlay.querySelector('#btn-kr-copy').addEventListener('click', async () => {
      const btn = overlay.querySelector('#btn-kr-copy');
      try {
        btn.querySelector('span').textContent = '解析中...';
        const res = await chrome.runtime.sendMessage({
          action: 'RESOLVE_STREAM',
          payload: { input: location.href }
        });
        if (res.success && res.data?.streamUrl) {
          await navigator.clipboard.writeText(res.data.streamUrl);
          btn.querySelector('span').textContent = '已复制!';
          setTimeout(() => (btn.querySelector('span').textContent = '复制直链'), 2000);
        } else {
          alert('解析失败: ' + (res.error || '主播可能未开播'));
          btn.querySelector('span').textContent = '复制直链';
        }
      } catch (e) {
        alert('复制异常: ' + e.message);
        btn.querySelector('span').textContent = '复制直链';
      }
    });

    // CDN 切换
    const cdnItems = overlay.querySelectorAll('.krstream-menu-item');
    cdnItems.forEach((item) => {
      item.addEventListener('click', () => {
        cdnItems.forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
        const targetCdn = item.dataset.cdn;
        overlay.querySelector('#label-kr-cdn').textContent = item.dataset.label;

        // 向注入脚本广播目标 CDN 切换
        window.postMessage({
          type: 'KRSTREAM_UPDATE_SOOP_CONFIG',
          payload: { targetCdn }
        }, '*');
      });
    });

    // 延迟测速
    pingCdnNodes(overlay);

    // 原画锁定切换
    let lockQuality = true;
    const btnQuality = overlay.querySelector('#btn-kr-quality');
    btnQuality.addEventListener('click', () => {
      lockQuality = !lockQuality;
      btnQuality.classList.toggle('active', lockQuality);
      window.postMessage({
        type: 'KRSTREAM_UPDATE_SOOP_CONFIG',
        payload: { forceMaxQuality: lockQuality }
      }, '*');
    });

    // 音量增强调节
    const slider = overlay.querySelector('#slider-kr-volume');
    const valLabel = overlay.querySelector('#val-kr-volume');
    const btnVolumeLabel = overlay.querySelector('#label-kr-volume');
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      valLabel.textContent = `${val}%`;
      btnVolumeLabel.textContent = `${val}%`;

      const video = document.querySelector('video');
      if (video) {
        initAudioBooster(video);
        setAudioGain(val / 100);
      }
    });

    // 画中画
    overlay.querySelector('#btn-kr-pip').addEventListener('click', async () => {
      const video = document.querySelector('video');
      if (video) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      }
    });

    // 截图
    overlay.querySelector('#btn-kr-screenshot').addEventListener('click', () => {
      const video = document.querySelector('video');
      if (!video) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.download = `soop_${channelId}_${Date.now()}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    });

    // 实时双语字幕
    let subEnabled = false;
    let subHideTimer = null;
    const subCache = new Map();

    const subBox = document.createElement('div');
    subBox.id = 'krstream-soop-subtitle-box';
    subBox.className = 'krstream-page-subtitle-box';
    subBox.style.display = 'none';
    subBox.innerHTML = `
      <div class="krstream-sub-zh"></div>
      <div class="krstream-sub-ko"></div>
    `;
    document.body.appendChild(subBox);

    const btnSub = overlay.querySelector('#btn-kr-sub');
    if (btnSub) {
      btnSub.addEventListener('click', () => {
        subEnabled = !subEnabled;
        btnSub.classList.toggle('active', subEnabled);
        if (!subEnabled) {
          subBox.style.display = 'none';
        }
      });
    }

    async function translateText(text) {
      if (!text) return '';
      if (subCache.has(text)) return subCache.get(text);
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const tr = json?.[0]?.[0]?.[0] || '';
          if (tr) {
            subCache.set(text, tr);
            return tr;
          }
        }
      } catch (e) {}
      return text;
    }

    window.addEventListener('KRSTREAM_SOOP_PAGE_SUBTITLE', async (e) => {
      if (!subEnabled || !e.detail || !e.detail.text) return;
      const koText = e.detail.text;
      const zhText = await translateText(koText);

      const zhEl = subBox.querySelector('.krstream-sub-zh');
      const koEl = subBox.querySelector('.krstream-sub-ko');
      if (zhEl) zhEl.textContent = zhText;
      if (koEl) koEl.textContent = koText;
      subBox.style.display = 'block';

      if (subHideTimer) clearTimeout(subHideTimer);
      subHideTimer = setTimeout(() => {
        subBox.style.display = 'none';
      }, 5500);
    });
  }

  async function pingCdnNodes(overlay) {
    const nodes = [
      { id: '#ping-global', host: 'live-global-cdn-v02.sooplive.com' },
      { id: '#ping-globalkr', host: 'live-global-cdn-v02.sooplive.co.kr' },
      { id: '#ping-krzone', host: 'live-pcweb-kr-cdn-z02.sooplive.com' }
    ];

    for (const node of nodes) {
      chrome.runtime.sendMessage(
        { action: 'PING_CDN', payload: { host: node.host } },
        (res) => {
          const el = overlay.querySelector(node.id);
          if (el && res && res.latency !== undefined) {
            if (res.latency > 0) {
              el.textContent = `${res.latency}ms`;
              el.style.color = res.latency < 100 ? '#4ade80' : res.latency < 250 ? '#facc15' : '#f87171';
            } else {
              el.textContent = '超时';
              el.style.color = '#ef4444';
            }
          }
        }
      );
    }
  }

  // 挂载尝试
  const timer = setInterval(() => {
    if (document.body) {
      buildOverlay();
      clearInterval(timer);
    }
  }, 1000);
})();
