/**
 * KRStream Direct & Enhancer
 * Account Manager & Followed Streamers Auto-Pull Module
 */

import { SOOP_CATEGORY_MAP } from './soop-categories.js';

export class AccountManager {
  /**
   * 从 Chrome Cookie 中读取指定域名的全部 Cookie 并组合为请求头字符串
   */
  static async getCookieString(domains) {
    if (typeof chrome === 'undefined' || !chrome.cookies) return '';
    const domainList = Array.isArray(domains) ? domains : [domains];
    const cookieMap = new Map();

    for (const d of domainList) {
      const cleanDomain = d.replace(/^\./, '');
      const queryList = [
        { domain: cleanDomain },
        { domain: '.' + cleanDomain },
        { url: `https://${cleanDomain}` },
        { url: `https://www.${cleanDomain}` },
        { url: `https://live.${cleanDomain}` },
        { url: `https://login.${cleanDomain}` },
        { url: `https://stbbs.${cleanDomain}` },
        { url: `https://nid.${cleanDomain}` },
        { url: `https://chzzk.${cleanDomain}` },
        { url: `https://myapi.${cleanDomain}` },
        { url: `https://play.${cleanDomain}` },
        { url: `https://ch.${cleanDomain}` },
        { url: `https://member.${cleanDomain}` }
      ];
      if (cleanDomain === 'ci.me') {
        queryList.push({ url: 'https://ci.me/api/app/user' });
      }

      for (const q of queryList) {
        try {
          const list = await chrome.cookies.getAll(q);
          if (Array.isArray(list)) {
            for (const c of list) {
              if (c && c.name && c.value !== undefined) {
                cookieMap.set(c.name, c.value);
              }
            }
          }
        } catch (_) {}
      }
    }

    const pairs = [];
    for (const [k, v] of cookieMap.entries()) {
      pairs.push(`${k}=${String(v).replace(/[\r\n]/g, '')}`);
    }
    return pairs.join('; ');
  }

  /**
   * 动态配置全部 Chrome DNR 规则
   * 严格限定 initiatorDomains: [chrome.runtime.id]，确保 100% 仅对插件自身发起的网络请求生效，
   * 绝不污染或干扰用户在普通浏览器标签页访问的任何官方网站（如 SOOP、Chzzk、Naver 等）。
   */
  static async setupAllDynamicRules() {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest || !chrome.runtime?.id) {
      return false;
    }

    try {
      const extensionId = chrome.runtime.id;
      const rulesToAdd = [];
      const ruleIdsToRemove = [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010, 10011, 10012, 10013, 10014];

      // 1. Chzzk API 动态凭证注入规则 (Rule 10001 & Rule 10014)
      const chzzkCookie = await this.getCookieString(['naver.com', 'chzzk.naver.com']);
      const chzzkHeaders = [
        { header: 'Origin', operation: 'set', value: 'https://chzzk.naver.com' },
        { header: 'Referer', operation: 'set', value: 'https://chzzk.naver.com/' },
        { header: 'front-client-platform-type', operation: 'set', value: 'PC' },
        { header: 'front-client-product-type', operation: 'set', value: 'web' }
      ];
      if (chzzkCookie) {
        chzzkHeaders.push({ header: 'Cookie', operation: 'set', value: chzzkCookie });
        const matchUuid = chzzkCookie.match(/ba\.uuid=([^;]+)/);
        if (matchUuid) chzzkHeaders.push({ header: 'deviceid', operation: 'set', value: matchUuid[1].trim() });
      }
      rulesToAdd.push({
        id: 10001,
        priority: 25,
        action: {
          type: 'modifyHeaders',
          requestHeaders: chzzkHeaders
        },
        condition: {
          urlFilter: '||api.chzzk.naver.com',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // Rule 10014: Chzzk / Naver 用户状态与昵称接口规则
      rulesToAdd.push({
        id: 10014,
        priority: 25,
        action: {
          type: 'modifyHeaders',
          requestHeaders: chzzkHeaders
        },
        condition: {
          urlFilter: '||comm-api.game.naver.com',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 2. SOOP Web API & 关注列表凭证注入规则 (Rule 10002 - 严格限定 API 路径，绝不污染 HLS 直播切片流)
      const soopCookie = await this.getCookieString(['sooplive.com', 'sooplive.co.kr', 'afreecatv.com']);
      const soopComHeaders = [
        { header: 'Origin', operation: 'set', value: 'https://www.sooplive.com' },
        { header: 'Referer', operation: 'set', value: 'https://www.sooplive.com/' },
        { header: 'Accept', operation: 'set', value: 'application/json, text/plain, */*' }
      ];
      if (soopCookie) {
        soopComHeaders.push({ header: 'Cookie', operation: 'set', value: soopCookie });
      }
      rulesToAdd.push({
        id: 10002,
        priority: 25,
        action: {
          type: 'modifyHeaders',
          requestHeaders: soopComHeaders
        },
        condition: {
          regexFilter: '^https://(?:api|myapi|chapi|live|login)[.]sooplive[.](?:com|co[.]kr)/(?:api/|station|favorite|preferbj)',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 3. SOOP 直播解析与播放鉴权专有规则 (Rule 10003 & 10011: 注入官方 Origin/Referer 与登录 Cookie)
      // 严禁在此注入韩国住宅 IP 标头 (X-Forwarded-For 等)，否则 SOOP 会判定为韩国本土非 P2P 用户并强制锁死 540P 画质。
      // 全球海外请求直连 GCP CDN 即可完整获取 1080p/1440p 全清晰度阶梯。
      const soopLiveHeaders = [
        { header: 'Origin', operation: 'set', value: 'https://play.sooplive.com' },
        { header: 'Referer', operation: 'set', value: 'https://play.sooplive.com/' }
      ];
      if (soopCookie) {
        soopLiveHeaders.push({ header: 'Cookie', operation: 'set', value: soopCookie });
      }

      rulesToAdd.push({
        id: 10003,
        priority: 28,
        action: {
          type: 'modifyHeaders',
          requestHeaders: soopLiveHeaders
        },
        condition: {
          urlFilter: 'player_live_api.php',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      rulesToAdd.push({
        id: 10011,
        priority: 28,
        action: {
          type: 'modifyHeaders',
          requestHeaders: soopLiveHeaders
        },
        condition: {
          urlFilter: 'broad_stream_assign.html',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // Rule 10013: 移动端/CC 鉴权端点专有规则
      rulesToAdd.push({
        id: 10013,
        priority: 30,
        action: {
          type: 'modifyHeaders',
          requestHeaders: soopLiveHeaders
        },
        condition: {
          urlFilter: '/broad/a/watch',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 4. AfreecaTV API 备用凭证注入规则 (Rule 10004)
      if (soopCookie) {
        rulesToAdd.push({
          id: 10004,
          priority: 25,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Cookie', operation: 'set', value: soopCookie },
              { header: 'Origin', operation: 'set', value: 'https://play.sooplive.com' },
              { header: 'Referer', operation: 'set', value: 'https://play.sooplive.com/' }
            ]
          },
          condition: {
            urlFilter: 'afreecatv.com',
            initiatorDomains: [extensionId],
            resourceTypes: ['xmlhttprequest', 'other']
          }
        });
      }

      // 5. SOOP Chat Websocket 来源规范规则 (Rule 10005)
      rulesToAdd.push({
        id: 10005,
        priority: 25,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: 'https://play.sooplive.com' },
            { header: 'Referer', operation: 'set', value: 'https://play.sooplive.com/' }
          ]
        },
        condition: {
          urlFilter: 'Websocket',
          initiatorDomains: [extensionId],
          resourceTypes: ['websocket', 'xmlhttprequest', 'other']
        }
      });

      // 6. CI.ME API 规范与凭证注入规则 (Rule 10006)
      const cimeCookie = await this.getCookieString(['ci.me', '.ci.me', 'www.ci.me']);
      const cimeHeaders = [
        { header: 'Origin', operation: 'set', value: 'https://ci.me' },
        { header: 'Referer', operation: 'set', value: 'https://ci.me/' },
        { header: 'Accept', operation: 'set', value: 'application/json, text/plain, */*' }
      ];
      if (cimeCookie) {
        cimeHeaders.push({ header: 'Cookie', operation: 'set', value: cimeCookie });
      }
      rulesToAdd.push({
        id: 10006,
        priority: 25,
        action: {
          type: 'modifyHeaders',
          requestHeaders: cimeHeaders
        },
        condition: {
          urlFilter: 'ci.me/api/',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 7. SOOP 翻译接口规则 (Rule 10007)
      rulesToAdd.push({
        id: 10007,
        priority: 25,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: 'https://play.sooplive.com' },
            { header: 'Referer', operation: 'set', value: 'https://play.sooplive.com/' }
          ]
        },
        condition: {
          urlFilter: '||translate-api.sooplive.com',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 8. SOOP .com 实时回看 (Catch 归档) 专有规则 (Rule 10008, 优先级更高以覆盖普通 .com 规则)
      const stbbsHeaders = [
        { header: 'Origin', operation: 'set', value: 'https://stbbs.sooplive.com' },
        { header: 'Referer', operation: 'set', value: 'https://stbbs.sooplive.com/vodclip/' },
        { header: 'x-requested-with', operation: 'set', value: 'XMLHttpRequest' },
        { header: 'Accept', operation: 'set', value: 'application/json, text/javascript, */*; q=0.01' }
      ];
      if (soopCookie) {
        stbbsHeaders.push({ header: 'Cookie', operation: 'set', value: soopCookie });
      }
      rulesToAdd.push({
        id: 10008,
        priority: 28,
        action: {
          type: 'modifyHeaders',
          requestHeaders: stbbsHeaders
        },
        condition: {
          urlFilter: 'stbbs.sooplive.com',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 9. SOOP .co.kr 实时回看 (Catch 归档) 专有规则 (Rule 10009)
      const stbbsKrHeaders = [
        { header: 'Origin', operation: 'set', value: 'https://stbbs.sooplive.co.kr' },
        { header: 'Referer', operation: 'set', value: 'https://stbbs.sooplive.co.kr/vodclip/' },
        { header: 'x-requested-with', operation: 'set', value: 'XMLHttpRequest' },
        { header: 'Accept', operation: 'set', value: 'application/json, text/javascript, */*; q=0.01' }
      ];
      if (soopCookie) {
        stbbsKrHeaders.push({ header: 'Cookie', operation: 'set', value: soopCookie });
      }
      rulesToAdd.push({
        id: 10009,
        priority: 28,
        action: {
          type: 'modifyHeaders',
          requestHeaders: stbbsKrHeaders
        },
        condition: {
          urlFilter: 'stbbs.sooplive.co.kr',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'other']
        }
      });

      // 10. KRStream 独立播放工作台跨域流媒体响应头放行 (Rule 10010)
      rulesToAdd.push({
        id: 10010,
        priority: 30,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'access-control-allow-origin', operation: 'set', value: '*' },
            { header: 'access-control-allow-methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
            { header: 'access-control-allow-headers', operation: 'set', value: '*' }
          ]
        },
        condition: {
          urlFilter: '*',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'media', 'other']
        }
      });

      // 11. SOOP 全域 CDN 跨域请求头注入 (Rule 10012: 避免 CDN 节点对 extension origin 403 Forbidden)
      // 注意: 低优先级 (28)，高优先级规则 (10003/10011/10013) 会覆盖此规则对特定端点的匹配
      rulesToAdd.push({
        id: 10012,
        priority: 24,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: 'https://play.sooplive.com' },
            { header: 'Referer', operation: 'set', value: 'https://play.sooplive.com/' }
          ]
        },
        condition: {
          regexFilter: '^https://.*[.](?:sooplive[.]com|sooplive[.]co[.]kr|afreecatv[.]com)/',
          initiatorDomains: [extensionId],
          resourceTypes: ['xmlhttprequest', 'media', 'other']
        }
      });

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIdsToRemove,
        addRules: rulesToAdd
      });

      return true;
    } catch (e) {
      console.warn('[KRStream] setupAllDynamicRules 失败:', e);
      return false;
    }
  }

  /**
   * 兼容旧接口
   */
  static async setupChzzkTimeMachineDnrRule() {
    return await this.setupAllDynamicRules();
  }

  static async setupSoopDnrRule() {
    return await this.setupAllDynamicRules();
  }

  /**
   * 检测三大平台的账号登录状态
   */
  static async getAccountsStatus() {
    // 预先更新三大平台动态 Cookie 请求头规则
    await this.setupAllDynamicRules().catch(() => {});

    const status = {
      soop: { platform: 'soop', isLoggedIn: false, username: '' },
      chzzk: { platform: 'chzzk', isLoggedIn: false, username: '' },
      cime: { platform: 'cime', isLoggedIn: false, username: '' }
    };

    // 1. SOOP 账号检测 (UserTicket / AuthTicket / PdboxTicket / BbsTicket / login_cookie / PdboxBNO)
    try {
      const soopCookieStr = await this.getCookieString(['sooplive.com', 'sooplive.co.kr', 'afreecatv.com']);
      if (soopCookieStr) {
        const isAuth = /UserTicket=|AuthTicket=|PdboxTicket=|BbsTicket=|login_cookie=|PdboxBNO=/.test(soopCookieStr);
        if (isAuth) {
          let username = 'SOOP已登录';
          let userId = '';

          // 优先从 UserTicket 解码
          const utMatch = soopCookieStr.match(/UserTicket=([^;]+)/);
          if (utMatch && utMatch[1]) {
            try {
              const decoded = decodeURIComponent(utMatch[1]);
              const unickMatch = decoded.match(/unick=([^&]+)/);
              const uidMatch = decoded.match(/uid=([^&]+)/);
              if (unickMatch) username = decodeURIComponent(unickMatch[1]);
              if (uidMatch) userId = uidMatch[1];
            } catch (_) {}
          }

          // 备用：从 PdboxUserNick / PdboxUserId 解码
          if (username === 'SOOP已登录') {
            const nickMatch = soopCookieStr.match(/PdboxUserNick=([^;]+)/);
            const idMatch = soopCookieStr.match(/PdboxUserId=([^;]+)/);
            if (nickMatch) {
              try { username = decodeURIComponent(nickMatch[1]); } catch (_) { username = nickMatch[1]; }
            } else if (idMatch) {
              username = idMatch[1];
            }
            if (idMatch) userId = idMatch[1];
          }

          // 备用：从 BbsTicket 提取
          if (username === 'SOOP已登录') {
            const bbsMatch = soopCookieStr.match(/BbsTicket=([^;]+)/);
            if (bbsMatch && bbsMatch[1]) {
              username = bbsMatch[1].trim();
            }
          }

          status.soop = {
            platform: 'soop',
            isLoggedIn: true,
            username: username,
            userId: userId
          };
        }
      }
    } catch (e) {}

    // 2. Chzzk (Naver) 账号检测 (NID_AUT, NID_SES)
    try {
      const chzzkCookieStr = await this.getCookieString(['naver.com', 'chzzk.naver.com']);
      if (chzzkCookieStr && (chzzkCookieStr.includes('NID_AUT') || chzzkCookieStr.includes('NID_SES'))) {
        status.chzzk = {
          platform: 'chzzk',
          isLoggedIn: true,
          username: 'Naver已登录'
        };
        // 通过 Naver 通行证状态接口拉取昵称
        try {
          const meRes = await fetch('https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus', {
            headers: {
              'Accept': 'application/json'
            },
            credentials: 'include'
          });
          if (meRes.ok) {
            const meJson = await meRes.json();
            if (meJson?.code === 200 && meJson?.content?.loggedIn === false) {
              status.chzzk = { platform: 'chzzk', isLoggedIn: false, username: '' };
            } else if (meJson?.content?.nickname) {
              status.chzzk.username = meJson.content.nickname;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // 3. CI.ME 账号检测 (校验登录接口并读取真实用户名)
    try {
      const cimeHeaders = {
        'Accept': 'application/json',
        'Origin': 'https://ci.me',
        'Referer': 'https://ci.me/'
      };
      const userRes = await fetch('https://ci.me/api/app/user', {
        headers: cimeHeaders,
        credentials: 'include'
      });
      if (userRes.ok) {
        const userJson = await userRes.json().catch(() => null);
        const u = userJson?.data;
        if (u) {
          const username = u.channel?.name || u.nickname || u.name || u.channel?.slug || '';
          status.cime = {
            platform: 'cime',
            isLoggedIn: true,
            username: username || 'CI.ME已登录'
          };
        }
      } else if (userRes.status !== 401 && userRes.status !== 403) {
        // 非未登录状态码时尝试备用频道接口
        const chRes = await fetch('https://ci.me/api/app/user/my-channel', {
          headers: cimeHeaders,
          credentials: 'include'
        });
        if (chRes.ok) {
          const chJson = await chRes.json().catch(() => null);
          const ch = chJson?.data;
          if (ch) {
            status.cime = {
              platform: 'cime',
              isLoggedIn: true,
              username: ch.name || ch.slug || 'CI.ME已登录'
            };
          }
        }
      }
    } catch (e) {}

    return status;
  }

  /**
   * 拉取 SOOP 关注主播列表
   * 优先使用网页端主流 preferbjOnLnbController 接口，兼容传统 favorite 接口
   */
  static async fetchSoopFollowings() {
    await this.setupAllDynamicRules().catch(() => {});

    // 依次尝试 preferbjOnLnbController 接口与传统 favorite 接口
    const candidateEndpoints = [
      'https://live.sooplive.com/api/myplus/preferbjOnLnbController.php?isForce=n&szType=all',
      'https://live.sooplive.co.kr/api/myplus/preferbjOnLnbController.php?isForce=n&szType=all',
      'https://myapi.sooplive.com/api/favorite',
      'https://myapi.sooplive.co.kr/api/favorite',
      'https://myapi.afreecatv.com/api/favorite'
    ];

    let lastError = null;
    let list = null;

    for (const apiUrl of candidateEndpoints) {
      try {
        const origin = apiUrl.includes('.co.kr')
          ? 'https://www.sooplive.co.kr'
          : (apiUrl.includes('afreecatv') ? 'https://www.afreecatv.com' : 'https://www.sooplive.com');

        const res = await fetch(apiUrl, {
          headers: {
            'Origin': origin,
            'Referer': origin + '/',
            'Accept': 'application/json, text/plain, */*'
          },
          credentials: 'include'
        });

        if (res.ok) {
          const json = await res.json();
          // 适配 preferbjOnLnbController.php 接口
          if (json && json.RESULT === 1 && json.DATA && Array.isArray(json.DATA.streamer_list)) {
            list = json.DATA.streamer_list;
            break;
          }
          // 适配传统 favorite 接口
          if (json && (Array.isArray(json.data) || Array.isArray(json.list) || Array.isArray(json))) {
            list = json.data || json.list || json;
            break;
          } else if (json && json.code === 0 && Array.isArray(json.data)) {
            list = json.data;
            break;
          }
        } else {
          lastError = new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!list) {
      throw new Error(`SOOP 关注列表获取失败 (${lastError?.message || '未授权'})，请确认已在网页端登录 SOOP (sooplive.com)`);
    }

    return list.map((item) => {
      // 兼容 preferbj 接口 (broad_no: '0' 为未开播) 与传统 favorite 接口
      const broadNo = (item.broad_no && item.broad_no !== '0')
        ? String(item.broad_no)
        : (item.broad_info?.broad_no ? String(item.broad_info.broad_no) : '');
      const isLive = Boolean(broadNo || item.is_live);

      let streamer = item.user_nick || item.user_id;
      try { streamer = decodeURIComponent(streamer); } catch (_) {}

      const cleanUserId = (item.user_id || '').trim();

      // 主播真实个人头像 (Avatar)
      let avatar = item.profile_image || item.user_profile || item.emblem_img_url || '';
      if (!avatar && cleanUserId && cleanUserId.length >= 2) {
        avatar = `https://profile.img.sooplive.com/LOGO/${cleanUserId.slice(0, 2).toLowerCase()}/${cleanUserId}/${cleanUserId}.jpg`;
      }

      // 直播画面预览截图 (Snapshot)
      let liveThumb = item.broad_thumb || '';
      if (liveThumb.startsWith('//')) {
        liveThumb = 'https:' + liveThumb;
      } else if (!liveThumb && broadNo) {
        liveThumb = `https://liveimg.sooplive.com/m/${broadNo}`;
      }

      // 观看人数
      let viewers = 0;
      if (item.view_cnt !== undefined && item.view_cnt !== '') {
        viewers = parseInt(String(item.view_cnt).replace(/,/g, ''), 10) || 0;
      } else if (item.broad_info?.total_view_cnt) {
        viewers = item.broad_info.total_view_cnt;
      }

      // 直播标题 (优先中文翻译/原文)
      const title = item.broad_title_translate || item.broad_title || item.station_name || item.broad_info?.broad_title || '';

      const rawBroadStart = item.broad_start || item.broad_info?.broad_start || '';
      let openTime = 0;
      if (rawBroadStart) {
        const iso = rawBroadStart.includes('T') ? rawBroadStart : rawBroadStart.replace(' ', 'T');
        const withTz = iso.includes('+') || iso.includes('Z') ? iso : `${iso}+09:00`;
        const t = new Date(withTz).getTime();
        openTime = (!isNaN(t) && t > 0) ? t : 0;
      }

      const rawCate = String(item.cate_no || item.broad_info?.cate_no || item.cate || '').trim();
      let category = item.cate_name || '';
      if (rawCate && (!category || category === 'Live')) {
        category = SOOP_CATEGORY_MAP[rawCate] || category;
      }

      return {
        platform: 'soop',
        channelId: cleanUserId,
        streamer: streamer,
        isLive: isLive,
        broadNo: broadNo,
        title: title,
        viewers: viewers,
        openTime: openTime,
        openDate: rawBroadStart,
        thumbnail: avatar, // 卡片头像统一展示主播个人头像，避免显示16:9的直播截图
        avatar: avatar,
        liveThumb: liveThumb,
        category: category,
        cateNo: rawCate,
        updatedAt: Date.now()
      };
    });
  }

  /**
   * 拉取 Chzzk 关注主播列表
   */
  static async fetchChzzkFollowings() {
    await this.setupAllDynamicRules().catch(() => {});

    const apiUrl = 'https://api.chzzk.naver.com/service/v1/channels/followings?size=100&sortType=FOLLOW';

    const res = await fetch(apiUrl, {
      headers: {
        'Origin': 'https://chzzk.naver.com',
        'Referer': 'https://chzzk.naver.com/',
        'front-client-platform-type': 'PC',
        'Accept': 'application/json'
      },
      credentials: 'include'
    });

    if (!res.ok) {
      throw new Error(`Chzzk 关注列表获取失败 (HTTP ${res.status})，请确认已在网页端登录 Naver 账号`);
    }

    const json = await res.json();
    const flist = json?.content?.followingList || [];

    return flist.map((item) => {
      const ch = item.channel || {};
      const liveInfo = item.liveInfo || {};
      const isOpen = Boolean(item.streamer?.openLive || ch.openLive);
      const avatar = ch.channelImageUrl || '';
      const liveThumb = liveInfo.liveImageUrl ? liveInfo.liveImageUrl.replace('{type}', '720') : '';
      const rawOpen = liveInfo.openDate || liveInfo.liveOpenDate || '';
      let openTime = 0;
      if (rawOpen) {
        const isoStr = rawOpen.includes('T') ? rawOpen : rawOpen.replace(' ', 'T');
        const withTz = isoStr.includes('+') || isoStr.includes('Z') ? isoStr : `${isoStr}+09:00`;
        const t = new Date(withTz).getTime();
        openTime = (!isNaN(t) && t > 0) ? t : 0;
      }

      return {
        platform: 'chzzk',
        channelId: ch.channelId || item.channelId,
        chatChannelId: liveInfo.chatChannelId || '',
        streamer: ch.channelName || 'Chzzk 主播',
        isLive: isOpen,
        hasTimeMachine: Boolean(liveInfo.timeMachine),
        title: liveInfo.liveTitle || '',
        viewers: liveInfo.concurrentUserCount || 0,
        openDate: rawOpen,
        openTime: openTime,
        thumbnail: avatar, // 卡片头像统一展示主播头像，避免在圆角小头像内显示16:9直播截图
        avatar: avatar,
        liveThumb: liveThumb,
        updatedAt: Date.now()
      };
    });
  }

  /**
   * 标准化解析 CI.ME 关注项 / 正在开播项
   */
  static parseCimeChannelItem(ch) {
    if (!ch || typeof ch !== 'object') return null;
    const channelObj = ch.channel || ch;
    const liveObj = ch.live || channelObj.live || (ch.state === 'ACTIVE' ? ch : null);
    const isLive = Boolean(
      channelObj.isLive === true ||
      ch.isLive === true ||
      liveObj?.state === 'ACTIVE' ||
      (liveObj && liveObj.id)
    );
    const slug = String(channelObj.slug || ch.slug || channelObj.id || ch.id || '').trim();
    if (!slug) return null;

    const avatar = channelObj.imageUrl || ch.imageUrl || channelObj.avatarUrl || '';
    const liveThumb = liveObj?.imageUrl || liveObj?.thumbnailUrl || liveObj?.coverUrl || avatar;
    const rawOpen = liveObj?.openedAt || liveObj?.startedAt || liveObj?.createdAt || '';
    let openTime = 0;
    if (rawOpen) {
      const t = new Date(rawOpen).getTime();
      if (!isNaN(t) && t > 0) openTime = t;
    }

    return {
      platform: 'cime',
      channelId: slug,
      streamer: channelObj.name || ch.name || slug,
      isLive: isLive,
      title: liveObj?.title || channelObj.description || '',
      category: liveObj?.category?.name || '',
      viewers: liveObj?.curViewerCnt || liveObj?.viewers || 0,
      openTime: openTime,
      openDate: rawOpen,
      thumbnail: avatar,
      avatar: avatar,
      liveThumb: liveThumb,
      updatedAt: Date.now()
    };
  }

  /**
   * 拉取 CI.ME 关注频道列表 (仅拉取已登录关注，绝不混入推荐/热门主播)
   */
  static async fetchCimeFollowings() {
    await this.setupAllDynamicRules().catch(() => {});

    const headers = {
      'Accept': 'application/json',
      'Origin': 'https://ci.me',
      'Referer': 'https://ci.me/'
    };
    const channelMap = new Map();

    const mergeItem = (raw) => {
      const parsed = this.parseCimeChannelItem(raw);
      if (!parsed) return;
      const key = parsed.channelId.toLowerCase();
      const existing = channelMap.get(key);
      if (!existing) {
        channelMap.set(key, parsed);
      } else if (parsed.isLive && (!existing.isLive || !existing.title || parsed.viewers > existing.viewers)) {
        channelMap.set(key, {
          ...existing,
          ...parsed,
          avatar: parsed.avatar || existing.avatar,
          thumbnail: parsed.thumbnail || existing.thumbnail,
          liveThumb: parsed.liveThumb || existing.liveThumb
        });
      }
    };

    // 1. 主接口分页拉取已关注频道 (/api/app/channels/following 返回 data.followings)
    for (let page = 1; page <= 5; page++) {
      try {
        const res = await fetch(`https://ci.me/api/app/channels/following?limit=32&order=LIVE&page=${page}`, {
          headers,
          credentials: 'include'
        });
        if (!res.ok) break;
        const json = await res.json();
        const items = Array.isArray(json)
          ? json
          : (json.data?.followings || json.data?.following || json.data?.channels || json.data?.items || json.data?.list || (Array.isArray(json.data) ? json.data : []));
        if (!Array.isArray(items) || items.length === 0) break;
        for (const item of items) mergeItem(item);

        const pag = json.data?.pagination;
        const hasNext = pag
          ? Boolean(pag.hasNext ?? pag.hasMore ?? (pag.totalPages ? page < pag.totalPages : items.length >= 32))
          : items.length >= 32;
        if (!hasNext) break;
      } catch (e) {
        break;
      }
    }

    // 2. 补充/兜底拉取侧边栏接口中的 data.following (严格忽略 popular / recent，绝不混入未关注主播)
    try {
      const recRes = await fetch('https://ci.me/api/app/channels/recommended?categoryLimit=5', {
        headers,
        credentials: 'include'
      });
      if (recRes.ok) {
        const recJson = await recRes.json();
        const recFollows = recJson?.data?.following;
        if (Array.isArray(recFollows)) {
          for (const item of recFollows) mergeItem(item);
        }
      }
    } catch (e) {}

    // 3. 若仍未发现正在直播的关注主播或列表为空，尝试 following-lives 接口
    const hasAnyLive = Array.from(channelMap.values()).some((item) => item.isLive);
    if (channelMap.size === 0 || !hasAnyLive) {
      try {
        const livesRes = await fetch('https://ci.me/api/app/channels/following-lives?limit=32', {
          headers,
          credentials: 'include'
        });
        if (livesRes.ok) {
          const livesJson = await livesRes.json();
          const liveItems = Array.isArray(livesJson)
            ? livesJson
            : (livesJson.data?.lives || livesJson.data?.followings || livesJson.data?.items || livesJson.data?.channels || (Array.isArray(livesJson.data) ? livesJson.data : []));
          if (Array.isArray(liveItems)) {
            for (const item of liveItems) mergeItem(item);
          }
        }
      } catch (e) {}
    }

    return Array.from(channelMap.values());
  }

  /**
   * 一键同步所有三个平台的关注主播
   */
  static async syncAllFollowings() {
    await this.setupAllDynamicRules().catch(() => {});

    const results = {
      soop: [],
      chzzk: [],
      cime: [],
      errors: {}
    };

    // 并发执行三大平台拉取
    const [soopRes, chzzkRes, cimeRes] = await Promise.allSettled([
      this.fetchSoopFollowings(),
      this.fetchChzzkFollowings(),
      this.fetchCimeFollowings()
    ]);

    if (soopRes.status === 'fulfilled') {
      results.soop = soopRes.value;
    } else {
      results.errors.soop = soopRes.reason?.message;
      console.warn('[KRStream] SOOP 关注同步异常:', soopRes.reason?.message);
    }

    if (chzzkRes.status === 'fulfilled') {
      results.chzzk = chzzkRes.value;
    } else {
      results.errors.chzzk = chzzkRes.reason?.message;
      console.warn('[KRStream] Chzzk 关注同步异常:', chzzkRes.reason?.message);
    }

    if (cimeRes.status === 'fulfilled') {
      results.cime = cimeRes.value;
    } else {
      results.errors.cime = cimeRes.reason?.message;
      console.warn('[KRStream] CI.ME 关注同步异常:', cimeRes.reason?.message);
    }

    const all = [...results.soop, ...results.chzzk, ...results.cime];
    return { all, details: results };
  }
}
