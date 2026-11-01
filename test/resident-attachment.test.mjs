// Resident reuse (MVP-16): JVM contract of the native attach decision, the renderer attach
// contract, and structural guards on the plugin's start path. Not emulator or device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
test('an admitted running resident is attached to; any change in runtime, enrollment or provider restarts',{skip:!jsonJar?'Set ALPHA_JSON_JAR or install the pinned Gradle JSON test dependency':false},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'resident-attachment-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/ResidentAttachment.java'),join(root,'test/fixtures/ResidentAttachmentTest.java')],{timeout:120000});
  const output=execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.ResidentAttachmentTest'],{encoding:'utf8',timeout:120000});
  // Two surfaces before enrollment (MVP-16): the pending pairing is not shared; accepted limit.
  assert.match(output,/^PASS pre-enrollment: a second surface before enrollment starts on its own/m);
  assert.match(output,/^PASS resident attachment/m);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('renderer attaches without rebinding the provider and keeps one identity across assistant invocations',()=>{
 assert.match(execFileSync(process.execPath,['--import','tsx','scripts/test-resident-reuse.mjs'],{cwd:root,timeout:120000,encoding:'utf8'}),/PASS resident reuse/);
});
test('the plugin start path attaches before it would retire shared work, and attach never pairs',()=>{
 const source=readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java'),'utf8');
 const start=source.slice(source.indexOf('@PluginMethod public void start('),source.indexOf('@PluginMethod public void cancelStart('));
 const attach=start.indexOf('if(attachLocked(nativeState,currentRoot,currentGeneration)==null)'),retire=start.indexOf('invalidateCalls();admitted=++lifecycleEpoch;');
 assert.ok(attach>0&&retire>attach,'attach admission precedes the full-start retirement');
 const admission=start.slice(attach,retire);
 assert.match(admission,/admitted=lifecycleEpoch;attached=true;/);
 for(const forbidden of ['++lifecycleEpoch','clearEnrollment()','invalidateCalls()','ElizaAgentService.start','startRequestId=','startOwnsLaunch='])
  assert.ok(!admission.includes(forbidden),`attach admission must not ${forbidden}`);
 // The attach worker verifies the runtime and the existing enrollment; it has no pairing call.
 const worker=start.slice(start.indexOf('if(attached){'),start.indexOf('long deadline=android.os.SystemClock.elapsedRealtime()+90000'));
 assert.ok(worker.includes('authenticatedStatus(epoch,root)')&&worker.includes('attachUnverified=true'));
 assert.ok(!worker.includes('enroll(')&&!worker.includes('ElizaAgentService.start')&&!worker.includes('clearEnrollment'));
 // attachLocked supersedes only the calling surface's own work.
 const locked=source.slice(source.indexOf('private String attachLocked('),source.indexOf('private static String storedProviderGeneration('));
 assert.ok(locked.includes('invalidateOwnCalls()')&&!locked.includes('invalidateCalls()')&&!locked.includes('lifecycleEpoch'));
 // Cancelling an attached start is a no-op that precedes owned-launch retirement.
 const cancel=source.slice(source.indexOf('@PluginMethod public void cancelStart('),source.indexOf('static String startupRefusalMessage('));
 assert.ok(cancel.indexOf('if(attachedStarts.remove(requestId)){call.resolve();return;}')>0&&cancel.indexOf('attachedStarts.remove(requestId)')<cancel.indexOf('requestId.equals(startRequestId)'));
 // Attach keeps the epoch, so a request this surface queued before attaching again must still be
 // its pending call before it pairs or is dispatched; the epoch alone would let it through.
 const owned=source.slice(source.indexOf('private void requireOwned('),source.indexOf('private void rejectSuperseded('));
 assert.ok(owned.includes('requireCurrent(epoch)')&&owned.includes('if(!pending.contains(call))throw new Superseded();'));
 const request=source.slice(source.indexOf('@PluginMethod public void request('),source.indexOf('@PluginMethod public void cancelStream('));
 const firstGuard=request.indexOf('requireOwned(call,epoch);'),pairing=request.indexOf('String token=enroll(epoch);'),lastGuard=request.lastIndexOf('requireOwned(call,epoch);'),dispatch=request.indexOf('JSONObject result=raw(path,method,body,token,headers,120000);');
 assert.ok(firstGuard>0&&firstGuard<pairing&&pairing<lastGuard&&lastGuard<dispatch,'owned-call guard precedes pairing and dispatch');
 assert.equal(request.slice(lastGuard,dispatch).trim(),'requireOwned(call,epoch);','nothing runs between the guard and dispatch');
 // The read-only query never mutates lifecycle state.
 const query=source.slice(source.indexOf('@PluginMethod public void residentAttachment('),source.indexOf('@PluginMethod public void configureProvider('));
 for(const forbidden of ['attachLocked(','invalidateOwnCalls','invalidateCalls','lifecycleEpoch','clearEnrollment','ElizaAgentService.start','ElizaAgentService.stop','enroll(','bindCloudProvider'])
  assert.ok(!query.includes(forbidden),`attachment query must not ${forbidden}`);
 // Renderer: resident admission binds through the attach-aware helper, and connect() surfaces the flag.
 const ui=readFileSync(join(root,'apps/app/src/runtime/connection-ui.tsx'),'utf8');
 const admit=ui.slice(ui.indexOf('async function admitCloudResident('),ui.indexOf('async function connectResident('));
 // The shared controller (@elizaos/auth/auth/cloud-resident-binding) binds only an admitted identity
 // through the bind port, which uses the attach-aware helper.
 assert.ok(admit.includes('bindProvider:(credentialId,_signal)=>bindResidentCloudProvider(credentialId),')&&!admit.includes('configureLocalCloudProvider('));
 // Plan admission decides the binding before any bind or attach; Cloud inference is bound only for an admitted plan.
 assert.ok(admit.indexOf('planAdmission(view)')>0&&admit.indexOf('planAdmission(view)')<admit.indexOf('bindResidentCloudProvider'),'plan admission precedes any bind');
 assert.ok(admit.includes("admission.binding==='cloud'&&admission.credentialId&&admission.account?{identity:{credentialId:admission.credentialId,"),'an identity is passed only for an admitted Cloud binding');
});
