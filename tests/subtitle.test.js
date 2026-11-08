/**
 * KRStream Hub - Subtitle & Bilibili UI Unit Test Suite
 */

import assert from 'assert';
import { SubtitleEngine, SUBTITLE_LANGS, getSubtitleLangObj } from '../player/subtitle-engine.js';
import { DanmakuEngine } from '../player/danmaku-engine.js';

async function runSubtitleTests() {
  console.log('[Test 1] Language list structure');
  assert.strictEqual(SUBTITLE_LANGS.length, 8, 'Must provide exactly 8 languages');

  console.log('[Test 2] State mutation & event propagation');
  const mockSlot = {
    slotId: 2,
    currentStreamData: { platform: 'soop', isLive: true },
    dom: {
      querySelector() {
        return null;
      }
    },
    danmakuEngine: {
      lastCall: null,
      sendSubtitleLang(p, s, bi) {
        this.lastCall = { p, s, bi };
      }
    },
    slotManager: {
      saveState() {}
    }
  };

  const engine = new SubtitleEngine(mockSlot);
  assert.strictEqual(engine.primaryLang, 'zh-CN');
  assert.strictEqual(engine.secondaryLang, 'ko');
  assert.strictEqual(engine.isBilingual, true);

  engine.enabled = true;
  engine.setPrimaryLang('ja');
  assert.strictEqual(engine.primaryLang, 'ja');
  assert.strictEqual(mockSlot.danmakuEngine.lastCall.p, 'ja');

  engine.setSecondaryLang('en');
  assert.strictEqual(engine.secondaryLang, 'en');
  assert.strictEqual(mockSlot.danmakuEngine.lastCall.s, 'en');

  engine.setBilingual(false);
  assert.strictEqual(engine.isBilingual, false);
  assert.strictEqual(mockSlot.danmakuEngine.lastCall.bi, false);

  console.log('[Test 3] Opcode 0137 payload encoding');
  const sent = [];
  const mockWs = {
    readyState: 1,
    send(data) {
      sent.push(data);
    }
  };

  const danmaku = new DanmakuEngine(mockSlot);
  danmaku.activeSocket = mockWs;
  danmaku.sendSubtitleLang('ja', 'th', true);

  assert.strictEqual(sent.length, 1);
  assert(sent[0].includes('0137') && sent[0].includes('\x0c5\x0c'), 'Japanese corresponds to SOOP langNum 5');

  console.log('\nAll subtitle tests passed successfully.');
}

runSubtitleTests().catch((err) => {
  console.error('Subtitle test failed:', err);
  process.exit(1);
});
