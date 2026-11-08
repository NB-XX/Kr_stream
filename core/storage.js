/**
 * KRStream Direct & Enhancer
 * Storage Management Module
 */

const DEFAULT_SETTINGS = {
  blockTrackers: true,             // 屏蔽中国访问慢的遥测/广告/统计
  forceSoopOriginalQuality: true,  // 强制 SOOP 原画画质 (1080p60/16Mbps)
  soopCdnPreference: 'global',     // 'global' | 'kr_zone' | 'global_kr' | 'auto'
  lowLatencyMode: true,            // 开启低延迟直播播放
  audioBoostEnabled: true,         // 开启音量增益功能
  dualStreamAutoMuteB: true        // 双路播放时默认静音副路
};

export const Storage = {
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (res) => {
        resolve({ ...DEFAULT_SETTINGS, ...res.settings });
      });
    });
  },

  async saveSettings(newSettings) {
    const current = await this.getSettings();
    const updated = { ...current, ...newSettings };
    return new Promise((resolve) => {
      chrome.storage.local.set({ settings: updated }, () => resolve(updated));
    });
  },

  async getFavorites() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ favorites: [] }, (res) => {
        resolve(res.favorites || []);
      });
    });
  },

  async addFavorite(item) {
    const favs = await this.getFavorites();
    const existingIndex = favs.findIndex(
      (f) => f.platform === item.platform && f.channelId === item.channelId
    );
    if (existingIndex >= 0) {
      favs[existingIndex] = { ...favs[existingIndex], ...item, updatedAt: Date.now() };
    } else {
      favs.unshift({ ...item, addedAt: Date.now(), updatedAt: Date.now() });
    }
    return new Promise((resolve) => {
      chrome.storage.local.set({ favorites: favs }, () => resolve(favs));
    });
  },

  async removeFavorite(platform, channelId) {
    const favs = await this.getFavorites();
    const filtered = favs.filter(
      (f) => !(f.platform === platform && f.channelId === channelId)
    );
    return new Promise((resolve) => {
      chrome.storage.local.set({ favorites: filtered }, () => resolve(filtered));
    });
  },

  async getHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ history: [] }, (res) => {
        resolve(res.history || []);
      });
    });
  },

  async addHistory(item) {
    const hist = await this.getHistory();
    const filtered = hist.filter(
      (h) => !(h.platform === item.platform && h.channelId === item.channelId)
    );
    filtered.unshift({ ...item, playedAt: Date.now() });
    // 保留最近 30 条
    const limited = filtered.slice(0, 30);
    return new Promise((resolve) => {
      chrome.storage.local.set({ history: limited }, () => resolve(limited));
    });
  }
};
