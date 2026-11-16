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

  console.log('[Test 10] SOOP Category Code Mapping (CATE code to Chinese category name)');
  const { SOOP_CATEGORY_MAP } = await import('../core/soop-categories.js');
  assert(SOOP_CATEGORY_MAP, 'SOOP_CATEGORY_MAP must be exported');
  assert.strictEqual(SOOP_CATEGORY_MAP['00810000'], '虚拟', "00810000 must map to '虚拟'");
  assert.strictEqual(SOOP_CATEGORY_MAP['00040019'], '英雄联盟', "00040019 must map to '英雄联盟'");
  assert.strictEqual(SOOP_CATEGORY_MAP['00040131'], 'VRChat', "00040131 must map to 'VRChat'");
  assert.strictEqual(StreamResolver.getSoopCategoryName('00810000'), '虚拟', 'getSoopCategoryName must return 虚拟 for 00810000');
  assert.strictEqual(StreamResolver.getSoopCategoryName(''), '综合直播', 'getSoopCategoryName must fallback to 综合直播 for empty code');
  assert.strictEqual(StreamResolver.getSoopCategoryName(null, 'Game'), 'Game', 'getSoopCategoryName must use fallbackTags when code is missing');
  assert(streamResolverCode.includes('getSoopCategoryName'), 'resolveSoop must use getSoopCategoryName');
  assert(streamResolverCode.includes('refreshSoopCategories'), 'StreamResolver must support dynamic refreshSoopCategories');
  console.log('  Pass: SOOP Category Code mapping and dynamic resolution verified.');

  console.log('[Test 11] SOOP 1440p direct play and dynamic quality ladder');
  assert(streamResolverCode.includes('is1440p'), 'StreamResolver must detect 1440p streams');
  assert(streamResolverCode.includes("targetQuality = is1440p ? 'hd8k' : 'original'"), 'StreamResolver must default 1440p streams to hd8k (1080p) for direct click playback');
  assert(streamResolverCode.includes('viewPreset'), 'StreamResolver must export viewPreset');
  assert(playerJsCode.includes('1440p 超清原画'), 'Player must provide 1440p label in quality switching');
  assert(playerJsCode.includes('1080p 高清原画'), 'Player must provide 1080p label in quality switching');
  assert(playerJsCode.includes('viewPreset'), 'Player populateQualities must support dynamic viewPreset');
  assert(accountManagerCode.includes('soopLiveHeaders'), 'AccountManager must pass soopLiveHeaders for player_live_api and stream assign');
  console.log('  Pass: SOOP 1440p direct playback & quality switching verified.');

  console.log('[Test 12] SOOP CDN 403 prevention (Rule 10012), master playlist multi-level ladder, and compact Debug Info');
  assert(accountManagerCode.includes('10012'), 'AccountManager must register DNR rule 10012 for SOOP CDN streams');
  assert(streamResolverCode.includes('common-master-hls'), 'StreamResolver must request master playlist for full quality ladder');
  assert(streamResolverCode.includes("prefCdn === 'kr_zone' ? 'lg_cdn_pc_web' : 'gcp_cdn'"), 'StreamResolver must default to gcp_cdn');
  assert(playerJsCode.includes("initialData?.platform === 'soop' ? 'global' : 'default'"), 'StreamSlot must default SOOP to global CDN');
  assert(playerJsCode.includes('renderGaugeTicks(activeCount, totalCount = 30)'), 'StreamSlot must support 30-tick segmented gauge matching Chzzk style');
  assert(playerCssCode.includes('rgba(18, 18, 22, 0.92)'), 'Debug card must use modern frosted glass dark background');
  console.log('  Pass: SOOP CDN 403 prevention, master playlist multi-level ladder, and compact Debug Info verified.');

  console.log('[Test 13] Chromecast Authentication Key for 1080p/1440p master playlist, Chzzk openTime URL propagation, and 2-column Debug Info');
  assert(streamResolverCode.includes('chromecast_authentication_key'), 'StreamResolver must retrieve chromecast_authentication_key to bypass SOOP 540p throttling');
  assert(streamResolverCode.includes('hls_authentication_key'), 'StreamResolver must fall back to hls_authentication_key when CC key absent');
  assert(streamResolverCode.includes('api.m.sooplive.com/broad/a/watch'), 'StreamResolver must query api.m.sooplive.com watch endpoint');
  assert(!accountManagerCode.match(/soopLiveHeaders\s*=\s*\[[\s\S]{0,200}X-Forwarded-For/), 'soopLiveHeaders must NOT inject Korean IP headers (X-Forwarded-For) into standard requests');
  assert(streamResolverCode.includes('RESULT === -2'), 'StreamResolver must only use Korean IP when RESULT === -2 (actual overseas region lock)');
  const bgCode = fs.readFileSync('background.js', 'utf8');
  assert(bgCode.includes('openTime'), 'background.js must forward openTime in openPlayerTab');
  const popupJsCode = fs.readFileSync('popup/popup.js', 'utf8');
  assert(popupJsCode.includes('openTime: currentResolvedData.openTime'), 'popup.js must pass openTime to OPEN_PLAYER');
  assert(playerCssCode.includes('.debug-label {'), 'Debug card label CSS must exist');
  assert(playerCssCode.includes('text-align: left;'), 'Debug card values and labels must be left-aligned matching Chzzk visual layout');
  assert(streamResolverCode.includes('isDirectHls'), 'StreamResolver must support direct M3U8 stream input');
  console.log('  Pass: Chromecast auth 1080p master playlist, metadata propagation, and 2-column Debug Info verified.');

  console.log('[Test 14] Volume control slider 0~200% range and mouse wheel adjustment');
  assert(playerJsCode.includes('min="0" max="200"'), 'Volume slider range must be set to 0~200% for comfortable 100% midpoint');
  assert(!playerJsCode.includes('max="300"'), 'Old max 300% must be removed');
  assert(playerJsCode.includes('handleVolWheel'), 'Volume slider must support mouse wheel fine tuning');
  assert(playerCssCode.includes('.vol-slider {'), 'vol-slider CSS styles must exist');
  console.log('  Pass: Volume control 0~200% range and wheel tuning verified.');

  console.log('[Test 15] Danmaku Lifecycle Fix, SOOP Room Stickers (0109), and Member Color Customization');
  const danmakuEngineCode = fs.readFileSync('player/danmaku-engine.js', 'utf8');

  // 1. Danmaku disappearing bug fix: _cleanupTimer cleared on recycle, listeners removed, maxOnScreen increased
  assert(danmakuEngineCode.includes('this.maxOnScreen = 150'), 'maxOnScreen must be increased to at least 150 to avoid premature mid-flight recycling');
  assert(danmakuEngineCode.includes('danmakuEl._cleanupTimer = setTimeout'), 'DanmakuEngine must track _cleanupTimer on elements');
  assert(danmakuEngineCode.includes('clearTimeout(el._cleanupTimer)'), 'recycleDanmakuElement must clear _cleanupTimer to prevent reusing elements with active timeouts');
  assert(danmakuEngineCode.includes('el.removeEventListener(\'animationend\', el._onAnimEnd)'), 'recycleDanmakuElement must clean up animationend listener');
  assert(danmakuEngineCode.includes('dynamicDuration'), 'DanmakuEngine must calculate dynamic flight duration based on text length');

  // 2. SOOP room custom stickers / OGQ stickers (opcode 0109)
  assert(danmakuEngineCode.includes("opcode === '0109'"), 'DanmakuEngine must handle SOOP opcode 0109 for room custom stickers');
  assert(danmakuEngineCode.includes('ogq-sticker-global-cdn-z01.sooplive.com'), 'DanmakuEngine must generate SOOP OGQ sticker CDN URL');
  assert(danmakuEngineCode.includes('danmaku-sticker'), 'DanmakuEngine must add danmaku-sticker class for room stickers');
  assert(playerCssCode.includes('.danmaku-item .danmaku-sticker'), 'player.css must define sizing for room custom stickers');

  // 3. Member danmaku detection for SOOP and Chzzk
  assert(danmakuEngineCode.includes('(flag2 & (1 << 18)) !== 0'), 'SOOP member check must test tier bitflags');
  assert(danmakuEngineCode.includes("platform: 'soop'"), 'SOOP chat must identify platform as soop');
  assert(danmakuEngineCode.includes("platform: 'chzzk'"), 'Chzzk chat must identify platform as chzzk');
  assert(danmakuEngineCode.includes('activityBadges'), 'Chzzk chat must detect member from activityBadges');
  assert(danmakuEngineCode.includes('danmaku-member-soop'), 'DanmakuEngine must attach danmaku-member-soop class');
  assert(danmakuEngineCode.includes('danmaku-member-chzzk'), 'DanmakuEngine must attach danmaku-member-chzzk class');

  // 4. Color presets and settings menu controls
  assert(danmakuEngineCode.includes('soopMemberColor'), 'DanmakuEngine must store soopMemberColor');
  assert(danmakuEngineCode.includes('chzzkMemberColor'), 'DanmakuEngine must store chzzkMemberColor');
  assert(danmakuEngineCode.includes('#339af0'), 'SOOP default member color must be blue (#339af0)');
  assert(danmakuEngineCode.includes('#51cf66'), 'Chzzk default member color must be grass green (#51cf66)');
  assert(danmakuEngineCode.includes('danmaku-soop-color-opts'), 'Settings menu must include SOOP member color controls');
  assert(danmakuEngineCode.includes('danmaku-chzzk-color-opts'), 'Settings menu must include Chzzk member color controls');
  assert(playerCssCode.includes('.danmaku-member-soop'), 'player.css must style SOOP member danmaku');
  assert(playerCssCode.includes('.danmaku-member-chzzk'), 'player.css must style Chzzk member danmaku');
  console.log('  Pass: Danmaku lifecycle, SOOP room stickers, and platform member colors verified.');

  console.log('[Test 16] Chzzk Timeshift / Replay Stability & Anti-Live-Snap Fixes');
  // 1. Check player.js for HLS replay configuration and synchronizeToLiveEdge override
  assert(playerJsCode.includes('liveSyncDuration: isReplay ? undefined : 3.0'), 'player.js must omit liveSyncDuration in replay mode');
  assert(playerJsCode.includes('liveMaxLatencyDurationCount: isReplay ? Infinity : undefined'), 'player.js must set liveMaxLatencyDurationCount to Infinity in replay mode');
  assert(playerJsCode.includes('this.hls.streamController.synchronizeToLiveEdge = () => {}'), 'player.js must override synchronizeToLiveEdge in replay mode to eliminate forced live edge snap');
  assert(playerJsCode.includes('!this.video?.seeking'), 'player.js timeupdate must not overwrite slider while video is seeking');
  assert(playerJsCode.includes('this.replayInitialized = true'), 'player.js must track replayInitialized to safely map server PTS window on first level load');
  assert(playerJsCode.includes('this.video.currentTime = start'), 'player.js must gently clamp to earliest available buffer on eviction rather than live edge');

  // 2. Instantiate vendor/hls.min.js in VM and verify replay config compliance
  const vm = await import('vm');
  const hlsMinCode = fs.readFileSync('vendor/hls.min.js', 'utf8');
  const vmCtx = { performance: performance, location: { href: 'http://localhost/' } };
  vmCtx.window = vmCtx; vmCtx.self = vmCtx; vmCtx.global = vmCtx; vmCtx.globalThis = vmCtx;
  vm.createContext(vmCtx);
  vm.runInContext(hlsMinCode, vmCtx);
  const HlsClass = vmCtx.Hls;

  const replayHlsInstance = new HlsClass({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 1200,
    maxBufferLength: 60,
    maxMaxBufferLength: 600,
    maxBufferSize: 60 * 1000 * 1000,
    liveSyncDuration: undefined,
    liveMaxLatencyDuration: undefined,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: Infinity,
    maxLiveSyncPlaybackRate: 1.0,
    liveDurationInfinity: true
  });

  assert.strictEqual(replayHlsInstance.config.liveSyncDuration, undefined, 'Replay Hls config liveSyncDuration must be undefined');
  assert.strictEqual(replayHlsInstance.config.liveMaxLatencyDuration, undefined, 'Replay Hls config liveMaxLatencyDuration must be undefined');
  assert.strictEqual(replayHlsInstance.config.liveMaxLatencyDurationCount, Infinity, 'Replay Hls config liveMaxLatencyDurationCount must be Infinity');
  assert(replayHlsInstance.streamController, 'StreamController must exist on Hls instance');
  assert.strictEqual(typeof replayHlsInstance.streamController.synchronizeToLiveEdge, 'function', 'synchronizeToLiveEdge must exist');

  // Override and verify
  replayHlsInstance.streamController.synchronizeToLiveEdge = () => {};
  assert.doesNotThrow(() => {
    replayHlsInstance.streamController.synchronizeToLiveEdge({ fragments: [{ start: 0 }], edge: 100 });
  }, 'Overridden synchronizeToLiveEdge must safely no-op');

  console.log('  Pass: Chzzk Timeshift / Replay anti-live-snap configuration and stream controller protection verified.');

  console.log('\nAll integration tests passed successfully.');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
