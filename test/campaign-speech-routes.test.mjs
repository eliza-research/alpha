import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Live campaigns intercept the paired speech routes the app calls. A route renamed in
// PairedSpeechContract must fail here instead of leaving a campaign that never sees a request.
const contract = fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/PairedSpeechContract.java', 'utf8');
const field = name => contract.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
const routes = { asr: field('ASR_PATH'), tts: field('TTS_PATH') };

test('PairedSpeechContract declares both speech routes', () => {
  assert.match(routes.asr ?? '', /^\/api\/asr\/[^/]+$/);
  assert.match(routes.tts ?? '', /^\/api\/tts\/[^/]+$/);
});

test('every live campaign that intercepts speech uses the contract routes', () => {
  const campaigns = fs.readdirSync('scripts').filter(name => /^android-.*-live\.ts$/.test(name));
  assert.ok(campaigns.length > 0);
  let checked = 0;
  for (const name of campaigns) {
    const source = fs.readFileSync(path.join('scripts', name), 'utf8');
    for (const [kind, route] of Object.entries(routes)) {
      const used = [...source.matchAll(new RegExp(`/api/${kind}/[A-Za-z0-9_.-]+`, 'g'))].map(match => match[0]);
      for (const found of used) assert.equal(found, route, `${name} intercepts ${found}, not ${route}`);
      checked += used.length;
    }
  }
  assert.ok(checked > 0, 'no live campaign intercepts a speech route');
});
