// Compile the actual bridge method. Only its Capacitor/transport ports are finite fixtures;
// the admission gate, stream accounting and worker handoff are production source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

test('chat stream admission rejects reserved feed IDs and retains the two-stream cap', {skip:jsonJarSkip},()=>{
 const source=fs.readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const start=source.indexOf(' @PluginMethod public void requestStream(');
 const end=source.indexOf(' /** A single ephemeral voice-only feed',start);
 assert.ok(start>=0&&end>start,'Actual chat stream method must exist');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stream-admission-'));
 try {
  const file=path.join(dir,'StreamAdmissionTest.java');
  fs.writeFileSync(file,`package ai.elizaresearch.alphaphone;
import java.util.*;import java.util.concurrent.*;import org.json.*;
@interface PluginMethod {}
class JSObject extends JSONObject {JSObject put(String k,String v){super.put(k,v);return this;}public JSObject put(String k,Object v){super.put(k,v);return this;}}
class PluginCall {Map<String,String> values=new HashMap<>();int resolves,rejects;String getString(String k,String d){return values.getOrDefault(k,d);}JSONObject getObject(String k){return null;}void resolve(JSObject value){resolves++;}void reject(String why){rejects++;}}
class ElizaAgentService {static class LocalStreamHandle {void cancel(){}}static void requestLocalAgentStream(String input,java.util.function.Consumer<String> receive,LocalStreamHandle handle){throw new AssertionError("Fixture must not execute queued transport");}}
public class StreamAdmissionTest {
 final Object lifecycleLock=new Object();final Map<String,ElizaAgentService.LocalStreamHandle> streams=new HashMap<>();final Map<String,Runnable> streamInvalidators=new HashMap<>();final List<Runnable> queued=new ArrayList<>();final Executor workers=queued::add;String ownerIdentity="owner";
 static class Superseded extends Exception {}long admittedEpoch(){return 1;}void requireCurrent(long epoch){}String enroll(long epoch){return "fixture";}void clearEnrollment(){}void notifyListeners(String name,JSObject data){}
 ${source.slice(start,end)}
 static PluginCall call(String id){PluginCall c=new PluginCall();c.values.put("streamId",id);c.values.put("ownerId","owner");c.values.put("path","/api/conversations/room/messages/stream");c.values.put("body","{}");return c;}
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args){
  StreamAdmissionTest host=new StreamAdmissionTest();
  host.streams.put("voice-subscription",new ElizaAgentService.LocalStreamHandle());host.streams.put("view-subscription",new ElizaAgentService.LocalStreamHandle());
  for(String prefix:new String[]{"voice-","view-"}){PluginCall c=call(prefix+"11111111-1111-4111-8111-111111111111");host.requestStream(c);check(c.rejects==1&&c.resolves==0,"Reserved prefix admitted: "+prefix);}
  check(host.queued.isEmpty()&&host.streams.size()==2,"Reserved ID created work");
  String first="11111111-1111-4111-8111-111111111111",second="22222222-2222-4222-8222-222222222222",third="33333333-3333-4333-8333-333333333333";
  for(String id:new String[]{first,second}){PluginCall c=call(id);host.requestStream(c);check(c.resolves==1&&c.rejects==0,"Normal UUID refused");}
  check(host.queued.size()==2&&host.streams.size()==4,"Feed subscriptions consumed chat slots");
  PluginCall full=call(third);host.requestStream(full);check(full.rejects==1&&full.resolves==0,"Third chat stream admitted");
  PluginCall duplicate=call(first);host.requestStream(duplicate);check(duplicate.rejects==1&&duplicate.resolves==0,"Duplicate stream admitted");
  check(host.queued.size()==2&&host.streams.size()==4,"Refusal queued additional work");
  StreamAdmissionTest duplicateHost=new StreamAdmissionTest();PluginCall original=call(first);duplicateHost.requestStream(original);PluginCall collision=call(first);duplicateHost.requestStream(collision);check(original.resolves==1&&collision.rejects==1&&duplicateHost.queued.size()==1,"Duplicate check depends on full cap");
  System.out.println("PASS reserved feed IDs refused; normal UUIDs retain two chat slots and duplicate refusal");
 }
}`);
  assert.match(runJvm([file,nativeSource('PluginWorkers.java')],'ai.elizaresearch.alphaphone.StreamAdmissionTest',{json:true}),/^PASS reserved feed IDs/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
