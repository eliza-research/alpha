import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export const shellVoiceScrollSource = new URL('../../apps/app/src/prototype/model.js', import.meta.url);

/** Supply the actual shell hooks when a focused fixture replaces the rest of the shell. */
export function copyVoiceScrollHooks(target, context = {}) {
  const source = readFileSync(shellVoiceScrollSource, 'utf8');
  const start = source.indexOf('  beginVoiceScrollFollow() {');
  const end = source.indexOf('  getSnapshotBeforeUpdate(', start);
  assert.ok(start >= 0 && end > start, 'The shell voice-scroll hooks must be present');
  const Shell = runInNewContext('(class {' + source.slice(start, end) + '})', context);
  for (const name of ['beginVoiceScrollFollow', 'followVoiceTurn', 'cancelVoiceScrollFollow']) {
    target[name] = Shell.prototype[name];
  }
}
