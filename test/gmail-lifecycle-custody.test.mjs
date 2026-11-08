import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {runJvm,nativeSource} from './fixtures/jvm-tools.mjs';
function method(source,signature){const at=source.indexOf(signature);assert.ok(at>=0,signature);let depth=0;for(let i=source.indexOf('{',at);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0)return source.slice(at,i+1);}throw Error(signature);}
test('actual Gmail capture retries only the newest intent and foreground checks never post while holding lifecycle',()=>{
 const source=readFileSync(nativeSource('AlphaGmailPlugin.java'),'utf8'),dir=mkdtempSync(join(tmpdir(),'gmail-custody-'));const file=(name,s)=>{const p=join(dir,name);writeFileSync(p,s);return p;};
 try{const paths=[file('Activity.java','package android.app;public class Activity{public static int posts;public void runOnUiThread(Runnable action){posts++;action.run();}public boolean isFinishing(){return false;}public boolean isDestroyed(){return false;}public boolean hasWindowFocus(){return true;}}'),file('GmailCustody.java',`package ai.elizaresearch.alphaphone;
import java.util.*;import java.util.concurrent.*;
public class GmailCustody {
 static class Intent {String key;boolean fail;Intent(String key){this.key=key;}void setData(Object value){key=null;}}
 static class JSObject{} static class KeyguardManager{boolean isDeviceLocked(){return false;}}
 static class Context {<T>T getSystemService(Class<T> type){return type.cast(new KeyguardManager());}}
 static class Queue {ArrayDeque<Runnable> tasks=new ArrayDeque<>();void execute(Runnable task){tasks.add(task);}void run(){tasks.remove().run();}}
 static class MailNoticePoster {static class Tap{String key;boolean question;Tap(String key){this.key=key;}}Tap tap(Intent i){return i.key==null?null:new Tap(i.key);}}
 static class GmailBackground{static MailNoticePoster poster(Context context){return new MailNoticePoster();}}
 class Delivery {void capture(String key,boolean question)throws Exception{if(onCapture!=null){Runnable callback=onCapture;onCapture=null;callback.run();}if(failed.contains(key))throw new Exception("unavailable");captured.add(key);}}
 final Queue io=new Queue();final List<String> captured=new ArrayList<>();final Set<String> failed=new HashSet<>();final Delivery delivery=new Delivery();
 volatile Intent retained,latest;long lifecycle=3;int notifications,resumes;Runnable onCapture;android.app.Activity activity=new android.app.Activity();
 android.app.Activity getActivity(){return activity;}Context getContext(){return new Context();}Delivery delivery(){return delivery;}void notifyListeners(String name,JSObject value,boolean keep){notifications++;}void resumeDelivery(boolean notify){resumes++;}
 ${method(source,'private boolean foreground(')}
 ${method(source,'private void requireForeground(')}
 ${method(source,'private void capture(')}
 ${method(source,'protected void handleOnResume(')}
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[]args)throws Exception{
  GmailCustody h=new GmailCustody();h.requireForeground(3);check(android.app.Activity.posts==0,"foreground never waits for main under the lifecycle lock");try{h.requireForeground(2);throw new AssertionError("stale allowed");}catch(SecurityException expected){}h.activity=null;try{h.requireForeground(3);throw new AssertionError("closed allowed");}catch(SecurityException expected){}
  h=new GmailCustody();Intent old=new Intent("old");h.failed.add("old");h.capture(old);h.io.run();check(h.retained==old,"failure retained");h.failed.clear();h.handleOnResume();h.io.run();check(h.captured.equals(List.of("old"))&&h.retained==null&&h.notifications==1,"resume retains once");
  h=new GmailCustody();old=new Intent("old");Intent newer=new Intent("new");h.failed.add("old");h.capture(old);h.io.run();h.capture(newer);h.io.run();h.handleOnResume();check(h.captured.equals(List.of("new"))&&h.retained==null&&h.io.tasks.isEmpty(),"new success retires old retry");
  h=new GmailCustody();h.capture(new Intent("old"));h.capture(new Intent("new"));h.io.run();h.io.run();check(h.captured.equals(List.of("new")),"queued stale intent skipped");
  h=new GmailCustody();final GmailCustody race=h;h.failed.add("old");h.capture(new Intent("old"));h.onCapture=()->race.capture(new Intent("new"));h.io.run();check(h.retained==null,"old failure cannot overwrite newer custody");h.io.run();check(h.captured.equals(List.of("new"))&&h.notifications==1,"newest event wins");
  System.out.println("PASS Gmail current intent custody and foreground lifecycle");
 }
}`)];assert.match(runJvm(paths,'ai.elizaresearch.alphaphone.GmailCustody'),/^PASS Gmail/);}finally{rmSync(dir,{recursive:true,force:true});}
});
