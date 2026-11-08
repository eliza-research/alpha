import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';

function declaration(source, signature) {
 const start=source.indexOf(signature);
 assert.notEqual(start,-1,signature);
 let end=source.indexOf('{',start),depth=1;
 for(end++;depth;end++){
  if(source[end]==='{')depth++;
  if(source[end]==='}')depth--;
 }
 return source.slice(start,end);
}

test('delayed provider results cannot cross a lifecycle or permission boundary',()=>{
 const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-native-epoch-'));
 try{
  execFileSync(java('javac'),['--release','11','-d',dir,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/NativeReadEpoch.java'),join(root,'test/fixtures/NativeReadEpochTest.java')],{timeout:60000});
  assert.match(execFileSync(java('java'),['-cp',dir,'ai.elizaresearch.alphaphone.NativeReadEpochTest'],{encoding:'utf8',timeout:15000}),/PASS native read publication fences/);
  const media=join(preparePatchedNative({root}).root,'plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');
  const photos=readFileSync(join(media,'PhotosPlugin.java'),'utf8');
  for(const name of ['list','read','summary','albums','beginEdit','previewEdit','thumbnails']){
   const method=declaration(photos,`public void ${name}(PluginCall call)`);
   assert.match(method,/submitRead\(call,/);
   assert.doesNotMatch(method,/call\.resolve\(/);
  }
  const facade=readFileSync(join(media,'DeviceLibraryPlugin.java'),'utf8');
  assert.equal((facade.match(/catalog\.publish\(call,/g)||[]).length,3);
  assert.match(readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotosPlugin.java'),'utf8'),/extends PhotosPlugin \{/);
  assert.match(readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotoLibraryPlugin.java'),'utf8'),/extends DeviceLibraryPlugin \{/);

  // Run the exact staging gate and catalog publication methods against controlled worker and
  // main-thread queues. Only MediaStore access and the Capacitor response sink are fixtures.
  const catalog=readFileSync(join(media,'PermittedMediaCatalog.java'),'utf8');
  const base=readFileSync(join(media,'PermittedPhotosPlugin.java'),'utf8');
  const methods=[
   'public void foreground(boolean value)', 'private synchronized void checkReadAccess()',
   'public long readTicket()', 'public void requireReadTicket(long ticket)',
   'public void publish(com.getcapacitor.PluginCall call, JSObject value, long ticket,',
   'public void invalidate()',
  ].map(signature=>declaration(catalog,signature).replace('com.getcapacitor.PluginCall','PluginCall'));
  const source=join(dir,'PhotoPublicationHarness.java');
  writeFileSync(source,`import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicLong;

public class PhotoPublicationHarness {
  static final class JSObject {}
  static final class PluginCall {
    int responses, rejections;
    void resolve(JSObject value) { responses++; }
    void reject(String message) { rejections++; }
  }
  static final class Queue {
    final ArrayDeque<Runnable> jobs = new ArrayDeque<>();
    void post(Runnable job) { jobs.add(job); }
    void drain() { while (!jobs.isEmpty()) jobs.remove().run(); }
  }
  static final class Catalog {
    final AtomicLong epoch = new AtomicLong();
    final java.util.Map<String, JSObject> pages = new java.util.HashMap<>();
    final Queue main = new Queue();
    boolean foreground = true;
    String permission = "selected", lastReadAccess = "";
    String access() { return permission; }
    void unlocked() { if (!foreground) throw new SecurityException("background"); }
    ${methods.join('\n')}
  }
  static final class Host {
    final Catalog permitted = new Catalog();
    final Queue worker = new Queue();
    int completions, reads;
    void submit(PluginCall call, Runnable action) { worker.post(action); }
    ${declaration(base,'protected interface ReadAction')}
    ${declaration(base,'protected final void submitRead(PluginCall call, ReadAction action, Runnable onPublished)')}
    PluginCall read() {
      PluginCall call = new PluginCall();
      submitRead(call, () -> { reads++; return new JSObject(); }, () -> completions++);
      return call;
    }
  }
  static void check(boolean value, String why) { if (!value) throw new AssertionError(why); }
  public static void main(String[] args) {
    Host host = new Host();
    PluginCall normal = host.read();
    host.worker.drain();
    check(normal.responses == 0 && host.completions == 0, "no early response or diagnostic");
    host.permitted.main.drain();
    check(normal.responses == 1 && normal.rejections == 0 && host.completions == 1, "current result");

    PluginCall beforeWorker = host.read();
    host.permitted.permission = "denied";
    host.worker.drain();
    host.permitted.main.drain();
    check(beforeWorker.responses == 0 && beforeWorker.rejections == 1 && host.reads == 1, "pre-read revoke");

    host.permitted.permission = "selected";
    PluginCall beforePublish = host.read();
    host.worker.drain();
    host.permitted.permission = "denied";
    host.permitted.main.drain();
    check(beforePublish.responses == 0 && beforePublish.rejections == 1 && host.completions == 1, "late revoke");

    host.permitted.permission = "selected";
    PluginCall fromOldScreen = host.read();
    host.worker.drain();
    host.permitted.foreground(false);
    host.permitted.foreground(true);
    host.permitted.main.drain();
    check(fromOldScreen.responses == 0 && fromOldScreen.rejections == 1 && host.completions == 1, "leave and return");

    PluginCall alreadyRejected = new PluginCall();
    host.submitRead(alreadyRejected, () -> { alreadyRejected.reject("unavailable"); return null; }, () -> host.completions++);
    host.worker.drain();
    host.permitted.main.drain();
    check(alreadyRejected.responses == 0 && alreadyRejected.rejections == 1 && host.completions == 1, "single rejection");

    PluginCall fresh = host.read();
    host.worker.drain();
    host.permitted.main.drain();
    check(fresh.responses == 1 && fresh.rejections == 0 && host.completions == 2, "new request recovers");
    System.out.println("PASS photo publication fences and single responses");
  }
}`);
  execFileSync(java('javac'),['--release','11','-d',dir,source],{timeout:60000});
  assert.match(execFileSync(java('java'),['-cp',dir,'PhotoPublicationHarness'],{encoding:'utf8',timeout:15000}),/PASS photo publication fences and single responses/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
