import test from 'node:test';
import assert from 'node:assert/strict';
import {distributionProblems} from '../scripts/apk.mjs';

function assess({home=true,tag='service',permission='android.permission.BIND_INPUT_METHOD',action='android.view.InputMethod',metadata=true}={}) {
 return distributionProblems({home,xml:`E: manifest
  A: package="ai.alphacompute.alphaphone"
  E: application
    A: android:allowBackup=(type 0x12)0x0
    A: android:usesCleartextTraffic=(type 0x12)0x0
    A: android:networkSecurityConfig=@0x7f010001
    E: ${tag}
      A: android:name=".AlphaKeyboardDictationService"
      A: android:exported=(type 0x12)0xffffffff
      A: android:permission="${permission}"
      E: intent-filter
        E: action
          A: android:name="${action}"
${metadata?`      E: meta-data
        A: android:name="android.view.im"
        A: android:resource=@0x7f010002
`:''}`,badging:"package: name='ai.alphacompute.alphaphone' versionCode='44' versionName='44'",names:['assets/public/licenses/third-party-notices.json']},{mode:'release'}).problems;
}
test('voice keyboard admits the launcher service bound only by Android',()=>assert.deepEqual(assess(),[]));
test('voice keyboard rejects standalone packaging, public binding and unrelated entry contracts',()=>{
 for(const change of [{home:false},{tag:'activity'},{permission:''},{permission:'android.permission.INTERNET'},{action:'other.action'},{metadata:false}])
  assert.ok(assess(change).length,JSON.stringify(change));
});
