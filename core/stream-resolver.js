/**
 * KRStream Direct & Enhancer
 * Unified Stream Resolver for SOOP, Chzzk, and CI.ME
 */

import { AccountManager } from './account-manager.js';

export const PLATFORM_CDNS = {
  soop: [
    { key: 'global', name: 'Global 1 (大陆推荐)', host: 'live-global-cdn-v02.sooplive.com' },
    { key: 'global_kr', name: 'Global KR (亚太节点)', host: 'live-global-cdn-v02.sooplive.co.kr' },
    { key: 'kr_zone', name: '首尔本地 (KR Zone)', host: 'live-pcweb-kr-cdn-z02.sooplive.com' },
    { key: 'original', name: '原始分配节点', host: null }
  ],
  chzzk: [
    { key: 'default', name: '官方默认 (GCDN)', host: null },
    { key: 'akamai', name: 'Akamai 国际加速', host: 'livecloud.akamaized.net' },
    { key: 'pstatic', name: 'Naver 专属 (LiveCloud)', host: 'livecloud.pstatic.net' },
    { key: 'naver_edge', name: 'Naver Edge (gcdn)', host: 'gcdn.navercdn.com' }
  ],
  cime: [
    { key: 'default', name: '官方默认 (Amazon IVS)', host: null },
    { key: 'cloudfront', name: 'CloudFront 边缘加速', host: 'cloudfront' },
    { key: 'original', name: '原始分配源', host: null }
  ]
};

const CDN_MAPPING = {
  gs_cdn: 'gs_cdn_pc_web',
  lg_cdn: 'lg_cdn_pc_web'
};

export class StreamResolver {
  /**
   * 针对指定平台和流地址动态切换或重写 CDN
   */
  static applyCdn(streamUrl, platform, cdnKey) {
    if (!streamUrl || !cdnKey || cdnKey === 'default' || cdnKey === 'original' || cdnKey === 'none') {
      return streamUrl;
    }
    try {
      const u = new URL(streamUrl);
      if (platform === 'soop') {
        const item = PLATFORM_CDNS.soop.find((c) => c.key === cdnKey);
        if (item && item.host) {
          u.hostname = item.host;
        }
      } else if (platform === 'chzzk') {
        const item = PLATFORM_CDNS.chzzk.find((c) => c.key === cdnKey);
        if (item && item.host) {
          u.hostname = item.host;
        }
      } else if (platform === 'cime') {
        if (cdnKey === 'cloudfront' && u.hostname.includes('playback.live-video.net')) {
          u.hostname = u.hostname.replace('playback.live-video.net', 'j.cloudfront.hls.live-video.net');
        }
      }
      return u.toString();
    } catch (e) {
      return streamUrl;
    }
  }
  /**
   * 解析任意输入的 URL 或 ID，自动识别平台并获取直播源
   */
  static async resolve(input, options = {}) {
    const parsed = this.parseInput(input);
    if (!parsed) {
      throw new Error('无法识别输入内容，请输入正确的直播间链接或主播ID');
    }

    const mergedOptions = { ...options };
    if (parsed.broadNo && !mergedOptions.broadNo) {
      mergedOptions.broadNo = parsed.broadNo;
    }

    switch (parsed.platform) {
      case 'soop':
        return await this.resolveSoop(parsed.id, mergedOptions);
      case 'chzzk':
        return await this.resolveChzzk(parsed.id, mergedOptions);
      case 'cime':
        return await this.resolveCime(parsed.id, mergedOptions);
      default:
        throw new Error(`暂不支持该平台: ${parsed.platform}`);
    }
  }

  static parseInput(input) {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();

    // 1. SOOP 匹配 (支持 play.sooplive.com/id, play.sooplive.com/id/12345678, sooplive.co.kr/id 等格式)
    const soopMatch = str.match(/(?:play\.)?(?:sooplive\.(?:com|co\.kr)|afreecatv\.com)\/([a-zA-Z0-9_]+)(?:\/([0-9]+))?/i);
    if (soopMatch && soopMatch[1] && !['watch', 'vod', 'video'].includes(soopMatch[1].toLowerCase())) {
      return {
        platform: 'soop',
        id: soopMatch[1],
        broadNo: soopMatch[2] || undefined
      };
    }

    // 2. Chzzk 匹配
    const chzzkMatch = str.match(/chzzk\.naver\.com\/(?:live\/)?([a-f0-9]{32})/i);
    if (chzzkMatch) {
      return { platform: 'chzzk', id: chzzkMatch[1] };
    }

    // 3. CI.ME 匹配
    const cimeMatch = str.match(/ci\.me\/(?:@)?([a-zA-Z0-9_-]+)/i);
    if (cimeMatch) {
      return { platform: 'cime', id: cimeMatch[1] };
    }

    // 4. 智能推断
    if (/^[a-f0-9]{32}$/i.test(str)) {
      return { platform: 'chzzk', id: str };
    }
    if (str.startsWith('@')) {
      return { platform: 'cime', id: str.slice(1) };
    }
    if (/^[a-zA-Z0-9_-]{2,30}$/.test(str)) {
      return { platform: 'soop', id: str };
    }

    return null;
  }

  /**
   * ==========================================
   * 1. SOOP (AfreecaTV) 直播解析
   * ==========================================
   */
  static async resolveSoop(channelId, options = {}) {
    const cleanId = channelId.trim();

    // 先通过 Station API 快速确认开播状态与广播编号 (防超时)
    let bnoFromStation = options.broadNo || '';
    let titleFromStation = '';
    let streamerFromStation = cleanId;
    let btimeFromStation = 0;

    try {
      const stRes = await fetch(`https://chapi.sooplive.co.kr/api/${cleanId}/station`, {
        headers: {
          'Origin': 'https://ch.sooplive.co.kr',
          'Referer': `https://ch.sooplive.co.kr/${cleanId}`
        },
        credentials: 'omit'
      });
      if (stRes.ok) {
        const stData = await stRes.json();
        streamerFromStation = stData.station?.user_nick || cleanId;
        if (stData.broad?.broad_no) {
          bnoFromStation = String(stData.broad.broad_no);
          titleFromStation = stData.broad.broad_title || '';
        } else if (!stData.broad && !options.broadNo) {
          return {
            platform: 'soop',
            channelId: cleanId,
            streamer: streamerFromStation,
            title: '',
            isLive: false,
            message: '主播当前未开播'
          };
        }
      }
    } catch (e) {
      console.warn('[SOOP] 查询 Station API 降级:', e);
    }

    // 第一步: 查询 live API (附带韩国住宅/机房 IP 标头与 geo_cc: KR，破除海外 IP / 区域锁限制)
    const endpoints = [
      `https://live.sooplive.co.kr/afreeca/player_live_api.php?bjid=${encodeURIComponent(cleanId)}`,
      `https://live.sooplive.com/afreeca/player_live_api.php?bjid=${encodeURIComponent(cleanId)}`
    ];

    const geoCandidateIps = ['211.234.118.1', '121.134.0.1', '118.235.0.1'];
    let channel = null;
    let lastErr = null;

    for (const ep of endpoints) {
      for (const ip of geoCandidateIps) {
        try {
          const body1 = new URLSearchParams({
            bid: cleanId,
            bno: bnoFromStation,
            type: 'live',
            pwd: '',
            player_type: 'html5',
            stream_type: 'common',
            quality: 'HD',
            mode: 'landing',
            from_api: '0',
            is_revive: 'false',
            geo_cc: 'KR',
            geo_rc: '',
            acpt_lang: 'ko_KR',
            svc_lang: 'ko_KR'
          });

          const res1 = await fetch(ep, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Origin': 'https://play.sooplive.com',
              'Referer': `https://play.sooplive.com/${cleanId}`,
              'X-Forwarded-For': ip,
              'Client-IP': ip,
              'X-Real-IP': ip
            },
            body: body1.toString(),
            credentials: 'omit'
          });

          const data1 = await res1.json();
          if (data1?.CHANNEL) {
            if (data1.CHANNEL.RESULT === 1) {
              channel = data1.CHANNEL;
              break;
            } else if (data1.CHANNEL.RESULT === -2) {
              // 遭遇海外地区限制，使用韩国节点 IP 破限重试
              console.warn(`[SOOP] 频道 ${cleanId} 遭遇海外地区限制 (RESULT=-2)，切换至韩国节点 ${ip} 进行破限重试...`);
              continue;
            } else {
              channel = data1.CHANNEL;
              break;
            }
          }
        } catch (err) {
          lastErr = err;
        }
      }
      if (channel && channel.RESULT === 1) break;
    }

    if (!channel) {
      throw new Error('SOOP API 请求超时或受阻，请检查网络/节点连接: ' + (lastErr?.message || ''));
    }

    if (channel.RESULT !== 1) {
      if (channel.RESULT === -6) {
        throw new Error('该 SOOP 直播需要登录或有年龄/订阅限制，请在浏览器中登录 SOOP 账号后重试');
      }
      if (channel.RESULT === -2) {
        throw new Error('该 SOOP 直播间受主播海外区域锁严格限制，已尝试多路韩国节点调度');
      }
      return {
        platform: 'soop',
        channelId: cleanId,
        streamer: channel.BJNICK || streamerFromStation,
        title: channel.TITLE || titleFromStation,
        isLive: false,
        message: '主播当前未开播'
      };
    }

    const bno = channel.BNO || bnoFromStation;
    const bjNick = channel.BJNICK || streamerFromStation;
    const title = channel.TITLE || titleFromStation;
    const rmd = channel.RMD || 'https://livestream-manager.sooplive.com';
    const rawCdn = channel.CDN || 'gs_cdn';
    const cdnKey = CDN_MAPPING[rawCdn] || rawCdn;
    const btime = parseInt(channel.BTIME || '0', 10);

    // 第二步: 获取播放鉴权 AID Token (继承韩国地区破限身份)
    const aidEp = endpoints[0];
    const body2 = new URLSearchParams({
      bid: cleanId,
      bno: bno,
      type: 'aid',
      pwd: '',
      player_type: 'html5',
      stream_type: 'common',
      quality: 'original',
      mode: 'landing',
      from_api: '0',
      is_revive: 'false',
      geo_cc: 'KR'
    });

    const res2 = await fetch(aidEp, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://play.sooplive.com',
        'Referer': `https://play.sooplive.com/${cleanId}`,
        'X-Forwarded-For': '211.234.118.1',
        'Client-IP': '211.234.118.1',
        'X-Real-IP': '211.234.118.1'
      },
      body: body2.toString(),
      credentials: 'omit'
    });

    const data2 = await res2.json();
    const aid = data2?.CHANNEL?.AID;
    if (!aid) {
      throw new Error('未能获取 SOOP 播放凭证 AID');
    }

    // 第三步: 调度直播分流服务器，获取真实的 Original HLS 直播流
    const assignUrl = `${rmd}/broad_stream_assign.html?return_type=${encodeURIComponent(cdnKey)}&broad_key=${bno}-common-original-hls`;
    const res3 = await fetch(assignUrl, {
      headers: {
        'Origin': 'https://play.sooplive.com',
        'Referer': `https://play.sooplive.com/${cleanId}`,
        'X-Forwarded-For': '211.234.118.1',
        'Client-IP': '211.234.118.1',
        'X-Real-IP': '211.234.118.1'
      },
      credentials: 'omit'
    });
    const assignData = await res3.json();
    const viewUrl = assignData?.view_url;

    if (!viewUrl) {
      throw new Error('SOOP 未分配到有效直播流地址，可能正在转码或流未就绪');
    }

    // 第四步: CDN 优化与重写
    const rawStreamUrl = `${viewUrl}?aid=${aid}`;
    const prefCdn = options.cdnPreference || 'global';
    const finalStreamUrl = this.applyCdn(rawStreamUrl, 'soop', prefCdn);

    const openTime = btime > 0 ? (Date.now() - btime * 1000) : 0;
    const category = channel.CATE_NAME || channel.CATEGORY_NAME || channel.CATEGORY || 'Live';

    return {
      platform: 'soop',
      channelId: cleanId,
      streamer: bjNick,
      title: title,
      isLive: true,
      hasTimeMachine: true,
      bno: bno,
      btime: btime,
      openTime: openTime,
      openDate: openTime > 0 ? new Date(openTime).toISOString() : '',
      streamUrl: finalStreamUrl,
      originalStreamUrl: rawStreamUrl,
      selectedCdn: prefCdn,
      availableCdns: PLATFORM_CDNS.soop,
      chatDomain: channel.CHDOMAIN || '',
      chatPort: channel.CHPT ? parseInt(channel.CHPT, 10) : 8040,
      chatNo: channel.CHATNO || '',
      isSubtitle: !!channel.IS_SUBTITLE || !!channel.SUBTITLE_FLAG,
      thumbnail: `https://liveimg.sooplive.co.kr/m/${bno}`,
      category: category,
      qualities: ['original', 'hd', 'sd']
    };
  }

  /**
   * 获取 SOOP 实时回看 (Catch 归档伪时光机)
   */
  static async getSoopCatchReplay(bjId, broadNo) {
    if (typeof AccountManager !== 'undefined') {
      await AccountManager.setupAllDynamicRules().catch(() => {});
    }

    let cleanBroadNo = broadNo ? String(broadNo).trim() : '';
    const cleanBjId = (bjId || '').trim();

    // 如果未传入 broadNo，自动通过 Station 接口查询当前活跃的 broad_no
    if (!cleanBroadNo && cleanBjId) {
      try {
        const stRes = await fetch(`https://chapi.sooplive.co.kr/api/${cleanBjId}/station`, {
          headers: {
            'Origin': 'https://ch.sooplive.co.kr',
            'Referer': `https://ch.sooplive.co.kr/${cleanBjId}`,
            'Accept': 'application/json'
          },
          credentials: 'include'
        });
        if (stRes.ok) {
          const stData = await stRes.json();
          if (stData.broad?.broad_no) {
            cleanBroadNo = String(stData.broad.broad_no);
          }
        }
      } catch (_) {}
    }

    if (!cleanBroadNo) {
      throw new Error('未检测到正在直播的广播编号 (broad_no)，主播可能未开播');
    }

    const body = new URLSearchParams({
      broad_no: cleanBroadNo,
      bj_id: cleanBjId,
      nCheck: 'CHK',
      szMediaFile: '',
      idx: '-1',
      nTotalDuration: '0',
      file_order: '-1'
    });

    const endpoints = [
      'https://stbbs.sooplive.com/api/video/get_clip_video_info.php',
      'https://stbbs.sooplive.co.kr/api/video/get_clip_video_info.php'
    ];

    let lastError = null;

    for (const ep of endpoints) {
      try {
        const isKr = ep.includes('.co.kr');
        const origin = isKr ? 'https://stbbs.sooplive.co.kr' : 'https://stbbs.sooplive.com';
        const referer = `${origin}/vodclip/index.php/?bj_id=${cleanBjId}&broad_no=${cleanBroadNo}&type=catch&system=html5&second=0&midroll=0`;

        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': origin,
            'Referer': referer,
            'x-requested-with': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
          },
          body: body.toString(),
          credentials: 'include'
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.url) {
            return {
              success: true,
              replayUrl: data.url,
              tempUrl: data.url,
              manifestUrl: data.media_manifest_path ? (new URL(data.url).origin + data.media_manifest_path) : data.url,
              totalDuration: parseFloat(data.nTotalDuration || 0) || 0
            };
          } else if (data && data.result === 0) {
            lastError = new Error(data.msg || 'SOOP 实时回看需要登录，请确认已在网页端登录 SOOP');
          } else {
            lastError = new Error(data?.msg || 'SOOP 实时回放流尚未就绪或暂无 Catch 归档');
          }
        } else {
          lastError = new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(lastError?.message || '未能获取 SOOP 实时回放 (Catch 归档) 流地址');
  }

  /**
   * 获取 CHZZK 实时回看 (时光机 Time Machine)
   */
  static async getChzzkTimeMachine(channelId, options = {}) {
    const cleanId = channelId.trim();

    // 1. 检验 Naver 登录态并配置动态 DNR 鉴权规则
    let deviceId = '';
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const cookieStr = await AccountManager.getCookieString(['naver.com', 'chzzk.naver.com']);
      if (!cookieStr || (!cookieStr.includes('NID_AUT') && !cookieStr.includes('NID_SES'))) {
        throw new Error('Chzzk 时光机回看为 Naver 登录专享功能。检测到您尚未在浏览器中登录 Naver 账号，请先在网页端登录 chzzk.naver.com 后重试');
      }
      const matchUuid = cookieStr.match(/ba\.uuid=([^;]+)/);
      if (matchUuid) deviceId = matchUuid[1].trim();

      await AccountManager.setupChzzkTimeMachineDnrRule().catch(() => {});
    }

    const url = `https://api.chzzk.naver.com/service/v1.1/channels/${cleanId}/clip-time-machine-info`;

    const fetchHeaders = {
      'front-client-platform-type': 'PC',
      'front-client-product-type': 'web',
      'Origin': 'https://chzzk.naver.com',
      'Referer': 'https://chzzk.naver.com/',
      'Accept': 'application/json'
    };
    if (deviceId) {
      fetchHeaders['deviceid'] = deviceId;
    }

    const res = await fetch(url, {
      headers: fetchHeaders,
      credentials: 'include'
    });

    const data = await res.json();
    if (data?.code === 401) {
      throw new Error('Naver 登录态已过期 (HTTP 401)，请在浏览器中重新打开 chzzk.naver.com 登录');
    }

    if (data?.code !== 200 || !data?.content) {
      throw new Error(data?.message || '该主播当前未开启时光机或暂无可用回看流');
    }

    let tmPlayback = data.content.timeMachinePlayback;
    if (typeof tmPlayback === 'string') {
      try {
        tmPlayback = JSON.parse(tmPlayback);
      } catch (e) {
        console.warn('[Chzzk] 解析 timeMachinePlayback JSON 失败:', e);
      }
    }

    if (!tmPlayback) {
      throw new Error('未获取到有效时光机回看流数据 (timeMachinePlayback 为空)');
    }

    const mediaList = tmPlayback.media || [];
    // 优先采用标准 HLS，滑动回退窗口更完整
    const targetMedia = mediaList.find((m) => m.mediaId === 'HLS') ||
                        mediaList.find((m) => m.mediaId === 'LLHLS') ||
                        mediaList[0];

    let replayUrl = targetMedia?.path;
    if (!replayUrl) {
      throw new Error('未找到 Chzzk 时光机 HLS 播放流地址');
    }

    const prefCdn = options.cdnPreference || 'default';
    replayUrl = this.applyCdn(replayUrl, 'chzzk', prefCdn);

    const durationSec = data.content.timeMachineDurationMs ? (data.content.timeMachineDurationMs / 1000) : 600;

    return {
      success: true,
      replayUrl: replayUrl,
      totalDuration: durationSec,
      liveOpenDate: data.content.liveOpenDate || ''
    };
  }

  /**
   * 统一调度获取时光机 / 实时回看流 (SOOP / CHZZK)
   */
  static async getStreamReplay(platform, channelId, extra = {}) {
    if (platform === 'soop') {
      return await this.getSoopCatchReplay(channelId, extra.bno || extra.broadNo);
    } else if (platform === 'chzzk') {
      return await this.getChzzkTimeMachine(channelId, extra);
    } else {
      throw new Error(`平台 [${platform}] 暂不支持实时回看时光机功能`);
    }
  }

  /**
   * ==========================================
   * 2. CHZZK (Naver) 直播解析
   * ==========================================
   */
  static async resolveChzzk(channelId, options = {}) {
    const cleanId = channelId.trim();
    const detailUrl = `https://api.chzzk.naver.com/service/v2/channels/${cleanId}/live-detail`;

    const res = await fetch(detailUrl, {
      headers: {
        'front-client-platform-type': 'PC',
        'Origin': 'https://chzzk.naver.com',
        'Referer': 'https://chzzk.naver.com/',
        'Accept': 'application/json'
      },
      credentials: 'include'
    });

    const data = await res.json();
    const content = data?.content;

    if (!content) {
      throw new Error('未能获取 Chzzk 频道信息，请检查频道 ID 是否正确');
    }

    const streamer = content.channel?.channelName || cleanId;
    const avatar = content.channel?.channelImageUrl || '';
    const title = content.liveTitle || '';
    const viewers = content.concurrentUserCount || 0;
    const category = content.liveCategoryValue || 'Live';
    const isLive = content.status === 'OPEN';

    if (!isLive) {
      return {
        platform: 'chzzk',
        channelId: cleanId,
        streamer: streamer,
        title: title,
        isLive: false,
        viewers: 0,
        thumbnail: avatar,
        message: '主播当前未开播'
      };
    }

    let playbackObj = null;
    try {
      if (typeof content.livePlaybackJson === 'string') {
        playbackObj = JSON.parse(content.livePlaybackJson);
      } else {
        playbackObj = content.livePlaybackJson;
      }
    } catch (e) {
      console.warn('[Chzzk] 解析 livePlaybackJson 失败:', e);
    }

    const hasTimeMachine = Boolean(playbackObj?.live?.timeMachine || content.timeMachine);

    const mediaList = playbackObj?.media || [];
    // 直播优先采用 LLHLS (Low Latency HLS)，延迟在 1.5s~3s，避免标准 HLS (10s targetduration) 出现 20s 延迟
    const targetMedia = mediaList.find((m) => m.mediaId === 'LLHLS') ||
                        mediaList.find((m) => m.mediaId === 'HLS') ||
                        mediaList[0];

    const streamUrl = targetMedia?.path;
    if (!streamUrl) {
      throw new Error('Chzzk 直播流已开启，但未找到有效的 HLS 播放地址');
    }

    const prefCdn = options.cdnPreference || 'default';
    const finalStreamUrl = this.applyCdn(streamUrl, 'chzzk', prefCdn);

    const rawOpenDate = content.openDate || content.liveOpenDate || playbackObj?.live?.start || playbackObj?.live?.open || '';
    let openTime = 0;
    if (rawOpenDate) {
      if (typeof rawOpenDate === 'number') {
        openTime = rawOpenDate > 1e11 ? rawOpenDate : rawOpenDate * 1000;
      } else if (typeof rawOpenDate === 'string') {
        const isoStr = rawOpenDate.includes('T') ? rawOpenDate : rawOpenDate.replace(' ', 'T');
        const withTz = isoStr.includes('+') || isoStr.includes('Z') ? isoStr : `${isoStr}+09:00`;
        const t = new Date(withTz).getTime();
        openTime = (!isNaN(t) && t > 0) ? t : (Date.parse(rawOpenDate) || 0);
      }
    }

    return {
      platform: 'chzzk',
      channelId: cleanId,
      chatChannelId: content.chatChannelId || '',
      streamer: streamer,
      title: title,
      isLive: true,
      hasTimeMachine: hasTimeMachine,
      streamUrl: finalStreamUrl,
      originalStreamUrl: streamUrl,
      selectedCdn: prefCdn,
      availableCdns: PLATFORM_CDNS.chzzk,
      viewers: viewers,
      category: category,
      openTime: openTime,
      openDate: rawOpenDate || '',
      thumbnail: content.liveImageUrl ? content.liveImageUrl.replace('{type}', '720') : avatar
    };
  }

  /**
   * ==========================================
   * 3. CI.ME (씨미) 直播解析
   * ==========================================
   */
  static async resolveCime(slug, options = {}) {
    const cleanSlug = slug.replace(/^@/, '').trim();
    const liveApiUrl = `https://ci.me/api/app/channels/${cleanSlug}/live`;

    const res = await fetch(liveApiUrl, {
      headers: {
        'Origin': 'https://ci.me',
        'Referer': 'https://ci.me/',
        'Accept': 'application/json'
      },
      credentials: 'include'
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`CI.ME 频道不存在: ${cleanSlug}`);
      }
      throw new Error(`CI.ME API 请求异常: HTTP ${res.status}`);
    }

    const json = await res.json();
    const liveData = json?.data;

    if (!liveData || liveData.state !== 'ACTIVE') {
      const channelInfo = liveData?.channel;
      return {
        platform: 'cime',
        channelId: cleanSlug,
        streamer: channelInfo?.name || cleanSlug,
        title: liveData?.title || '',
        isLive: false,
        thumbnail: channelInfo?.imageUrl || '',
        message: '主播当前未开播'
      };
    }

    const streamUrl = liveData.playback?.url;
    if (!streamUrl) {
      throw new Error('CI.ME 未返回有效直播流地址 (Amazon IVS)');
    }

    const prefCdn = options.cdnPreference || 'default';
    const finalStreamUrl = this.applyCdn(streamUrl, 'cime', prefCdn);

    return {
      platform: 'cime',
      channelId: cleanSlug,
      streamer: liveData.channel?.name || cleanSlug,
      title: liveData.title || '',
      isLive: true,
      streamUrl: finalStreamUrl,
      originalStreamUrl: streamUrl,
      selectedCdn: prefCdn,
      availableCdns: PLATFORM_CDNS.cime,
      subtitlesSupported: true,
      viewers: liveData.curViewerCnt || 0,
      category: liveData.category?.name || 'Live',
      openTime: liveData.startedAt ? new Date(liveData.startedAt).getTime() : (liveData.createdAt ? new Date(liveData.createdAt).getTime() : 0),
      openDate: liveData.startedAt || liveData.createdAt || '',
      thumbnail: liveData.imageUrl || liveData.channel?.imageUrl || ''
    };
  }

  static async pingCdn(host, timeoutMs = 3500) {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      await fetch(`https://${host}/favicon.ico?_t=${Date.now()}`, {
        mode: 'no-cors',
        signal: controller.signal
      });
      clearTimeout(id);
      return Math.round(performance.now() - start);
    } catch (e) {
      return -1;
    }
  }
}
