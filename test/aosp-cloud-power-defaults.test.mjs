import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'android/aosp/branding/';
const config = fs.readFileSync(root + 'overlay/frameworks/base/core/res/res/values/config.xml', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const value = name => new RegExp(`<[^>]+name="${name}"[^>]*>([^<]*)</`).exec(config)?.[1];

test('power menu remains reachable and camera/emergency/short-press policies remain stock', () => {
  assert.equal(value('config_keyChordPowerVolumeUp'), '2');
  for (const name of ['config_doublePressOnPowerBehavior', 'config_cameraDoubleTapPowerGestureEnabled', 'config_shortPressOnPowerBehavior', 'config_keyChordPowerVolumeDown', 'config_supportEmergencyCallOnPowerLongPress']) {
    assert.equal(value(name), undefined, name);
  }
});
