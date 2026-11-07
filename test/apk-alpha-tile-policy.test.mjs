import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributionProblems } from '../scripts/apk.mjs';
function assess({name='.AlphaQuickSettingsTile', permission='android.permission.BIND_QUICK_SETTINGS_TILE', action='android.service.quicksettings.action.QS_TILE', tag='service'}={}) {
  return distributionProblems({xml:`E: manifest
  A: package="ai.elizaresearch.alphaphone"
  E: application
    A: android:allowBackup=(type 0x12)0x0
    A: android:usesCleartextTraffic=(type 0x12)0x0
    A: android:networkSecurityConfig=@0x7f010001
    E: ${tag}
      A: android:name="${name}"
      A: android:exported=(type 0x12)0xffffffff
      ${permission ? `A: android:permission="${permission}"` : ''}
      E: intent-filter
        E: action
          A: android:name="${action}"
`, badging:"package: name='ai.elizaresearch.alphaphone' versionCode='15' versionName='15'", names:['assets/public/licenses/third-party-notices.json']}, {mode:'release'}).problems;
}
test('release admits only the exact Android-bound Alpha action tile', () => {
 assert.deepEqual(assess(), []);
 for (const change of [{permission:''},{permission:'android.permission.INTERNET'},{action:'other.action'},{tag:'activity'},{name:'.OtherService'}])
   assert.ok(assess(change).length, JSON.stringify(change));
});
