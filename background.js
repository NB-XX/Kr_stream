/**
 * KRStream Direct & Enhancer
 * Background Service Worker
 */

import { StreamResolver } from './core/stream-resolver.js';
import { AccountManager } from './core/account-manager.js';
import { Storage } from './core/storage.js';

// 初始化三大平台动态 DNR 鉴权与流媒体放行规则 (严格限定 initiatorDomains 为插件自身)
AccountManager.setupAllDynamicRules().catch(() => {});

// 监听浏览器 Cookie 变动，当 SOOP / Naver 登录态变化时自动热更新动态凭证规则
if (typeof chrome !== 'undefined' && chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    const domain = changeInfo?.cookie?.domain || '';
    if (domain.includes('sooplive') || domain.includes('afreecatv') || domain.includes('naver')) {
      AccountManager.setupAllDynamicRules().catch(() => {});
    }
  });
}

// 点击插件图标直接进入独立多路播放工作台页面
chrome.action.onClicked.addListener(async () => {
  openPlayerTab({});
});

// 初始化快捷右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-in-krstream-player',
    title: '用 KRStream 独立工作台播放此直播',
    contexts: ['link', 'page']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-in-krstream-player') {
    const targetUrl = info.linkUrl || info.pageUrl;
    if (targetUrl) {
      openPlayerTab({ input: targetUrl });
    }
  }
});

// 处理前端页面通讯
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, payload } = request;

  switch (action) {
    case 'RESOLVE_STREAM':
      StreamResolver.resolve(payload.input, payload.options)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_SOOP_REPLAY':
      StreamResolver.getSoopCatchReplay(payload.bjId, payload.broadNo)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_CHZZK_REPLAY':
      StreamResolver.getChzzkTimeMachine(payload.channelId, payload.options)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_STREAM_REPLAY':
      StreamResolver.getStreamReplay(payload.platform, payload.channelId, payload.extra)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_ACCOUNTS_STATUS':
      AccountManager.getAccountsStatus()
        .then((status) => sendResponse({ success: true, data: status }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SYNC_FOLLOWINGS':
      AccountManager.syncAllFollowings()
        .then((res) => {
          if (res.all && res.all.length > 0) {
            chrome.storage.local.set({ syncedFollowings: res.all, lastSyncedAt: Date.now() });
          }
          sendResponse({ success: true, data: res.all, details: res.details });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'OPEN_PLAYER':
      openPlayerTab(payload)
        .then((tab) => sendResponse({ success: true, tabId: tab.id }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'PING_CDN':
      StreamResolver.pingCdn(payload.host)
        .then((latency) => sendResponse({ success: true, latency }))
        .catch(() => sendResponse({ success: true, latency: -1 }));
      return true;

    case 'GET_SETTINGS':
      Storage.getSettings().then((settings) => sendResponse({ success: true, data: settings }));
      return true;

    case 'SAVE_SETTINGS':
      Storage.saveSettings(payload).then((settings) => sendResponse({ success: true, data: settings }));
      return true;

    default:
      sendResponse({ success: false, error: `未知操作: ${action}` });
      return false;
  }
});

/**
 * 打开或聚焦独立播放器工作台标签页
 */
async function openPlayerTab({ input, streamUrl, platform, title, streamer, channelId, mode }) {
  const playerUrl = chrome.runtime.getURL('player/player.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && t.url.includes('player/player.html'));

  const query = new URLSearchParams();
  if (input) query.set('input', input);
  if (streamUrl) query.set('streamUrl', streamUrl);
  if (platform) query.set('platform', platform);
  if (title) query.set('title', title);
  if (streamer) query.set('streamer', streamer);
  if (channelId) query.set('channelId', channelId);
  if (mode) query.set('mode', mode);

  const fullUrl = `${playerUrl}?${query.toString()}`;

  if (existing) {
    if (input || streamUrl) {
      await chrome.tabs.update(existing.id, { url: fullUrl, active: true });
    } else {
      await chrome.tabs.update(existing.id, { active: true });
    }
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return existing;
  } else {
    return await chrome.tabs.create({ url: fullUrl });
  }
}
