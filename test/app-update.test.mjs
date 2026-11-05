import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeSource,fixture,runJvm,root} from './fixtures/jvm-tools.mjs';

// One-tap app update, native side (AlphaDevicePlugin). The download admission and the update flow run on the
// host JVM from the plugin's own source; the rest are source checks (class S) of Android wiring that only a
// device exercises. The renderer policy is in test/settings-truth.test.mjs and the rendered rows in
// settings-device-facts.spec.ts.
const plugin=readFileSync(nativeSource('AlphaDevicePlugin.java'),'utf8');
const install=plugin.slice(plugin.indexOf('@PluginMethod public void installUpdate('),plugin.indexOf('@Override protected void handleOnDestroy()'));
const javaFiles=dir=>readdirSync(dir,{recursive:true}).filter(file=>file.endsWith('.java')).map(file=>join(dir,file));

test('the download is admitted only at its declared size and SHA-256',()=>{
 const start=plugin.indexOf(' static final long UPDATE_MAX_BYTES='),end=plugin.indexOf(' private static final String UPDATE_STATUS=');
 assert.ok(start>0&&end>start,'the admission members exist');
 const dir=mkdtempSync(join(tmpdir(),'alpha-update-'));
 try{
  // Only the admission members, in a class of the plugin's name: no Capacitor or Android types.
  const members=join(dir,'AlphaDevicePlugin.java');
  writeFileSync(members,`package ai.elizaresearch.alphaphone;\nfinal class AlphaDevicePlugin {\n${plugin.slice(start,end)}}\n`);
  assert.match(runJvm([members,fixture('UpdateDownloadTest.java')],'ai.elizaresearch.alphaphone.UpdateDownloadTest'),/^PASS update download/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the update flow runs one attempt per process, fences a session Android still holds, keeps its confirmation for the bridge that asked, opens it once, and settles every failure quietly',()=>{
 const start=plugin.indexOf(' static final long UPDATE_MAX_BYTES='),end=plugin.lastIndexOf('}');
 const deadline='UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.HOURS.toNanos(6)';
 assert.ok(start>0&&end>start&&plugin.includes(deadline),'the update members exist');
 const dir=mkdtempSync(join(tmpdir(),'alpha-update-flow-'));
 try{
  // The plugin's own members in a class of its name, with only the deadline shortened to seconds; the stubs state what Android and Capacitor do.
  const members=join(dir,'AlphaDevicePlugin.java');
  writeFileSync(members,`package ai.elizaresearch.alphaphone;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.*;
final class AlphaDevicePlugin extends Plugin {
 private final java.util.concurrent.ExecutorService diagnosticsWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
${plugin.slice(start,end).replace(deadline,'UPDATE_DEADLINE_NANOS=java.util.concurrent.TimeUnit.SECONDS.toNanos(3)')}}
`);
  assert.match(runJvm([members,nativeSource('PluginWorkers.java'),...javaFiles(fixture('app-update-jvm')),fixture('UpdateFlowTest.java')],'ai.elizaresearch.alphaphone.UpdateFlowTest'),/^PASS update flow/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Android installs only the offered newer build of this package, and only when no session of Alpha\'s fences the tap',()=>{
 const order=['updatesCommitted.get();','updating.compareAndSet(false,true)','updatesCommitted.get()!=seen','installer.getMySessions()','copyVerified(in,out,size,sha256,deadline);','getPackageArchiveInfo(apk.getPath(),0)','params.setReferrerUri(','installer.createSession(params)','session.fsync(out)','session.setStagingProgress(1f);','updateOwner=this;updateSession=id;','if(Thread.currentThread().isInterrupted())updateOwner=null;','commitAttempted=true;','session.commit(','updatesCommitted.incrementAndGet();','updating.set(false);}\n'].map(step=>install.indexOf(step));
 assert.ok(order.every((at,index)=>at>0&&(index===0||at>order[index-1])),'a tap fences at entry, Android\'s sessions fence it before any download, size, SHA-256 and the archive are admitted before any session changes, a session is bound before Android has it, its commit intent is Android\'s before anything else of the commit, its status can only arrive once it has its owner, the commit boundary is crossed in that order, and a commit is counted before its attempt lets go');
 // One path abandons, a failure of the attempt's own session before its commit, asserted below. Nothing abandons a session Android lists as sealed.
 assert.equal(plugin.match(/abandonSession\(/g).length,1);
 // One commit, the attempt's own first: nothing commits a session a process did not just stage.
 assert.equal(plugin.match(/session\.commit\(/g).length,1);
 // One commit intent, read as an exact 0 so that nothing but Android's own zero clears it, and only on a session bound with the
 // mark, in its boot, on a release build of a level whose AOSP orders that read after the intent (29, 30, 33 to 37). Another
 // boot clears a bound unsealed session; no binding, or a corrupt one, fences sealed or not.
 assert.equal(plugin.match(/setStagingProgress\(/g).length,1);
 assert.equal(plugin.match(/getProgress\(\)==0f/g).length,1);
 assert.ok(install.includes('if(binding!=null&&!listed.isSealed()&&(!binding.group(4).equals(String.valueOf(updateBoot()))||binding.group(5)!=null&&"REL".equals(Build.VERSION.CODENAME)&&(Build.VERSION.SDK_INT<=30||Build.VERSION.SDK_INT>=33&&Build.VERSION.SDK_INT<=37)&&listed.getProgress()==0f))continue;'),'the unsealed fence clears only what is proven');
 assert.ok(plugin.includes('/([0-9a-f]{64})/([0-9]+)(/intent)?");'),'a binding reads with or without the mark');
 assert.ok(install.includes('+"/"+updateBoot()+"/intent";'),'this build binds with the mark');
 assert.doesNotMatch(plugin,/refused\)\{updateOwner=null|commitUpdate|getUpdatedMillis|elapsedRealtime/);
 // Android accepts a same-versionCode reinstall, so the archive must be exactly the offered, newer build of this package.
 assert.match(install,/archive==null\|\|!getContext\(\)\.getPackageName\(\)\.equals\(archive\.packageName\)\|\|archive\.getLongVersionCode\(\)!=versionCode\|\|versionCode<=BuildConfig\.VERSION_CODE\)throw/);
 assert.match(install,/params\.setAppPackageName\(getContext\(\)\.getPackageName\(\)\);/);
 // The status intent reaches only this app's receiver, and Android must be able to add the session result to it.
 assert.match(install,/new Intent\(UPDATE_STATUS\)\.setPackage\(getContext\(\)\.getPackageName\(\)\)/);
 assert.match(install,/PendingIntent\.FLAG_MUTABLE/);
 assert.match(plugin,/registerReceiver\(getContext\(\),updateStatus,new android\.content\.IntentFilter\(UPDATE_STATUS\),androidx\.core\.content\.ContextCompat\.RECEIVER_NOT_EXPORTED\)/);
 assert.match(install,/catch\(Exception failed\)\{\s*if\(!commitAttempted\)try\{installer\.abandonSession\(id\);\}catch\(RuntimeException cleanup\)\{failed\.addSuppressed\(cleanup\);\}\s*throw failed;\s*\}/);
 // The file goes while the flag is held: a delete after it would hit the next attempt's download.
 assert.match(install,/finally\{apk\.delete\(\);updating\.set\(false\);\}/);
 // A check of 404 is an answer, not a failure.
 assert.match(plugin,/if\(status==404\)\{call\.resolve\(new JSObject\(\)\);return;\}\s*if\(status!=200\)throw/);
 assert.match(plugin,/updateConnection\(BuildConfig\.ALPHA_UPDATE_MANIFEST_URL\)/);
 assert.match(plugin,/handleOnDestroy\(\)\{[^}]*updateWorker\.shutdownNow\(\);[^}]*getContext\(\)\.unregisterReceiver\(updateStatus\);[^}]*if\(updateOwner==this\)/);
 assert.doesNotMatch(plugin,/setRequireUserAction|INSTALL_PACKAGES"|toast|Toast/);
});

test('Alpha stays nonprivileged and reads one configured HTTPS manifest from its own rolling release',()=>{
 const manifestXml=readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(manifestXml,/<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/);
 assert.doesNotMatch(manifestXml,/android\.permission\.(INSTALL_PACKAGES|UPDATE_PACKAGES_WITHOUT_USER_ACTION|DELETE_PACKAGES)"/);
 const url=JSON.parse(readFileSync(join(root,'app.config.json'),'utf8')).updateManifestUrl;
 assert.equal(new URL(url).protocol,'https:');
 // Not releases/latest: any newer release of the repository without the manifest would answer 404 and withdraw a valid offer.
 assert.equal(url,'https://github.com/eliza-research/alphaphone/releases/download/app-stable/alpha-update-stable.json');
 const docs=readFileSync(join(root,'docs/android-and-aosp.md'),'utf8');
 assert.ok(docs.includes('`'+url+'`')&&docs.includes('gh release upload app-stable alpha-update-stable.json --repo eliza-research/alphaphone --clobber'),'the runbook publishes to the configured release');
 // Checked only as reads return, so neither the comment nor the runbook may promise a hard interrupt at six hours.
 assert.ok(docs.includes('soft six-hour ceiling')&&!docs.includes('within six hours')&&plugin.includes('Soft ceiling on one update download'),'the six hours are labelled soft');
 assert.match(readFileSync(join(root,'android/app/product.gradle'),'utf8'),/buildConfigField 'String', 'ALPHA_UPDATE_MANIFEST_URL', "\\"\$\{updateManifestUrl\}\\""/);
 for(const file of ['apps/app/src/prototype/settings-adapter.ts','android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java'])assert.ok(!readFileSync(join(root,file),'utf8').includes(url),file);
});
