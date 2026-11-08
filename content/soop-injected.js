/**
 * KRStream Direct & Enhancer
 * SOOP Main World Injected Interceptor
 * Features: Tracking Blocking, CDN Rewriting, Force Original Quality, Buffer Spoofing
 */

(function () {
  'use strict';

  if (window.__KRSTREAM_SOOP_INJECTED__) return;
  window.__KRSTREAM_SOOP_INJECTED__ = true;

  // 默认设置
  const config = {
    blockTrackers: true,
    forceMaxQuality: true,
    targetCdn: 'live-global-cdn-v02.sooplive.com', // 默认 Global CDN (大陆访问最稳)
    audioBoostLevel: 1.0
  };

  const BLOCK_DOMAINS = [
    'collector1.sooplive.com',
    'analysis.sooplive.com',
    'eventapi.sooplive.com',
    'time.akamai.com',
    'google-analytics.com',
    'analytics.google.com',
    'googletagmanager.com',
    'googlesyndication.com',
    'doubleclick.net'
  ];

  const BLOCK_PATHS = [
    'res.sooplive.com/data/ad/',
    'static.sooplive.com/asset/service/da/'
  ];

  function isBlocked(urlStr) {
    if (!config.blockTrackers || !urlStr) return false;
    try {
      const u = new URL(urlStr, location.href);
      const host = u.hostname;
      for (const d of BLOCK_DOMAINS) {
        if (host === d || host.endsWith('.' + d)) return true;
      }
      const fullPath = host + u.pathname;
      for (const p of BLOCK_PATHS) {
        if (fullPath.includes(p)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // 1. 拦截 window.fetch
  const ORIG_FETCH = window.fetch;
  window.fetch = async function (input, init) {
    const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');

    // 屏蔽慢速/追踪请求
    if (isBlocked(urlStr)) {
      return new Response(JSON.stringify({ result: 1, blocked_by: 'KRStream' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 排除 Catch / 剪辑归档 / 时光机回看 (回看归档不在直播直连 CDN 上，切勿重写，避免导致跳回最新)
    if (
      urlStr.includes('make_m3u8_temp') ||
      urlStr.includes('vod-archive') ||
      urlStr.includes('/fvod/') ||
      urlStr.includes('live-catch') ||
      urlStr.includes('catch') ||
      urlStr.includes('clip') ||
      urlStr.includes('stbbs') ||
      urlStr.includes('tile.m3u8') ||
      urlStr.includes('/tm/')
    ) {
      return ORIG_FETCH.apply(this, arguments);
    }

    // 拦截直播 M3U8 请求
    if (urlStr.includes('.m3u8') && (urlStr.includes('sooplive.com') || urlStr.includes('sooplive.co.kr'))) {
      let finalUrl = urlStr;
      let targetDomain = config.targetCdn;

      // CDN 域名重写
      if (targetDomain) {
        try {
          const parsed = new URL(urlStr);
          if (parsed.hostname !== targetDomain) {
            finalUrl = urlStr.replace(/https?:\/\/[^\/]+/, `https://${targetDomain}`);
          }
        } catch (e) {}
      }

      // 请求 m3u8 并处理内容
      try {
        const resp = await ORIG_FETCH(finalUrl, init);
        if (!resp.ok) return resp;

        const text = await resp.text();
        const parsed = new URL(finalUrl);
        const dir = parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/') + 1);
        const base = `https://${targetDomain}${dir}`;

        // 将相对分片地址补全为目标 CDN 的绝对地址
        let lines = text.split('\n').map((line) => {
          const t = line.trim();
          if (!t || t.startsWith('#')) return line;
          if (/^https?:\/\//i.test(t)) {
            return t.replace(/https?:\/\/[^\/]+/, `https://${targetDomain}`);
          }
          return base + t.replace(/^\/+/, '');
        });

        // 强制最高画质 (剔除低码率流，防止 ABR 降画质)
        if (config.forceMaxQuality && text.includes('#EXT-X-STREAM-INF')) {
          let bestBandwidth = 0;
          let bestIndex = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
              const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
              const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
              if (bw > bestBandwidth) {
                bestBandwidth = bw;
                bestIndex = i;
              }
            }
          }
          if (bestIndex !== -1 && bestIndex + 1 < lines.length) {
            const streamInf = lines[bestIndex];
            const streamUri = lines[bestIndex + 1];
            // 重构为仅含最高画质的 master 列表
            lines = [
              '#EXTM3U',
              '#EXT-X-VERSION:3',
              streamInf,
              streamUri
            ];
          }
        }

        window.__KRSTREAM_LAST_M3U8__ = finalUrl;
        return new Response(lines.join('\n'), {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers
        });
      } catch (e) {
        return ORIG_FETCH.apply(this, arguments);
      }
    }

    return ORIG_FETCH.apply(this, arguments);
  };

  // 2. 拦截 XMLHttpRequest
  const ORIG_XHR_OPEN = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isBlocked(url)) {
      this.__isBlocked = true;
    }
    return ORIG_XHR_OPEN.apply(this, arguments);
  };

  const ORIG_XHR_SEND = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__isBlocked) {
      Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(this, 'status', { value: 200, configurable: true });
      Object.defineProperty(this, 'responseText', { value: '{"result":1}', configurable: true });
      if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
      if (typeof this.onload === 'function') this.onload();
      return;
    }
    return ORIG_XHR_SEND.apply(this, arguments);
  };

  // 3. 拦截 WebSocket 监听官方字幕包 (参考 GreasyFork 591429)
  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OrigWebSocket(...args);
    ws.addEventListener('message', function (event) {
      try {
        let data = event.data;
        if (data instanceof ArrayBuffer) {
          parseSoopWSSData(new TextDecoder('utf-8').decode(data));
        } else if (data instanceof Blob) {
          data.text().then(parseSoopWSSData);
        } else if (typeof data === 'string') {
          parseSoopWSSData(data);
        }
      } catch (e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  Object.assign(window.WebSocket, OrigWebSocket);

  function parseSoopWSSData(text) {
    if (!text) return;
    const S = '\x0c';
    if (!text.includes(S) && /^[A-Za-z0-9+/=]+$/.test(text) && text.length > 20) {
      try {
        const bin = atob(text);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        text = new TextDecoder('utf-8').decode(bytes);
      } catch (e) {}
    }
    if (text.includes(S)) {
      const parts = text.split(S);
      const broadcasterId = window.location.pathname.split('/')[1];
      if (!broadcasterId) return;

      const idIndex = parts.indexOf(broadcasterId);
      if (idIndex !== -1 && idIndex + 2 < parts.length) {
        const rawSub = parts[idIndex + 2];
        const langCode = parts[idIndex + 1];
        if (rawSub && typeof rawSub === 'string' && langCode && langCode.length < 5) {
          const cleanSub = rawSub.trim();
          if (cleanSub) {
            window.dispatchEvent(
              new CustomEvent('KRSTREAM_SOOP_PAGE_SUBTITLE', {
                detail: { text: cleanSub, lang: langCode, streamer: broadcasterId }
              })
            );
          }
        }
      }
    }
  }

  // 4. 监听来自 content script 的设置更新
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'KRSTREAM_UPDATE_SOOP_CONFIG') {
      Object.assign(config, event.data.payload);
      console.log('[KRStream] SOOP 配置已更新:', config);
    }
  });

  console.log('[KRStream] SOOP 增强核心已成功注入');
})();
