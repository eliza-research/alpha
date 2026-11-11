import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const python = code => JSON.parse(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8' }));

test('calendar bridge takes the SDK pin from upstream.lock.json and binds the current calendar host', () => {
  const constants = python(`
import importlib.util, json
spec = importlib.util.spec_from_file_location('calendar_bridge', 'scripts/ci/calendar-bridge.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps({'sdk': module.SDK, 'host': module.HOST}))`);
  assert.equal(constants.sdk, json('upstream.lock.json').commit);
  const host = fs.readFileSync(path.join(root, 'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaCalendarPlugin.java'));
  assert.equal(constants.host, createHash('sha256').update(host).digest('hex'),
    'AlphaCalendarPlugin.java changed: review it and update HOST in scripts/ci/calendar-bridge.py');
});

test('the voice host record names the Paradee model version the product ships', () => {
  const shipped = json('scripts/host-speech-assets.json').tts[0];
  const version = /^paradee-8m-v(\d+)_(\d+)\.gguf$/.exec(shipped.path).slice(1).join('.');
  const row = json('android/voice-host/qualified-voice-host.json').models.find(model => model.role === 'tts-model');
  assert.equal(row.path, `tts/paradee/${shipped.path}`);
  assert.deepEqual({ sha256: row.sha256, bytes: row.bytes }, { sha256: shipped.sha256, bytes: shipped.bytes });
  assert.match(row.name, new RegExp(`v${version.replace('.', '\\.')}\\b`));
  assert.ok(row.source.includes(`--version ${version} `), row.source);
});
