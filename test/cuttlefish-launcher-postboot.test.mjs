import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCuttlefishLauncher, validateExpectation, parseArgs} from '../scripts/verify-cuttlefish-launcher.mjs';
const pkg='ai.elizaresearch.alphaphone';
const expected={packageName:pkg,apkSha256:'a'.repeat(64),certificateSha256:'b'.repeat(64),fingerprint:'Alpha/alpha_cf/vsoc_x86_64_only:17/test:userdebug/test-keys',apkPath:'/product/app/AlphaPhone/AlphaPhone.apk'};
function fixture(overrides={}) {
 const calls=[];let hashes=0;
 const run=(...args)=>{
  calls.push(args);const s=args.join(' ');
  if(overrides[s]!==undefined)return typeof overrides[s]==='function'?overrides[s]():overrides[s];
  if(s==='shell getprop sys.boot_completed')return '1';
  if(s==='shell getprop ro.hardware')return 'cutf_cvm';
  if(s==='shell getprop ro.product.device')return 'vsoc_x86_64_only';
  if(s==='shell getprop ro.build.fingerprint')return expected.fingerprint;
  if(s==='shell cat /proc/sys/kernel/random/boot_id')return '12345678-1234-1234-1234-123456789abc';
  if(s==='shell am get-current-user')return '0';
  if(s==='shell am get-started-user-state 0')return 'RUNNING_UNLOCKED';
  if(s==='shell getenforce')return 'Enforcing';
  if(s===`shell pm path --user 0 ${pkg}`)return `package:${expected.apkPath}`;
  if(s===`shell sha256sum ${expected.apkPath}`){hashes++;return expected.apkSha256+'  '+expected.apkPath;}
  if(s.startsWith('shell cmd package resolve-activity'))return pkg+'/.MainActivity';
  if(s.includes('query-activities')&&s.includes('android.intent.category.HOME'))return `${pkg}/.MainActivity\ncom.android.launcher3/.Launcher`;
  if(s.includes('pm list packages')&&s.endsWith('com.android.launcher3'))return 'package:com.android.launcher3';
  if(s.includes('pm list packages')&&s.endsWith('com.android.deskclock'))return 'package:com.android.deskclock';
  if(s.includes('query-activities')&&s.endsWith('com.android.deskclock'))return 'com.android.deskclock/.HandleApiCalls';
  if(s==='shell dumpsys webviewupdate')return 'Current WebView package (name, version): (com.android.webview, 145.0.1)';
  throw Error('Unexpected command '+s);
 };
 return {run,calls,hashes:()=>hashes};
}
test('exact image and system launcher checks remain read-only and narrowly scoped',()=>{
 const f=fixture(),r=verifyCuttlefishLauncher(f.run,expected,'0');
 assert.equal(r.passed,true);assert.equal(f.hashes(),2);
 assert.deepEqual(r.recoveryHomes,['com.android.launcher3/com.android.launcher3.Launcher']);
 assert.equal(r.clock.fingerprint,expected.fingerprint);assert.equal(r.clock.ringingVerified,false);assert.equal(r.runtimeExecutionVerified,false);assert.equal(r.physicalDeviceVerified,false);
 assert.ok(f.calls.every(a=>a[0]==='shell'&&!a.some(x=>['install','uninstall','start','set','grant','reboot'].includes(x))));
});
for(const [name,key,value] of [
 ['wrong image','shell getprop ro.build.fingerprint','different'],
 ['physical target','shell getprop ro.hardware','tensor'],
 ['locked user','shell am get-started-user-state 0','false'],
 ['wrong foreground','shell am get-current-user','10'],
 ['permissive SELinux','shell getenforce','Permissive'],
 ['updated data APK',`shell pm path --user 0 ${pkg}`,'package:/data/app/Alpha/base.apk'],
 ['different APK',`shell sha256sum ${expected.apkPath}`,'c'.repeat(64)+'  '+expected.apkPath],
 ['missing Clock','shell pm list packages --user 0 -s -e com.android.deskclock',''],
 ['missing WebView','shell dumpsys webviewupdate','Current WebView package is null'],
 ['unavailable recovery','shell pm list packages --user 0 -s -e com.android.launcher3','']
])test('rejects '+name,()=>assert.throws(()=>verifyCuttlefishLauncher(fixture({[key]:value}).run,expected,'0')));
test('rejects a reboot during observation',()=>{
 let reads=0;const f=fixture({'shell cat /proc/sys/kernel/random/boot_id':()=>++reads===1?'12345678-1234-1234-1234-123456789abc':'22345678-1234-1234-1234-123456789abc'});
 assert.throws(()=>verifyCuttlefishLauncher(f.run,expected,'0'),/changed during/);
});
test('requires bounded explicit inputs and refuses ambiguous flags',()=>{
 assert.throws(()=>validateExpectation({...expected,apkPath:'/product/app/../Alpha.apk'}));
 assert.throws(()=>validateExpectation({...expected,packageName:'ai.elizaos.app'}));
 assert.throws(()=>parseArgs(['--serial','device']));
 assert.throws(()=>parseArgs(['--serial','127.0.0.1:6520','--serial','localhost:6520']),/duplicate/);
});

test('Settings FallbackHome alone does not qualify as a recovery launcher',()=>{
 const key='shell cmd package query-activities --brief --components --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME';
 const f=fixture({[key]:`${pkg}/.MainActivity\ncom.android.settings/.FallbackHome`});
 assert.throws(()=>verifyCuttlefishLauncher(f.run,expected,'0'),/recovery HOME/);
});

for(const [name,key,initial,changed] of [
 ['HOME','shell cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME',pkg+'/.MainActivity','com.android.launcher3/.Launcher'],
 ['ambiguous HOME','shell cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME',pkg+'/.MainActivity',pkg+'/.MainActivity\ncom.android.launcher3/.Launcher'],
 ['SELinux','shell getenforce','Enforcing','Permissive'],
 ['user running state','shell am get-started-user-state 0','RUNNING_UNLOCKED','STOPPING']
])test('rejects '+name+' changing after initial admission',()=>{
 let transitioned=false;
 const f=fixture({[key]:()=>transitioned?changed:initial,
  'shell dumpsys webviewupdate':()=>{transitioned=true;return 'Current WebView package (name, version): (com.android.webview, 145.0.1)';}});
 assert.throws(()=>verifyCuttlefishLauncher(f.run,expected,'0'),/^Error: HOME, SELinux or user running state changed during verification$/);
 assert.equal(transitioned,true);
 assert.equal(f.calls.filter(args=>args.join(' ')===key).length,2,'Changed state must be independently re-observed');
 assert.ok(f.calls.every(args=>args[0]==='shell'&&!args.some(value=>['install','uninstall','start','set','grant','reboot'].includes(value))));
});
