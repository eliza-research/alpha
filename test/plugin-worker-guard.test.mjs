// Worker shutdown guard (AP-01/AP-02). Class S plus a host-JVM run of the shared helper; nothing here
// runs on Android. Capacitor can deliver a bridge call the page made just before the activity was
// destroyed after a plugin's handleOnDestroy stopped its worker. Executor.execute then throws
// RejectedExecutionException on the bridge thread and the process dies (AlphaDevicePlugin, round 8,
// a326b8dd). Every plugin that stops a worker must hand work to it only through PluginWorkers.submit,
// which answers the call instead of throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeSource,fixture,runJvm} from './fixtures/jvm-tools.mjs';

test('the shared guard refuses work for a stopped, shut-down or full worker without throwing',()=>{
 assert.match(runJvm([nativeSource('PluginWorkers.java'),fixture('PluginWorkersTest.java')],'ai.elizaresearch.alphaphone.PluginWorkersTest'),/^PASS plugin workers/);
});

// Each plugin and the workers it owns or borrows. worker() is the upstream ActionJournalPlugin's
// journal worker. AlphaNotificationsPlugin has no worker of its own: the upstream
// NotificationsHostPlugin owns its NoticeWorker and guards it with NoticeWorker.submit.
const plugins={
 AlphaActionJournalPlugin:['worker()'],
 AlphaConnectionPlugin:['workers'],
 AlphaDevicePlugin:['diagnosticsWorker','updateWorker'],
 AlphaFilesPlugin:['worker'],
 AlphaHostedResultsPlugin:['io'],
 AlphaLocalAgentPlugin:['workers','voiceWorkers','rendererWorkers'],
 AlphaMailAttachmentsPlugin:['worker'],
 AlphaMapsTransportPlugin:['workers','closers','deadlines'],
 AlphaNoteAudioPlugin:['migrationWorker'],
 AlphaNoteDocumentsPlugin:['worker'],
};
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

for(const [name,workers] of Object.entries(plugins)){
 test(`${name}: every worker dispatch goes through PluginWorkers.submit`,()=>{
  const source=readFileSync(nativeSource(`${name}.java`),'utf8');
  assert.match(source,/protected void handleOnDestroy\(\)/,`${name} has a destroy path`);
  for(const worker of workers){
   const raw=[...source.matchAll(new RegExp(`(?<![\\w.])${escape(worker)}\\.(execute|submit|invokeAll|invokeAny)\\(`,'g'))];
   assert.deepEqual(raw.map(match=>match[0]),[],`${name} hands work to ${worker} only through PluginWorkers.submit`);
  }
  const guarded=[...source.matchAll(/PluginWorkers\.submit\(([^,]+),/g)].map(match=>match[1]);
  assert.ok(guarded.length>0,`${name} uses the guard`);
  for(const worker of guarded)assert.ok(workers.includes(worker),`${name} guards only its known workers (${worker})`);
 });
}

test('the Maps deadline scheduler is the one dispatch that cannot use Executor and keeps its own catch',()=>{
 const source=readFileSync(nativeSource('AlphaMapsTransportPlugin.java'),'utf8');
 const request=source.slice(source.indexOf('@PluginMethod public void request('),source.indexOf('@PluginMethod public void cancel('));
 const schedule=request.indexOf('deadlines.schedule(');
 assert.ok(schedule>0&&request.lastIndexOf('try{',schedule)>0,'deadlines.schedule runs inside a try');
 assert.match(request.slice(schedule),/\}catch\(RejectedExecutionException busy\)\{[^\n]*pending\.remove\(id,job\);job\.cancel\(/,'and a stopped scheduler cancels the job instead of throwing');
});

test('every worker a plugin declares is listed and checked above',()=>{
 for(const name of Object.keys(plugins)){
  const source=readFileSync(nativeSource(`${name}.java`),'utf8');
  const declared=[...source.matchAll(/(?:ExecutorService|ThreadPoolExecutor|NoticeWorker)\s+(\w+)\s*=/g)].map(match=>match[1]);
  for(const worker of declared)assert.ok(plugins[name].includes(worker),`${name}.${worker} is listed`);
 }
});

test('the shared Photos bridge Alpha registers answers a call for a stopped worker instead of throwing',()=>{
 // AlphaPhotosPlugin and AlphaPhotoLibraryPlugin are registrations of plugin-native-media's PhotosPlugin and
 // DeviceLibraryPlugin and own no worker; the shared plugins catch the refusal themselves.
 for(const name of ['AlphaPhotosPlugin','AlphaPhotoLibraryPlugin'])assert.doesNotMatch(readFileSync(nativeSource(`${name}.java`),'utf8'),/ExecutorService|\.execute\(/);
 const shared=name=>readFileSync(new URL(`../vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/${name}.java`,import.meta.url),'utf8');
 const photos=shared('PhotosPlugin'),library=shared('DeviceLibraryPlugin');
 const submit=photos.slice(photos.indexOf('  private void submit(PluginCall call, Runnable action) {'),photos.indexOf('  static void requireLibraryAliases('));
 assert.match(submit,/try \{\n {6}worker\.execute\([\s\S]*\} catch \(RejectedExecutionException stopped\) \{\n {6}call\.reject\("Photo library closed"\);/);
 assert.equal([...photos.matchAll(/worker\.execute\(/g)].length,2,'submit and the destroy-time close only');
 assert.match(photos,/try \{\n {6}worker\.execute\(\(\) -> \{\n {8}if \(edits != null\) edits\.close\(\);\n {6}\}\);\n {4}\} catch \(RejectedExecutionException stopped\)/);
 const facade=library.slice(library.indexOf('  private void submit(PluginCall call, ReadAction action) {'),library.indexOf('  private boolean locked()'));
 assert.match(facade,/worker\.execute\([\s\S]*\} catch \(RuntimeException stopped\) \{[\s\S]*call\.reject\("Device library closed"\);/);
 assert.equal([...library.matchAll(/worker\.execute\(/g)].length,1);
});

test('the shared speech bridge AlphaVoiceCloudPlugin subclasses answers a stopped or full worker the same way',()=>{
 const base=readFileSync('vendor/eliza/plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice/LocalSpeechBridgePlugin.java','utf8');
 assert.match(base,/private boolean submitWork\(Runnable work,Runnable refused\)\{\n  try\{workers\.execute\(work\);return true;\}catch\(RejectedExecutionException stopped\)\{refused\.run\(\);return false;\}/);
 assert.deepEqual([...base.matchAll(/workers\.(execute|submit|invokeAll|invokeAny)\(/g)].length,1,'the bridge worker is used only inside submitWork');
 assert.doesNotMatch(readFileSync(nativeSource('AlphaVoiceCloudPlugin.java'),'utf8'),/ExecutorService|ThreadPoolExecutor|\.execute\(/,'the Alpha subclass owns no worker');
});
