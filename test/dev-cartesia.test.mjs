import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {developmentCartesiaEnvironment} from '../scripts/dev-cartesia.ts';

test('Cartesia is opt-in and rejects invalid activation or credential references', () => {
  assert.deepEqual(developmentCartesiaEnvironment({}), {});
  assert.deepEqual(developmentCartesiaEnvironment({ALPHA_DEV_CARTESIA:'0'}), {});
  assert.throws(() => developmentCartesiaEnvironment({ALPHA_DEV_CARTESIA:'true'}));
  for (const file of [undefined, 'relative-key']) {
    assert.throws(() => developmentCartesiaEnvironment({ALPHA_DEV_CARTESIA:'1', CARTESIA_API_KEY_FILE:file}));
  }
});

test('only a private regular credential file is admitted; its contents are never returned', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-cartesia-'));
  const file = path.join(directory, 'key');
  const input = {ALPHA_DEV_CARTESIA:'1', CARTESIA_API_KEY_FILE:file};
  try {
    fs.writeFileSync(file, 'synthetic-only', {mode:0o600});
    assert.deepEqual(developmentCartesiaEnvironment(input), {ELIZA_SELF_HOSTED_VOICE_ENABLED:'1', CARTESIA_API_KEY_FILE:file});
    fs.chmodSync(file, 0o644);
    assert.throws(() => developmentCartesiaEnvironment(input));
    fs.chmodSync(file, 0o600);
    fs.symlinkSync(file, path.join(directory, 'link'));
    assert.throws(() => developmentCartesiaEnvironment({...input,CARTESIA_API_KEY_FILE:path.join(directory,'link')}));
    fs.truncateSync(file, 0);
    assert.throws(() => developmentCartesiaEnvironment(input));
    fs.truncateSync(file, 4097);
    assert.throws(() => developmentCartesiaEnvironment(input));
  } finally { fs.rmSync(directory, {recursive:true,force:true}); }
});
