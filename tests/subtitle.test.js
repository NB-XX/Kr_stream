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

  console.log('[Test 4] Korean subtitle strictly excluded from Chinese primary slot');
  const mockBox = {
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    }
  };
  const mockSpeaker = { textContent: '', style: {} };
  const mockMain = { textContent: '', style: {} };
  const mockSec = { textContent: '', style: {} };

  engine.primaryLang = 'zh-CN';
  engine.secondaryLang = 'ko';
  engine.isBilingual = true;
  engine.overlayEl = {};
  engine.boxEl = mockBox;
  engine.speakerEl = mockSpeaker;
  engine.mainEl = mockMain;
  engine.secEl = mockSec;

  // When primary text is pending/empty and ko is supplied, mainEl MUST NOT display Korean
  engine.renderSubtitle('Streamer', { primary: '', ko: '안녕하세요', secondary: '안녕하세요' });
  assert.strictEqual(mockMain.textContent, '', 'Chinese slot must not be polluted with Korean text');
  assert.strictEqual(mockSec.textContent, '안녕하세요', 'Korean text must go to secondary slot');
  assert.strictEqual(mockSec.style.display, 'block', 'Secondary slot should be visible');

  console.log('[Test 5] Bilingual secondary stability (no disappearing/reappearing flicker)');
  // Primary Chinese arrives while secondary is currently empty in the packet
  engine.renderSubtitle('Streamer', { primary: '你好朋友', secondary: '' });
  assert.strictEqual(mockMain.textContent, '你好朋友', 'Chinese slot should update to Chinese text');
  assert.strictEqual(mockSec.textContent, '안녕하세요', 'Secondary Korean subtitle must persist to prevent flickering/disappearance');
  assert.strictEqual(mockSec.style.display, 'block', 'Secondary slot must remain visible without blinking');

  console.log('[Test 6] History recording isolation');
  engine.history = [];
  engine.addHistoryItem({
    speaker: 'Streamer',
    primary: '',
    secondary: '안녕하세요',
    ko: '안녕하세요',
    zh: ''
  });
  const histItem = engine.history[0];
  assert.strictEqual(histItem.primary, '', 'Primary history entry must not fall back to Korean text when primaryLang is Chinese');
  assert.strictEqual(histItem.secondary, '안녕하세요', 'Secondary history entry retains Korean text');

  console.log('\nAll subtitle tests passed successfully.');
}

runSubtitleTests().catch((err) => {
  console.error('Subtitle test failed:', err);
  process.exit(1);
});
