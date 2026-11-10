import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyPixel10aImage, verifiedBootProblem, main} from '../scripts/verify-pixel10a-image.mjs';
const pkg='ai.elizaresearch.alphaphone';
const expected={packageName:pkg,apkSha256:'a'.repeat(64),certificateSha256:'b'.repeat(64),fingerprint:'Alpha/alpha_stallion_phone/stallion:17/test:user/release-keys',apkPath:'/product/app/AlphaPhone/AlphaPhone.apk'};
// Self-contained so the same responder also serves as a fake adb executable for the CLI test.
function respond(s,expected,bootState){
 const pkg=expected.packageName;
 if(s==='shell getprop ro.boot.verifiedbootstate')return bootState;
 if(s==='shell getprop ro.boot.slot_suffix')return '_a';
 if(s==='shell getprop sys.boot_completed')return '1';
 if(s==='shell getprop ro.hardware')return 'stallion';
 if(s==='shell getprop ro.product.device')return 'stallion';
 if(s==='shell getprop ro.build.fingerprint')return expected.fingerprint;
 if(s==='shell cat /proc/sys/kernel/random/boot_id')return '12345678-1234-1234-1234-123456789abc';
 if(s==='shell am get-current-user')return '0';
 if(s==='shell am get-started-user-state 0')return 'RUNNING_UNLOCKED';
 if(s==='shell getenforce')return 'Enforcing';
 if(s===`shell pm path --user 0 ${pkg}`)return `package:${expected.apkPath}`;
 if(s===`shell sha256sum ${expected.apkPath}`)return expected.apkSha256+'  '+expected.apkPath;
 if(s.startsWith('shell cmd package resolve-activity'))return pkg+'/.MainActivity';
 if(s.includes('query-activities')&&s.includes('android.intent.category.HOME'))return `${pkg}/.MainActivity\ncom.android.launcher3/.Launcher`;
 if(s.includes('pm list packages')&&s.endsWith('com.android.launcher3'))return 'package:com.android.launcher3';
 if(s.includes('pm list packages')&&s.endsWith('com.android.deskclock'))return 'package:com.android.deskclock';
 if(s.includes('query-activities')&&s.endsWith('com.android.deskclock'))return 'com.android.deskclock/.HandleApiCalls';
 if(s==='shell dumpsys webviewupdate')return 'Current WebView package (name, version): (com.android.webview, 145.0.1)';
 throw Error('Unexpected command '+s);
}
const runner=bootState=>(...args)=>respond(args.join(' '),expected,bootState);
for(const state of ['green','yellow'])test(`admits a locked ${state} verified boot state`,()=>{
 const r=verifyPixel10aImage(runner(state),expected,'0');
 assert.equal(r.passed,true);assert.deepEqual(r.verifiedBoot,{state,slotSuffix:'_a'});
});
for(const state of ['orange','red','',undefined])test(`rejects verified boot state ${JSON.stringify(state)}`,()=>{
 assert.throws(()=>verifyPixel10aImage(runner(state??''),expected,'0'),/Verified boot state .* is not green or yellow/);
 assert.match(verifiedBootProblem({passed:true,verifiedBoot:state===undefined?null:{state}}),/not green or yellow/);
});
test('CLI writes a failing report on an unlocked (orange) device',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pixel10a-image-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const adb=path.join(dir,'adb'),descriptor=path.join(dir,'launcher.json');
 fs.writeFileSync(adb,`#!${process.execPath}\n${respond}\ntry{process.stdout.write(respond(process.argv.slice(4).join(' '),${JSON.stringify(expected)},process.env.FAKE_VERIFIED_BOOT_STATE))}catch(e){console.error(e.message);process.exit(1)}\n`,{mode:0o700});
 const {fingerprint,apkPath,...descriptorBody}=expected;fs.writeFileSync(descriptor,JSON.stringify(descriptorBody));
 const cli=(state,out)=>{
  process.env.FAKE_VERIFIED_BOOT_STATE=state;const exit=process.exitCode;process.exitCode=undefined;
  try{main(['--serial','ABC12345','--user','0','--descriptor',descriptor,'--fingerprint',fingerprint,'--apk-path',apkPath,'--out',out,'--adb',adb]);return [process.exitCode,JSON.parse(fs.readFileSync(out,'utf8'))];}
  finally{process.exitCode=exit;delete process.env.FAKE_VERIFIED_BOOT_STATE;}
 };
 const [okExit,ok]=cli('yellow',path.join(dir,'yellow.json'));
 assert.equal(okExit,undefined);assert.equal(ok.passed,true);assert.equal(ok.verifiedBoot.state,'yellow');
 const [badExit,bad]=cli('orange',path.join(dir,'orange.json'));
 assert.equal(badExit,1);assert.equal(bad.passed,false);assert.match(bad.error,/"orange" is not green or yellow/);
});
