import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributionProblems } from '../scripts/apk.mjs';
// aapt prints android:enabled="false" as (type 0x12)0x0. The manifest disables the tile with its target (P-78).
const disabled='A: android:enabled=(type 0x12)0x0';
function assess({name='.AlphaQuickSettingsTile', permission='android.permission.BIND_QUICK_SETTINGS_TILE', action='android.service.quicksettings.action.QS_TILE', tag='service', tileEnabled=false, assist='disabled'}={}) {
  return distributionProblems({xml:`E: manifest
  A: package="ai.alphacompute.alphaphone"
  E: application
    A: android:allowBackup=(type 0x12)0x0
    A: android:usesCleartextTraffic=(type 0x12)0x0
    A: android:networkSecurityConfig=@0x7f010001
    E: activity
      A: android:name=".MainActivity"
      A: android:exported=(type 0x12)0xffffffff
${assist ? `    E: activity
      A: android:name=".AlphaAssistActivity"
      ${assist === 'disabled' ? disabled : ''}
      A: android:exported=(type 0x12)0x0
` : ''}    E: ${tag}
      A: android:name="${name}"
      ${tileEnabled ? '' : disabled}
      A: android:exported=(type 0x12)0xffffffff
      ${permission ? `A: android:permission="${permission}"` : ''}
      E: intent-filter
        E: action
          A: android:name="${action}"
`, badging:"package: name='ai.alphacompute.alphaphone' versionCode='15' versionName='15'", names:['assets/public/licenses/third-party-notices.json']}, {mode:'release'}).problems;
}
test('release admits only the exact Android-bound Alpha action tile', () => {
 assert.deepEqual(assess(), []);
 for (const change of [{permission:''},{permission:'android.permission.INTERNET'},{action:'other.action'},{tag:'activity'},{name:'.OtherService'}])
   assert.ok(assess(change).length, JSON.stringify(change));
});
test('the tile ships disabled while its only target, AlphaAssistActivity, is disabled or absent', () => {
 assert.deepEqual(assess({assist:'disabled'}), []);
 assert.deepEqual(assess({tileEnabled:true, assist:'enabled'}), []);
 for (const assist of ['disabled', null])
   assert.deepEqual(assess({tileEnabled:true, assist}), ['Alpha Quick Settings tile must be disabled while AlphaAssistActivity is disabled'], String(assist));
});
