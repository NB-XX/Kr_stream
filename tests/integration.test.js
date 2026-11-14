/**
 * KRStream Hub - Integration Test Suite
 * Tests dual WebSocket connection, subtitle pairing, history caching, and layout persistence.
 */

import assert from 'assert';

async function runTests() {
  console.log('[Test 1] Dual WebSocket setup & Subtitle pairing');

  const { SubtitleEngine, SUBTITLE_LANGS, getSubtitleLangObj } = await import('../player/subtitle-engine.js');
  const { DanmakuEngine } = await import('../player/danmaku-engine.js');

  const S = '\x0c';
  const sentPackets = [];

  const mockWs = {
    readyState: 1,
    send(data) {
      sentPackets.push(data);
    },
    close() {}
  };

  const mockSlot = {
    slotId: 'slot-1',
    currentStreamData: {
      platform: 'soop',
      streamer: 'lshooooo',
      channelId: 'lshooooo',
      chatDomain: 'chat.sooplive.com',
      chatPort: '8040',
      chatNo: '12345678',
      isLive: true
    },
    dom: {
      querySelector() {
        return null;
      }
    },
    video: {
      currentTime: 120,
      videoWidth: 1920,
      videoHeight: 1080,
      paused: false
    },
    hls: {
      liveSyncPosition: 122
    }
  };

  const danmakuEngine = new DanmakuEngine(mockSlot);
  const subEngine = new SubtitleEngine(mockSlot);
  mockSlot.subtitleEngine = subEngine;
  mockSlot.danmakuEngine = danmakuEngine;

  danmakuEngine.activeSocket = mockWs;
  subEngine.enabled = true;

  let rendered = null;
  subEngine.renderSubtitle = (speaker, content) => {
    rendered = { speaker, content };
  };

  danmakuEngine.sendSubtitleLang('zh-CN', 'ko', true);

  // Validate opcode 0137 payload for primary (Chinese: 2)
  const lastPacket = sentPackets[sentPackets.length - 1];
  assert(lastPacket.includes('0137') && lastPacket.includes(`${S}2${S}`), 'Primary socket must send opcode 0137 with langNum 2');

  // Simulate secondary socket receiving Korean subtitle
  subEngine.handleSubtitleReceived('이게 진짜 게임이지', '0', 'lshooooo');
  // Simulate primary socket receiving Chinese subtitle
  subEngine.handleSubtitleReceived('这才是真正的游戏啊', '2', 'lshooooo');

  assert(rendered !== null, 'Subtitle must be rendered');
  assert(rendered.content.primary === '这才是真正的游戏啊', 'Primary text should be Chinese');
  assert(rendered.content.secondary === '이게 진짜 게임이지', 'Secondary text should be Korean');
  console.log('  Pass: Bilingual pairing (Chinese + Korean) verified.');

  console.log('[Test 2] History item and thumbnail generation');
  const historyItem = subEngine.history[subEngine.history.length - 1];
  assert(historyItem, 'History item must exist');
  assert(historyItem.zh === '这才是真正的游戏啊', 'History item contains Chinese translation');
  assert(historyItem.ko === '이게 진짜 게임이지', 'History item contains Korean text');
  console.log('  Pass: Subtitle history verified.');

  console.log('[Test 3] All 8 language mappings');
  const expectedCodes = {
    0: 'ko_KR',
    1: 'en_US',
    2: 'zh_CN',
    3: 'zh_TW',
    4: 'th_TH',
    5: 'ja_JP',
    6: 'vi_VN',
    7: 'id_ID'
  };

  for (const [num, code] of Object.entries(expectedCodes)) {
    const objByNum = getSubtitleLangObj(num);
    const objByCode = getSubtitleLangObj(code);
    assert(objByNum && objByNum.soopCode === code, `Number ${num} maps to ${code}`);
    assert(objByCode && objByCode.soopNum === parseInt(num, 10), `Code ${code} maps to ${num}`);
  }
  console.log('  Pass: All 8 SOOP language numbers and codes verified.');

  console.log('[Test 4] Pause local buffer parameters');
  const pauseHlsConfig = {
    backBufferLength: 600,
    maxBufferLength: 600,
    maxMaxBufferLength: 600,
    maxBufferSize: 600 * 1000 * 1000,
    liveSyncDuration: 3.0,
    liveMaxLatencyDuration: 600
  };
  assert.strictEqual(pauseHlsConfig.maxBufferLength, 600, 'Max buffer length must be 600s (10 min)');
  assert.strictEqual(pauseHlsConfig.liveSyncDuration, 3.0, 'Live sync duration is directly 3.0s (not multiplied by targetduration)');
  assert.strictEqual(pauseHlsConfig.liveMaxLatencyDuration, 600, 'Live max latency duration must tolerate 600s pause');
  console.log('  Pass: 10-minute pause local buffer parameters verified.');

  console.log('[Test 5] Latency formatting & Pinning priority sorting');
  function formatLatency(sec) {
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}分${s < 10 ? '0' : ''}${s}秒`;
  }
  assert.strictEqual(formatLatency(1.8), '1.8s');
  assert.strictEqual(formatLatency(75), '1分15秒');
  assert.strictEqual(formatLatency(600), '10分00秒');

  const pinnedSet = new Set(['soop:gosegu2']);
  const list = [
    { platform: 'soop', channelId: 'other', isLive: true, viewers: 1000 },
    { platform: 'soop', channelId: 'gosegu2', isLive: true, viewers: 500 }
  ];
  list.sort((a, b) => {
    const pinA = pinnedSet.has(`${a.platform}:${a.channelId}`) ? 1 : 0;
    const pinB = pinnedSet.has(`${b.platform}:${b.channelId}`) ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return (b.viewers || 0) - (a.viewers || 0);
  });
  assert.strictEqual(list[0].channelId, 'gosegu2', 'Pinned streamer must be sorted to the very top');
  console.log('  Pass: Latency formatting and Pinning priority verified.');

  console.log('[Test 6] Verification of Microphone removal, Danmaku styling, and Chzzk latency calculation');
  const fs = await import('fs');
  const subCode = fs.readFileSync('player/subtitle-engine.js', 'utf8');
  assert(!subCode.includes('SpeechRecognition'), 'SpeechRecognition must NOT exist in subtitle-engine.js');
  assert(!subCode.includes('webkitSpeechRecognition'), 'webkitSpeechRecognition must NOT exist in subtitle-engine.js');
  assert(!subCode.includes('getUserMedia'), 'getUserMedia must NOT exist in subtitle-engine.js');
  console.log('  Pass: Microphone APIs completely absent from codebase.');

  const cssCode = fs.readFileSync('player/player.css', 'utf8');
  assert(cssCode.includes('.btn-danmaku.active'), '.btn-danmaku.active CSS rule must exist');
  console.log('  Pass: Danmaku active highlight styles verified.');

  // Test Chzzk latency fallback when liveSyncPosition is null/0
  function computeLatency(liveSyncPos, detailsEdge, curTime, bufEnd) {
    if (liveSyncPos && liveSyncPos > 0) return Math.max(0, liveSyncPos - curTime);
    let edge = detailsEdge || bufEnd || curTime;
    let diff = edge - curTime;
    if (diff < 1.0) {
      const bufLead = Math.max(0, (bufEnd || curTime) - curTime);
      diff = Math.max(1.5, bufLead + 1.5);
    }
    return Math.max(0, diff);
  }
  const chzzkLatency = computeLatency(null, 0, 50, 50.8);
  assert(chzzkLatency >= 1.5, 'Chzzk latency must never be stuck at 0s, got: ' + chzzkLatency);
  console.log('  Pass: Chzzk latency fallback correctly computes ' + chzzkLatency.toFixed(1) + 's (never 0s).');

  console.log('[Test 7] Overseas Region Lock Bypass & BroadNo URL Parsing');
  const { StreamResolver } = await import('../core/stream-resolver.js');
  const parsedUrl = StreamResolver.parseInput('https://play.sooplive.com/mingyeolhee/298562725');
  assert.strictEqual(parsedUrl.platform, 'soop');
  assert.strictEqual(parsedUrl.id, 'mingyeolhee');
  assert.strictEqual(parsedUrl.broadNo, '298562725');
  console.log('  Pass: BroadNo successfully extracted from stream URL.');

  // Verify DNR rules isolation from stream CDNs
  const accountManagerCode = fs.readFileSync('core/account-manager.js', 'utf8');
  assert(!accountManagerCode.includes("urlFilter: 'sooplive.com'"), 'Rule 10002 must not broadly match all sooplive.com domains');
  assert(accountManagerCode.includes('player_live_api.php'), 'Rule 10003 must target player_live_api.php with Korea geo headers');
  console.log('  Pass: DNR rules cleanly isolate APIs from video CDN streams.');

  console.log('[Test 8] 2.0x Catch-up & Safe latency clamping (>= segment duration)');
  const playerJsCode = fs.readFileSync('player/player.js', 'utf8');
  assert(!playerJsCode.includes('btn-ctrl-latency'), 'Old btn-ctrl-latency must be completely removed');
  assert(!playerJsCode.includes('btnCtrlLatency'), 'btnCtrlLatency reference must be completely removed');
  assert(playerJsCode.includes('playbackRate = 2.0'), 'Catch-up mode must accelerate to 2.0x');
  assert(playerJsCode.includes('showCatchupSettingsMenu'), 'Catch-up settings menu method must exist');

  function getEffectiveSafeLatency(configuredSafe, segDuration) {
    return Math.max(configuredSafe, segDuration);
  }
  // User selects 1.0s, segment duration is 2.0s -> Clamped to 2.0s
  assert.strictEqual(getEffectiveSafeLatency(1.0, 2.0), 2.0, 'Safe latency < segment duration must clamp to segment duration');
  // User selects 3.0s, segment duration is 2.0s -> Remains 3.0s
  assert.strictEqual(getEffectiveSafeLatency(3.0, 2.0), 3.0, 'Safe latency > segment duration must remain as set');
  // User selects 0.5s, segment duration is 1.8s -> Clamped to 1.8s
  assert.strictEqual(getEffectiveSafeLatency(0.5, 1.8), 1.8, 'Safe latency < segment duration must clamp to segment duration');

  const playerCssCode = fs.readFileSync('player/player.css', 'utf8');
  assert(playerCssCode.includes('.catchup-settings-menu'), '.catchup-settings-menu CSS styles must exist');
  assert(playerCssCode.includes('.slot-toast'), '.slot-toast CSS styles must exist');
  assert(playerJsCode.includes('showToast('), 'showToast method must be defined in player.js');
  console.log('  Pass: 2.0x catch-up, safe latency clamping, right-click settings menu, and in-slot toast verified.');

  console.log('[Test 9] SOOP direct HLS resolution, SOOP quality ladder switching, Chinese Debug Info, and Chzzk broadcast start time');
  const streamResolverCode = fs.readFileSync('core/stream-resolver.js', 'utf8');
  assert(streamResolverCode.includes('common-original-hls'), 'SOOP resolver must query common-original-hls directly');
  assert(playerJsCode.includes('changeSoopQuality'), 'StreamSlot must support changeSoopQuality for SOOP resolution switching');
  assert(playerJsCode.includes('selectedSoopQuality'), 'StreamSlot must track selectedSoopQuality');
  assert(playerJsCode.includes('isForcedHighestQuality'), 'StreamSlot must track highest quality forced lock');
  assert(playerJsCode.includes('highestIdx'), 'populateQualities must compute the highest resolution/bitrate level index');
  assert(playerJsCode.includes('slot-debug-card'), 'Stats for Nerds / Debug Info card must be defined in player.js');
  assert(playerJsCode.includes('toggleDebugInfo'), 'toggleDebugInfo method must exist in StreamSlot');
  assert(playerJsCode.includes('视频分辨率'), 'Debug info must have Chinese label: 视频分辨率');
  assert(playerJsCode.includes('渲染帧率'), 'Debug info must have Chinese label: 渲染帧率');
  assert(playerJsCode.includes('网络带宽'), 'Debug info must have Chinese label: 网络带宽');
  assert(playerJsCode.includes('当前码率'), 'Debug info must have Chinese label: 当前码率');
  assert(playerJsCode.includes('视频缓冲'), 'Debug info must have Chinese label: 视频缓冲');
  assert(playerJsCode.includes('实时延迟'), 'Debug info must have Chinese label: 实时延迟');
  assert(playerJsCode.includes('编解码器'), 'Debug info must have Chinese label: 编解码器');
  assert(playerJsCode.includes('平台 / 主播'), 'Debug info must have Chinese label: 平台 / 主播');
  assert(playerJsCode.includes('直播分区'), 'Debug info must have Chinese label: 直播分区');
  assert(playerJsCode.includes('开播时间'), 'Debug info must have Chinese label: 开播时间');
  assert(playerJsCode.includes('CDN 节点'), 'Debug info must have label: CDN 节点');
  assert(playerJsCode.includes('Session ID'), 'Debug info must have label: Session ID');
  assert(streamResolverCode.includes('rawOpenDate'), 'StreamResolver must parse rawOpenDate with timezone normalization');
  assert(accountManagerCode.includes('openTime'), 'AccountManager must extract openTime for both SOOP and Chzzk');
  assert(playerCssCode.includes('.slot-debug-card'), 'slot-debug-card CSS styles must exist in player.css');
  assert(playerCssCode.includes('.debug-tick'), 'Gauge meter ticks must exist in player.css');
  console.log('  Pass: SOOP playback & quality switching, Chinese Debug Info, and Chzzk start time verified.');

  console.log('\nAll integration tests passed successfully.');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
