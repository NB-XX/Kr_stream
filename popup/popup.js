/**
 * KRStream Direct & Enhancer
 * Popup Controller Script
 */

let currentResolvedData = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initResolver();
  initFavorites();
  initSettings();
});

// 1. 选项卡切换
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`pane-${target}`).classList.add('active');

      if (target === 'favorites') {
        loadFavoritesList();
      }
    });
  });
}

// 2. 直连解析模块
function initResolver() {
  const input = document.getElementById('input-stream');
  const btnResolve = document.getElementById('btn-resolve');
  const resultCard = document.getElementById('result-card');

  const resAvatar = document.getElementById('res-avatar');
  const resPlatform = document.getElementById('res-platform');
  const resName = document.getElementById('res-name');
  const resStatus = document.getElementById('res-status');
  const resTitle = document.getElementById('res-title');

  const btnPlaySingle = document.getElementById('btn-play-single');
  const btnPlayDual = document.getElementById('btn-play-dual');
  const btnCopyM3u8 = document.getElementById('btn-copy-m3u8');
  const btnFavAdd = document.getElementById('btn-fav-add');

  btnResolve.addEventListener('click', () => handleResolve());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleResolve();
  });

  async function handleResolve() {
    const text = input.value.trim();
    if (!text) return;

    btnResolve.textContent = '解析中...';
    btnResolve.disabled = true;

    chrome.runtime.sendMessage(
      { action: 'RESOLVE_STREAM', payload: { input: text } },
      (res) => {
        btnResolve.textContent = '解析';
        btnResolve.disabled = false;

        if (res && res.success && res.data) {
          const data = res.data;
          currentResolvedData = data;

          resultCard.style.display = 'flex';
          resAvatar.src = data.thumbnail || '../icons/icon48.png';
          resPlatform.textContent = (data.platform || 'LIVE').toUpperCase();
          resName.textContent = data.streamer || data.channelId;
          resTitle.textContent = data.title || (data.isLive ? '正在直播' : '未开播');
          resStatus.textContent = data.isLive ? '● 直播中' : '离线';
          resStatus.style.color = data.isLive ? '#ef4444' : '#94a3b8';

          btnPlaySingle.disabled = !data.isLive;
          btnPlayDual.disabled = !data.isLive;
          btnCopyM3u8.disabled = !data.isLive;
        } else {
          alert('解析失败: ' + (res?.error || '无法识别或网络错误'));
          resultCard.style.display = 'none';
        }
      }
    );
  }

  // 独立播放
  btnPlaySingle.addEventListener('click', () => {
    if (currentResolvedData) {
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER',
        payload: {
          streamUrl: currentResolvedData.streamUrl,
          platform: currentResolvedData.platform,
          streamer: currentResolvedData.streamer,
          title: currentResolvedData.title,
          channelId: currentResolvedData.channelId,
          mode: 'single'
        }
      });
    }
  });

  // 二路副屏播放
  btnPlayDual.addEventListener('click', () => {
    if (currentResolvedData) {
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER',
        payload: {
          streamUrl: currentResolvedData.streamUrl,
          platform: currentResolvedData.platform,
          streamer: currentResolvedData.streamer,
          title: currentResolvedData.title,
          channelId: currentResolvedData.channelId,
          mode: 'dual',
          targetSlot: 'b'
        }
      });
    }
  });

  // 复制 M3U8
  btnCopyM3u8.addEventListener('click', async () => {
    if (currentResolvedData?.streamUrl) {
      await navigator.clipboard.writeText(currentResolvedData.streamUrl);
      btnCopyM3u8.textContent = '已复制!';
      setTimeout(() => (btnCopyM3u8.textContent = '复制直链'), 2000);
    }
  });

  // 添加关注
  btnFavAdd.addEventListener('click', () => {
    if (currentResolvedData) {
      chrome.runtime.sendMessage(
        {
          action: 'ADD_FAVORITE',
          payload: {
            platform: currentResolvedData.platform,
            channelId: currentResolvedData.channelId,
            streamer: currentResolvedData.streamer,
            title: currentResolvedData.title,
            thumbnail: currentResolvedData.thumbnail,
            isLive: currentResolvedData.isLive
          }
        },
        () => {
          btnFavAdd.textContent = '已关注';
          setTimeout(() => (btnFavAdd.textContent = '⭐ 关注'), 2000);
        }
      );
    }
  });
}

// 3. 关注列表模块
function initFavorites() {
  const btnRefresh = document.getElementById('btn-refresh-favs');
  btnRefresh.addEventListener('click', () => {
    btnRefresh.textContent = '正在检测...';
    chrome.runtime.sendMessage({ action: 'CHECK_FAVORITES_LIVE' }, () => {
      btnRefresh.textContent = '↻ 刷新开播状态';
      loadFavoritesList();
    });
  });
}

function loadFavoritesList() {
  const container = document.getElementById('popup-fav-list');
  const countLabel = document.getElementById('fav-count');

  chrome.runtime.sendMessage({ action: 'GET_FAVORITES' }, (res) => {
    const favs = res?.data || [];
    countLabel.textContent = `已关注 ${favs.length} 位主播`;

    if (favs.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:16px;">关注列表为空，请在上方解析后点击【关注】添加。</div>';
      return;
    }

    container.innerHTML = '';
    favs.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'fav-item';
      card.innerHTML = `
        <img class="fav-avatar" src="${item.thumbnail || '../icons/icon48.png'}" alt="" />
        <div class="fav-text">
          <div class="fav-headline">
            <span class="platform-badge">${item.platform.toUpperCase()}</span>
            <span class="fav-name">${item.streamer || item.channelId}</span>
            <span class="live-status" style="color: ${item.isLive ? '#ef4444' : '#94a3b8'}">
              ${item.isLive ? '● 直播中' : '离线'}
            </span>
          </div>
          <div class="fav-sub">${item.title || item.channelId}</div>
        </div>
        <button class="btn-fav-play" ${item.isLive ? '' : 'disabled'}>播放</button>
        <button class="btn-fav-del" title="取消关注">&times;</button>
      `;

      // 播放点击
      card.querySelector('.btn-fav-play').addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: 'OPEN_PLAYER',
          payload: {
            input: `${item.platform === 'cime' ? 'https://ci.me/@' : item.platform === 'chzzk' ? 'https://chzzk.naver.com/live/' : 'https://play.sooplive.com/'}${item.channelId}`,
            platform: item.platform,
            channelId: item.channelId,
            streamer: item.streamer
          }
        });
      });

      // 删除点击
      card.querySelector('.btn-fav-del').addEventListener('click', () => {
        chrome.runtime.sendMessage(
          { action: 'REMOVE_FAVORITE', payload: { platform: item.platform, channelId: item.channelId } },
          () => loadFavoritesList()
        );
      });

      container.appendChild(card);
    });
  });
}

// 4. 加速与增强设置模块
function initSettings() {
  const chkBlock = document.getElementById('set-block-trackers');
  const chkQuality = document.getElementById('set-force-quality');
  const selectCdn = document.getElementById('set-soop-cdn');
  const chkAudio = document.getElementById('set-audio-boost');
  const btnSave = document.getElementById('btn-save-settings');

  // 读取已保存设置
  chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (res) => {
    if (res && res.data) {
      const s = res.data;
      chkBlock.checked = s.blockTrackers !== false;
      chkQuality.checked = s.forceSoopOriginalQuality !== false;
      selectCdn.value = s.soopCdnPreference || 'global';
      chkAudio.checked = s.audioBoostEnabled !== false;
    }
  });

  // 保存设置
  btnSave.addEventListener('click', () => {
    const newSettings = {
      blockTrackers: chkBlock.checked,
      forceSoopOriginalQuality: chkQuality.checked,
      soopCdnPreference: selectCdn.value,
      audioBoostEnabled: chkAudio.checked
    };

    chrome.runtime.sendMessage(
      { action: 'SAVE_SETTINGS', payload: newSettings },
      () => {
        btnSave.textContent = '已保存！';
        setTimeout(() => (btnSave.textContent = '保存配置'), 1500);
      }
    );
  });
}
