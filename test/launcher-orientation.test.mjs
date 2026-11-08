import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The launcher is portrait only; the standalone app is an ordinary app and rotates. Android's
// handling of the lock is emulator and device evidence (RotationInstrumentedTest).
const read = file => readFileSync(file, 'utf8');

test('every launcher surface is locked to portrait', () => {
  const launcher = read('android/app/src/launcher/AndroidManifest.xml');
  for (const activity of ['MainActivity', 'AlphaAssistActivity', 'AlphaPowerVoiceActivity'])
    assert.match(launcher, new RegExp(`<activity android:name="\\.${activity}"[^>]*android:screenOrientation="portrait" tools:replace="android:screenOrientation"`));
});

test('the standalone app keeps the shared orientation', () => {
  assert.equal(JSON.parse(read('app.config.json')).orientation, 'unspecified');
  assert.doesNotMatch(read('android/app/src/standalone/AndroidManifest.xml'), /screenOrientation/);
});
