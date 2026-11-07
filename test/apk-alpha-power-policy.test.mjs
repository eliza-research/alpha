import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributionProblems } from '../scripts/apk.mjs';

function assess({name='.AlphaPowerVoiceActivity', permission='android.permission.STATUS_BAR_SERVICE', tag='activity', extra=''}={}) {
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
${extra}`, badging:"package: name='ai.elizaresearch.alphaphone' versionCode='15' versionName='15'", names:['assets/public/licenses/third-party-notices.json']}, {mode:'release'}).problems;
}

test('release admits the exact platform-protected Power activity', () => {
  assert.deepEqual(assess(), []);
});
test('release refuses unprotected or incorrectly protected Power entry', () => {
  for (const permission of ['', 'android.permission.INTERNET', 'android.permission.BIND_QUICK_SETTINGS_TILE'])
    assert.ok(assess({permission}).some(problem => problem.includes('AlphaPowerVoiceActivity')), permission);
});
test('release refuses the Power name on other component types', () => {
  for (const tag of ['service', 'receiver', 'provider'])
    assert.ok(assess({tag}).some(problem => problem.includes('AlphaPowerVoiceActivity')), tag);
});
test('platform permission does not admit an unexpected exported component', () => {
  assert.ok(assess({name:'.OtherPowerActivity'}).some(problem => problem.includes('Unexpected exported activity')));
  assert.ok(assess({extra:`    E: activity
      A: android:name=".UnexpectedActivity"
      A: android:exported=(type 0x12)0xffffffff
      A: android:permission="android.permission.STATUS_BAR_SERVICE"
`}).some(problem => problem.includes('Unexpected exported activity')));
});
