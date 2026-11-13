import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The launcher is portrait only. Android's
// handling of the lock is emulator and device evidence (RotationInstrumentedTest).
const read = file => readFileSync(file, 'utf8');

test('every launcher surface is locked to portrait', () => {
  const launcher = read('android/app/src/launcher/AndroidManifest.xml');
  for (const activity of ['MainActivity', 'AlphaAssistActivity', 'AlphaPowerVoiceActivity']) {
    const entry = launcher.match(new RegExp(`<activity android:name="\\.${activity}"[^>]*>`))?.[0];
    assert.match(entry, /android:screenOrientation="portrait"/);
    assert.ok(entry.match(/tools:replace="([^"]*)"/)?.[1].split(',').includes('android:screenOrientation'));
  }
});
