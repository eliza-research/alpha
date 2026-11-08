import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeSource,upstreamConnection,javaBinary,jsonJar} from './fixtures/jvm-tools.mjs';
function method(source,name){const a=source.indexOf('@PluginMethod public void '+name+'(');assert.ok(a>=0);const z=source.indexOf('\n }',a);assert.ok(z>a);return source.slice(a,z+3).replace('@PluginMethod ','');}
function run(files,main){assert.ok(jsonJar,'Pinned JSON dependency required; no skipped security proof');const dir=mkdtempSync(join(tmpdir(),'canonical-notification-security-'));try{const paths=files.map(([name,content])=>{const p=join(dir,name);writeFileSync(p,content);return p;});execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',dir,...paths],{stdio:'pipe',timeout:30000});return execFileSync(javaBinary('java'),['-cp',dir+':'+jsonJar,main],{encoding:'utf8',stdio:'pipe',timeout:30000});}finally{rmSync(dir,{recursive:true,force:true});}}
test('actual renderer read/write/remove/CAS methods reject every native notification session namespace',()=>{
 const source=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 const methods=['secureRead','secureWrite','secureRemove','secureCompareExchange'].map(name=>method(source,name)).join('\n');
 const java=`package ai.elizaresearch.alphaphone;
 import java.util.*;import org.json.*;
 class JSObject extends JSONObject {}
 class PluginCall {final JSONObject data=new JSONObject();boolean resolved,rejected;PluginCall(String slot)throws Exception{data.put("slot",slot).put("value","replacement").put("expectedValue",JSONObject.NULL);}String getString(String key){return data.isNull(key)?null:data.optString(key,null);}JSONObject getData(){return data;}void resolve(){resolved=true;}void resolve(JSObject x){resolved=true;}void reject(String... message){rejected=true;}}
 class AlphaCredentialStore {static final String NOTES_DRAFT="notes-draft:v1:device";static class StorageFullException extends Exception{} final Map<String,String> values=new HashMap<>();int effects;void writeCredentialSlot(String n,String v)throws Exception{effects++;values.put(n,v);}String readCredentialSlot(String n)throws Exception{effects++;return values.get(n);}void removeCredentialSlot(String n)throws Exception{effects++;values.remove(n);}boolean compareExchangeCredentialSlot(String n,String e,String v)throws Exception{effects++;if(!Objects.equals(values.get(n),e))return false;if(v==null)values.remove(n);else values.put(n,v);return true;}}
 class ConnectionMethods {static final String STORAGE_FULL_MESSAGE="full",STORAGE_FULL="full";final AlphaCredentialStore store=new AlphaCredentialStore();interface Work{void run()throws Exception;}void submitStorage(PluginCall c,Work w){try{w.run();}catch(Exception e){c.reject("fixture");}}long credentialIntent(String n){return 0;}AlphaCredentialStore storage(){return store;}AlphaCredentialStore storage(long n){return store;}String readCredentialSlot(String n)throws Exception{return store.readCredentialSlot(n);}
 ${methods}
 }
 public class CredentialBoundaryTest {public static void main(String[]args)throws Exception{
 ConnectionMethods bridge=new ConnectionMethods();int checks=0;
 for(String slot:new String[]{"canonical-notification-owner","canonical-notification-owner:v1","canonical-notification-owner:v99:future"})for(String operation:new String[]{"read","write","remove","cas"}){
 bridge.store.values.put(slot,"synthetic-existing-machine");int before=bridge.store.effects;PluginCall call=new PluginCall(slot);
 switch(operation){case "read":bridge.secureRead(call);break;case "write":bridge.secureWrite(call);break;case "remove":bridge.secureRemove(call);break;default:bridge.secureCompareExchange(call);}
 if(!call.rejected||call.resolved||bridge.store.effects!=before||!"synthetic-existing-machine".equals(bridge.store.values.get(slot)))throw new AssertionError(operation+" crossed native boundary");checks++;
 }
 for(String operation:new String[]{"write","read","remove","cas"}){String slot=operation.equals("cas")?"notes-records:v1:device":"device:fixture";PluginCall call=new PluginCall(slot);switch(operation){case "read":bridge.secureRead(call);break;case "write":bridge.secureWrite(call);break;case "remove":bridge.secureRemove(call);break;default:bridge.secureCompareExchange(call);}if(!call.resolved||call.rejected)throw new AssertionError("Allowed operation refused");checks++;}
 System.out.println("PASS renderer native-session boundary "+checks);
 }} `;
 assert.match(run([['SecureSlotPolicy.java',readFileSync(upstreamConnection('SecureSlotPolicy.java'),'utf8')],['RendererCredentialSlots.java',readFileSync(nativeSource('RendererCredentialSlots.java'),'utf8')],['CredentialBoundaryTest.java',java]],'ai.elizaresearch.alphaphone.CredentialBoundaryTest'),/^PASS renderer native-session boundary 16/);
});
test('actual canonical renderer methods recheck foreground after queueing and before exposure or read dispatch',()=>{
 const source=readFileSync(nativeSource('AlphaNotificationsPlugin.java'),'utf8');
 const methods=['canonicalPending','acknowledgeCanonical'].map(name=>method(source,name)).join('\n');
 const java=`package ai.elizaresearch.alphaphone;import java.util.*;import org.json.*;
 class JSObject extends JSONObject {public JSObject put(String key,boolean value)throws JSONException{super.put(key,value);return this;}static JSObject fromJSONObject(JSONObject value){return new JSObject();}}
 class PluginCall {boolean resolved,rejected;String getString(String key,String fallback){return "tap";}void resolve(JSObject x){resolved=true;}void reject(String text){rejected=true;}}
 class NoticeMethods {boolean focused=true,locked,destroyed;final List<Runnable> queue=new ArrayList<>();interface NoticeWork{void run()throws Exception;}Object getContext(){return this;}void requireNoticeForeground()throws Exception{if(!focused||locked||destroyed)throw new SecurityException();}void noticeWork(PluginCall c,String failure,NoticeWork w){queue.add(()->{try{requireNoticeForeground();w.run();}catch(Exception e){c.reject(failure);}});}void drain(){while(!queue.isEmpty())queue.remove(0).run();}
 ${methods}
 }
 class AlphaCanonicalNotifications {interface ForegroundCheck{void current()throws Exception;}static NoticeMethods owner;static int ensures,reads,posts;static boolean lockOnRead,lockInsideAck;static void ensure(Object c){owner=(NoticeMethods)c;ensures++;}static JSONObject pending()throws Exception{reads++;if(lockOnRead)owner.locked=true;return new JSONObject();}static void acknowledge(String token,ForegroundCheck foreground)throws Exception{if(lockInsideAck)owner.locked=true;foreground.current();posts++;}}
 public class ForegroundBoundaryTest {public static void main(String[]args)throws Exception{int checks=0;
 for(String kind:new String[]{"locked","background","destroyed"})for(boolean ack:new boolean[]{false,true}){NoticeMethods n=new NoticeMethods();AlphaCanonicalNotifications.owner=n;int reads=AlphaCanonicalNotifications.reads,posts=AlphaCanonicalNotifications.posts;PluginCall c=new PluginCall();if(ack)n.acknowledgeCanonical(c);else n.canonicalPending(c);if(kind.equals("locked"))n.locked=true;else if(kind.equals("background"))n.focused=false;else n.destroyed=true;n.drain();if(!c.rejected||c.resolved||AlphaCanonicalNotifications.reads!=reads||AlphaCanonicalNotifications.posts!=posts)throw new AssertionError("Queued inactive access");checks++;}
 NoticeMethods read=new NoticeMethods();AlphaCanonicalNotifications.owner=read;AlphaCanonicalNotifications.lockOnRead=true;PluginCall r=new PluginCall();read.canonicalPending(r);read.drain();if(r.resolved||!r.rejected)throw new AssertionError("Locked result exposed");AlphaCanonicalNotifications.lockOnRead=false;checks++;
 NoticeMethods ack=new NoticeMethods();AlphaCanonicalNotifications.owner=ack;AlphaCanonicalNotifications.lockInsideAck=true;int posts=AlphaCanonicalNotifications.posts;PluginCall a=new PluginCall();ack.acknowledgeCanonical(a);ack.drain();if(a.resolved||!a.rejected||AlphaCanonicalNotifications.posts!=posts)throw new AssertionError("Locked read dispatched");AlphaCanonicalNotifications.lockInsideAck=false;checks++;
 NoticeMethods allowed=new NoticeMethods();AlphaCanonicalNotifications.owner=allowed;PluginCall pending=new PluginCall();allowed.canonicalPending(pending);allowed.drain();if(!pending.resolved||pending.rejected)throw new AssertionError("Visible pending refused");checks++;
 PluginCall accepted=new PluginCall();allowed.acknowledgeCanonical(accepted);allowed.drain();if(!accepted.resolved||accepted.rejected)throw new AssertionError("Visible read refused");checks++;
 System.out.println("PASS queued native foreground boundary "+checks);
 }} `;
 assert.match(run([['ForegroundBoundaryTest.java',java]],'ai.elizaresearch.alphaphone.ForegroundBoundaryTest'),/^PASS queued native foreground boundary 10/);
});

test('actual acknowledgment body retains an undispatched tap and never revives an ambiguous POST',()=>{
 const actor=readFileSync(nativeSource('AlphaCanonicalNotifications.java'),'utf8');const start=actor.indexOf(' static void acknowledge('),end=actor.indexOf('\n }\n}',start);assert.ok(start>=0&&end>start);const ack=actor.slice(start,end+3);
 const java=`package ai.elizaresearch.alphaphone;import org.json.*;
 class AlphaLocalAgentPlugin {static int posts;static boolean lose;static JSONObject markNotificationRead(JSONObject session,String id)throws Exception{posts++;if(lose)throw new java.io.IOException("Synthetic lost reply");return new JSONObject().put("status",200);}}
 class AlphaCanonicalNotifications {interface ForegroundCheck{void current()throws Exception;}static AlphaCanonicalNotifications active;static JSONObject pendingTap;final JSONObject session=new JSONObject();void check(){if(active!=this)throw new SecurityException("Retired");}
 ${ack}
 }
 public class ActualAcknowledgmentTest {static int checks;interface Work{void run()throws Exception;}static void rejected(Work work)throws Exception{try{work.run();}catch(Exception expected){checks++;return;}throw new AssertionError("Expected refusal");}static void reset()throws Exception{AlphaCanonicalNotifications.active=new AlphaCanonicalNotifications();AlphaCanonicalNotifications.pendingTap=new JSONObject().put("token","A").put("notificationId","notice-A").put("expiresAt",System.currentTimeMillis()+60000);AlphaLocalAgentPlugin.posts=0;AlphaLocalAgentPlugin.lose=false;}static void check(boolean ok){if(!ok)throw new AssertionError();checks++;}
 public static void main(String[]args)throws Exception{
 reset();rejected(()->AlphaCanonicalNotifications.acknowledge("A",()->{throw new SecurityException("Locked after queue");}));check(AlphaLocalAgentPlugin.posts==0);check("A".equals(AlphaCanonicalNotifications.pendingTap.getString("token")));
 reset();rejected(()->AlphaCanonicalNotifications.acknowledge("A",()->{AlphaCanonicalNotifications.pendingTap=new JSONObject().put("token","B").put("notificationId","notice-B").put("expiresAt",System.currentTimeMillis()+60000);}));check(AlphaLocalAgentPlugin.posts==0);check("B".equals(AlphaCanonicalNotifications.pendingTap.getString("token")));
 reset();rejected(()->AlphaCanonicalNotifications.acknowledge("A",()->{AlphaCanonicalNotifications.active=null;AlphaCanonicalNotifications.pendingTap=null;}));check(AlphaLocalAgentPlugin.posts==0);check(AlphaCanonicalNotifications.pendingTap==null);
 reset();AlphaCanonicalNotifications.acknowledge("A",()->{});check(AlphaLocalAgentPlugin.posts==1);check(AlphaCanonicalNotifications.pendingTap==null);
 reset();AlphaLocalAgentPlugin.lose=true;rejected(()->AlphaCanonicalNotifications.acknowledge("A",()->{}));check(AlphaLocalAgentPlugin.posts==1);check(AlphaCanonicalNotifications.pendingTap==null);
 System.out.println("PASS actual native acknowledgment state "+checks);
 }} `;
 assert.match(run([['ActualAcknowledgmentTest.java',java]],'ai.elizaresearch.alphaphone.ActualAcknowledgmentTest'),/^PASS actual native acknowledgment state/);
});
