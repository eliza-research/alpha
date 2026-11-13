import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {checkBrowserAlarmRinging} from '../specs/quint/refinement/application/browser-alarm-ringing.mjs';

test('two browser pages sharing the alarm lock follow every BrowserAlarmRinging model step', {timeout: scaledTimeout(280000)}, async () => {
  const result = await checkBrowserAlarmRinging();
  assert.equal(result.traces, 37);
  for (const action of ['alarmPosted', 'alarmCleared', 'pollOwner', 'requestLock', 'lockGranted', 'hide', 'show', 'soundEnds', 'stutter'])
    assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/browser/clock.ts', 'apps/app/src/browser/alert-audio.ts']) assert.ok(result.sources.includes(source), source);
});

test('owning the alarm without rechecking that the page is still allowed is rejected by the replay', {timeout: scaledTimeout(280000)}, async () => {
  const granted = 'if (!lock || !this.allowed() || this.owns) return;', read = 'if (!current || !this.allowed()) return;';
  await assert.rejects(checkBrowserAlarmRinging(code => {
    assert.ok(code.includes(granted) && code.includes(read));
    return code.replace(granted, 'if (!lock || this.owns) return;').replace(read, 'if (!current) return;');
  }), /lockGranted/);
});
