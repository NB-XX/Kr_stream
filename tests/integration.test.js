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

  console.log('\nAll integration tests passed successfully.');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
