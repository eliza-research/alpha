import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeSource,fixture,runJvm,root,javaBinary,jvmTimeout,upstreamConnection} from './fixtures/jvm-tools.mjs';
import {exactUpdateMembers} from '../specs/quint/refinement/native/update-barrier.mjs';

// One-tap app update, native side (AlphaDevicePlugin). The download admission and the update flow run on the
// host JVM from the plugin's own source; the rest are source checks (class S) of Android wiring that only a
// device exercises. The renderer policy is in test/settings-truth.test.mjs and the rendered rows in
// settings-device-facts.spec.ts.
const plugin=readFileSync(nativeSource('AlphaDevicePlugin.java'),'utf8');
const install=plugin.slice(plugin.indexOf('@PluginMethod public void installUpdate('),plugin.indexOf('@Override protected void handleOnDestroy()'));
const javaFiles=dir=>readdirSync(dir,{recursive:true}).filter(file=>file.endsWith('.java')).map(file=>join(dir,file));

test('the download is admitted only at its declared size and SHA-256',()=>{
 const start=plugin.indexOf(' static final long UPDATE_MAX_BYTES='),end=plugin.indexOf(' static final String UPDATE_STATUS=');
 assert.ok(start>0&&end>start,'the admission members exist');
 const dir=mkdtempSync(join(tmpdir(),'alpha-update-'));
 try{
  // Only the admission members, in a class of the plugin's name: no Capacitor or Android types.
  const members=join(dir,'AlphaDevicePlugin.java');
  writeFileSync(members,`package ai.alphacompute.alphaphone;\nfinal class AlphaDevicePlugin {\n${plugin.slice(start,end)}}\n`);
  assert.match(runJvm([members,fixture('UpdateDownloadTest.java')],'ai.alphacompute.alphaphone.UpdateDownloadTest'),/^PASS update download/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the update flow runs one attempt per process, fences a session Android still holds, keeps its confirmation for the bridge that asked, opens it once, and settles every failure quietly',()=>{
 const deadline='static final long UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.HOURS.toNanos(6)';
 const offerDeadline='private static final int UPDATE_MANIFEST_RECHECK_MILLIS=10000';
 assert.ok(plugin.includes(deadline),'the production download deadline exists');
 assert.ok(plugin.includes(offerDeadline),'the production final offer deadline exists');
 const dir=mkdtempSync(join(tmpdir(),'alpha-update-flow-'));
 try{
  // The plugin's own members with shortened deadlines; the stubs state what Android and Capacitor do.
  const members=join(dir,'AlphaDevicePlugin.java');
  const keyStore=join(dir,'cache-tls.p12');
  execFileSync(javaBinary('keytool'),['-genkeypair','-alias','fixture','-keyalg','RSA','-storetype','PKCS12',
   '-keystore',keyStore,'-storepass','fixture-pass','-keypass','fixture-pass','-dname','CN=localhost',
   '-ext','SAN=dns:localhost,ip:127.0.0.1','-validity','2','-noprompt'],{stdio:'pipe',timeout:jvmTimeout});
  writeFileSync(members,exactUpdateMembers(plugin)
   .replace(deadline,'static long UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.SECONDS.toNanos(3)')
   .replace(offerDeadline,'private static final int UPDATE_MANIFEST_RECHECK_MILLIS=1200'));
  const result=runJvm([members,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/updater/RuntimeUpdatePause.java'),nativeSource('PluginWorkers.java'),nativeSource('AlphaUpdateStatusReceiver.java'),nativeSource('UpdateConfirmationReceipt.java'),...javaFiles(fixture('app-update-jvm')).filter(file=>!file.endsWith('/ConnectionTransport.java')),upstreamConnection('ConnectionTransport.java'),fixture('UpdateFlowTest.java')],'ai.alphacompute.alphaphone.UpdateFlowTest',{json:true,timeout:240000,args:[keyStore]});
  assert.match(result,/PASS verified cache retry over owned TLS: one request, exact retained bytes, one synthetic installer commit/);
  assert.match(result,/PASS fresh HTTPS offer rejects cached withdrawal, change and transport failure before one current commit/);
  assert.match(result,/PASS final offer deadline bounds held network stages and leaves manual recovery available/);
  assert.match(result,/PASS call changes during final HTTPS defer automatic commit/);
  assert.match(result,/PASS revoked install consent during final HTTPS leaves no commit or pause/);
  assert.match(result,/PASS exact pending installer callback survives process replacement once/);
  assert.match(result,/PASS explicit update permission opens only Alpha Android settings before an offer/);
  assert.match(result,/PASS automatic call deferral protects stock and image installs before download and commit/);
  assert.match(result,/^PASS update flow/m);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Android installs only the offered newer build of this package, and only when no session of Alpha\'s fences the tap',()=>{
 const order=['updatesCommitted.get();','updating.compareAndSet(false,true)','updatesCommitted.get()!=seen','installer.getMySessions()','copyVerified(in,out,size,sha256,deadline);','apk.getPath(),PackageManager.GET_PERMISSIONS|PackageManager.GET_SIGNING_CERTIFICATES)','params.setReferrerUri(','installer.createSession(params)','session.fsync(out)','session.setStagingProgress(1f);','updateOwner=this;updateSession=id;','if(Thread.currentThread().isInterrupted())updateOwner=null;','commitAttempted=true;','session.commit(','updatesCommitted.incrementAndGet();','if(!keepApk){updateVerified=null;apk.delete();}updating.set(false);'].map(step=>install.indexOf(step));
 assert.ok(order.every((at,index)=>at>0&&(index===0||at>order[index-1])),'a tap fences at entry, Android\'s sessions fence it before any download, size, SHA-256 and the archive are admitted before any session changes, a session is bound before Android has it, its commit intent is Android\'s before anything else of the commit, its status can only arrive once it has its owner, the commit boundary is crossed in that order, and a commit is counted before its attempt lets go');
 // One path abandons, a failure of the attempt's own session before its commit, asserted below. Nothing abandons a session Android lists as sealed.
 assert.equal(plugin.match(/abandonSession\(/g).length,1);
 // One commit, the attempt's own first: nothing commits a session a process did not just stage.
 assert.equal(plugin.match(/session\.commit\(/g).length,1);
 // One commit intent, read as an exact 0 so that nothing but Android's own zero clears it, and only on a session bound with the
 // mark, in its boot, on a release build of a level whose AOSP orders that read after the intent (29, 30, 33 to 37). Another
 // boot clears a bound unsealed session; no binding, or a corrupt one, fences sealed or not.
 assert.equal(plugin.match(/setStagingProgress\(/g).length,1);
 assert.equal(install.match(/getProgress\(\)==0f/g).length,1);
 assert.ok(install.includes('if(binding!=null&&!listed.isSealed()&&(!binding.group(4).equals(String.valueOf(updateBoot()))||binding.group(5)!=null&&"REL".equals(Build.VERSION.CODENAME)&&(Build.VERSION.SDK_INT<=30||Build.VERSION.SDK_INT>=33&&Build.VERSION.SDK_INT<=37)&&listed.getProgress()==0f))continue;'),'the unsealed fence clears only what is proven');
 assert.ok(plugin.includes('/([0-9a-f]{64})/([0-9]+)(/intent)?(/automatic)?");'),'a binding reads with or without the commit and automatic marks');
 assert.ok(install.includes('+"/"+updateBoot()+"/intent"+(automatic?"/automatic":"");'),'this build binds the commit and its automatic mode');
 assert.doesNotMatch(plugin,/refused\)\{updateOwner=null|commitUpdate|getUpdatedMillis|elapsedRealtime/);
 assert.match(install,/params\.setAppPackageName\(getContext\(\)\.getPackageName\(\)\);/);
 // The status intent reaches only this app's receiver, and Android must be able to add the session result to it.
 assert.match(install,/AlphaUpdateStatusReceiver\.sender\(getContext\(\),preparation\.id,id\)/);
 const receiver=readFileSync(nativeSource('AlphaUpdateStatusReceiver.java'),'utf8');
 assert.match(receiver,/new Intent\(context,AlphaUpdateStatusReceiver\.class\)/);
 assert.match(receiver,/PendingIntent\.FLAG_MUTABLE/);
 assert.match(plugin,/registerReceiver\(getContext\(\),updateStatus,new android\.content\.IntentFilter\(UPDATE_STATUS\),androidx\.core\.content\.ContextCompat\.RECEIVER_NOT_EXPORTED\)/);
 assert.match(install,/catch\(Exception failed\)\{\s*if\(!commitAttempted\)try\{installer\.abandonSession\(id\);\}catch\(RuntimeException cleanup\)\{failed\.addSuppressed\(cleanup\);\}\s*throw failed;\s*\}/);
 // The file goes while the flag is held: a delete after it would hit the next attempt's download.
 assert.match(install,/if\(!keepApk\)\{updateVerified=null;apk\.delete\(\);\}updating\.set\(false\);\s*\}/);
 // A check of 404 is an answer, not a failure.
 assert.match(plugin,/if\(status==404\)return null;\s*if\(status!=200\)throw/);
 assert.match(plugin,/call\.resolve\(manifest==null\?new JSObject\(\)/);
 assert.match(plugin,/updateConnection\(BuildConfig\.ALPHA_UPDATE_MANIFEST_URL\)/);
 assert.match(plugin,/handleOnDestroy\(\)\{[^}]*updateWorker\.shutdownNow\(\);[^}]*getContext\(\)\.unregisterReceiver\(updateStatus\);[^}]*if\(updateOwner==this\)/);
 assert.doesNotMatch(plugin,/INSTALL_PACKAGES"|toast|Toast/);
 assert.match(install,/if\(automatic&&Build\.VERSION\.SDK_INT>=31\)params\.setRequireUserAction\(PackageInstaller\.SessionParams\.USER_ACTION_NOT_REQUIRED\)/);
});

test('Alpha stays nonprivileged and reads one configured HTTPS manifest from its own rolling release',()=>{
 const manifestXml=readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(manifestXml,/<receiver android:name="\.AlphaUpdateStatusReceiver" android:exported="false" \/>/);
 assert.match(manifestXml,/<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/);
 assert.match(manifestXml,/<uses-permission android:name="android\.permission\.UPDATE_PACKAGES_WITHOUT_USER_ACTION" \/>/);
 assert.doesNotMatch(manifestXml,/android\.permission\.(INSTALL_PACKAGES|DELETE_PACKAGES)"/);
 const url=JSON.parse(readFileSync(join(root,'app.config.json'),'utf8')).updateManifestUrl;
 assert.equal(new URL(url).protocol,'https:');
 // Not releases/latest: any newer release of the repository without the manifest would answer 404 and withdraw a valid offer.
 assert.equal(url,'https://github.com/alphacompute/alpha/releases/download/app-stable-alphacompute/alpha-update-stable.json');
 // Reads enforce a soft download ceiling rather than interrupting a blocked read.
 assert.ok(plugin.includes('Soft ceiling on one update download'));
 assert.match(readFileSync(join(root,'android/app/product.gradle'),'utf8'),/buildConfigField 'String', 'ALPHA_UPDATE_MANIFEST_URL', "\\"\$\{updateManifestUrl\}\\""/);
 for(const file of ['apps/app/src/prototype/settings-adapter.ts','android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java'])assert.ok(!readFileSync(join(root,file),'utf8').includes(url),file);
});
