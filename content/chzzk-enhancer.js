/**
 * KRStream Direct & Enhancer
 * Chzzk Content Script (Player Overlay & Tools)
 */

(function () {
  'use strict';

  function getChannelId() {
    const match = location.pathname.match(/(?:live\/)?([a-f0-9]{32})/i);
    return match ? match[1] : null;
  }

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
        console.warn('[KRStream] Chzzk 音频增益初始化异常:', e);
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
    if (document.getElementById('krstream-chzzk-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'krstream-chzzk-overlay';
    overlay.className = 'krstream-bar';
    overlay.innerHTML = `
      <div class="krstream-badge chzzk">CHZZK</div>
      
      <!-- 独立播放 -->
      <button class="krstream-btn highlight" id="btn-kr-open" title="绕过 Naver 繁重网页，使用独立极速播放器播放">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <span>独立播放</span>
      </button>

      <!-- 时光机回看 -->
      <button class="krstream-btn highlight-pink" id="btn-kr-replay" title="以时光机回看模式打开独立播放器 (前退10分钟回看)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 8 14"/></svg>
        <span>时光机</span>
      </button>

      <!-- 复制直链 -->
      <button class="krstream-btn" id="btn-kr-copy" title="解析并复制 HLS (m3u8) 直播源">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span>复制直链</span>
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
      <button class="krstream-btn" id="btn-kr-pip" title="画中画模式">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M12 9h8v8h-8z"/></svg>
      </button>

      <!-- 截图 -->
      <button class="krstream-btn" id="btn-kr-screenshot" title="原画截图保存">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>
    `;

    document.body.appendChild(overlay);
    bindEvents(overlay);
  }

  function bindEvents(overlay) {
    overlay.querySelector('#btn-kr-open').addEventListener('click', () => {
      const channelId = getChannelId();
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER',
        payload: { input: location.href, channelId, platform: 'chzzk' }
      });
    });

    overlay.querySelector('#btn-kr-replay').addEventListener('click', () => {
      const channelId = getChannelId();
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER',
        payload: { input: location.href, channelId, platform: 'chzzk', mode: 'replay' }
      });
    });

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

    overlay.querySelector('#btn-kr-screenshot').addEventListener('click', () => {
      const video = document.querySelector('video');
      if (!video) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.download = `chzzk_${getChannelId() || 'live'}_${Date.now()}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    });
  }

  setInterval(() => {
    if (location.pathname.includes('/live/') || /^[a-f0-9]{32}$/i.test(location.pathname.replace(/^\//, ''))) {
      buildOverlay();
    }
  }, 1500);
})();
