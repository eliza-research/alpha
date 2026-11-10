import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'android/aosp/branding/';
const config = fs.readFileSync(root + 'overlay/frameworks/base/core/res/res/values/config.xml', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const value = name => new RegExp(`<[^>]+name="${name}"[^>]*>([^<]*)</`).exec(config)?.[1];

test('Cloud-first image includes hardware assistant defaults without the optional listener', () => {
  assert.equal(value('config_defaultAssistant'), 'ai.elizaresearch.alphaphone');
  assert.equal(value('config_longPressOnPowerBehavior'), '5');
  assert.equal(value('config_longPressOnPowerForAssistantSettingAvailable'), 'true');
  const modules = fs.readFileSync(root + 'Android.bp', 'utf8');
  assert.match(modules, /name: "AlphaFrameworkOverlay",\s*manifest:[^\n]+\s*resource_dirs: \["overlay\/frameworks\/base\/core\/res\/res"\]/);
  assert.match(fs.readFileSync(root + 'branding.mk', 'utf8'), /PRODUCT_PACKAGES \+= AlphaFrameworkOverlay/);
});

test('power menu remains reachable and camera/emergency/short-press policies remain stock', () => {
  assert.equal(value('config_keyChordPowerVolumeUp'), '2');
  for (const name of ['config_doublePressOnPowerBehavior', 'config_cameraDoubleTapPowerGestureEnabled', 'config_shortPressOnPowerBehavior', 'config_keyChordPowerVolumeDown', 'config_supportEmergencyCallOnPowerLongPress']) {
    assert.equal(value(name), undefined, name);
  }
});

test('default resolves to the declared ordinary assist activity without a new privileged service', () => {
  const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  const activity = /<activity\s+android:name="\.AlphaAssistActivity"[\s\S]*?<\/activity>/.exec(manifest)?.[0];
  assert.ok(activity);
  assert.match(activity, /android:exported="true"/);
  assert.match(activity, /android.intent.action.ASSIST/);
  assert.match(activity, /android.intent.category.DEFAULT/);
  // Image resources are defaults, not a migration that rewrites a returning user's settings.
  assert.doesNotMatch(config, /Settings\.Secure|Settings\.Global|RECORD_AUDIO|BIND_VOICE_INTERACTION/);
});
