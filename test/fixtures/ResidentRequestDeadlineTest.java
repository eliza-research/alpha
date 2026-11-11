package ai.alphacompute.alphaphone;

import android.os.SystemClock;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.Executor;
import org.json.JSONObject;

/** The production request body and owner fencing run with a closed enrollment, worker and IPC. */
public class ResidentRequestDeadlineTest {
 static final String PATH="/api/notes/state";
 static final String TIMEOUT="Local agent request timed out before dispatch.";
 static final Object lifecycleLock=new Object();
 static long lifecycleEpoch=1;
 final Set<PluginCall> pending=new HashSet<>();
 final Map<String,PluginCall> withdrawable=new HashMap<>();
 final ArrayDeque<Runnable> queued=new ArrayDeque<>();
 final Executor workers=queued::addLast;
 boolean disposed,accepting=true;
 String ownerIdentity="owner";
 long enrollMs;
 int enrollCount;
 String enroll(long epoch){enrollCount++;SystemClock.now+=enrollMs;return "owner-token";}
 Context getContext(){return new Context();}
 void clearEnrollment(){throw new AssertionError("Successful request cleared enrollment");}
 private static final class Superseded extends Exception {}
 // Production request methods.

 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 static PluginCall notes(){return new PluginCall(new JSONObject().put("path",PATH).put("ownerId","owner"));}
 static PluginCall bounded(Object value){PluginCall call=notes();call.data.put("timeoutMs",value);return call;}
 static ResidentRequestDeadlineTest fresh(){
  SystemClock.now=10_000;
  ElizaAgentService.last=null;
  ElizaAgentService.calls=0;
  return new ResidentRequestDeadlineTest();
 }
 void noDispatch(PluginCall call,String message){
  check(message.equals(call.error)&&call.replies==1,"Expected one refusal: "+message+"; got "+call.error);
  check(ElizaAgentService.calls==0&&pending.isEmpty()&&queued.isEmpty(),"Refusal dispatched or retained native work");
 }
 void sent(PluginCall call,int ms){
  check(call.error==null&&call.replies==1&&call.result.getInt("status")==200,"Expected one successful reply");
  check(ElizaAgentService.calls==1&&pending.isEmpty()&&queued.isEmpty(),"Expected one settled native dispatch");
  JSONObject envelope=ElizaAgentService.last;
  check(envelope.getInt("timeoutMs")==ms,"Unexpected dispatched budget: "+envelope);
  check(PATH.equals(envelope.getString("path"))&&"GET".equals(envelope.getString("method")),"Request route changed");
  check("Bearer owner-token".equals(envelope.getJSONObject("headers").getString("Authorization")),"Owner authority changed");
 }

 public static void main(String[] args){
  ResidentRequestDeadlineTest fixture=fresh();
  PluginCall call=bounded(20_000);
  fixture.enrollMs=700;
  fixture.request(call);
  SystemClock.now+=300;
  fixture.queued.removeFirst().run();
  fixture.sent(call,19_000);

  for(Object invalid:new Object[]{"2000",true,1.5,JSONObject.NULL}){
   fixture=fresh();call=bounded(invalid);fixture.request(call);
   fixture.noDispatch(call,"Invalid local agent request timeout.");
   check(fixture.enrollCount==0,"Invalid input admitted enrollment");
  }
  for(int unavailable:new int[]{-1,0,999}){
   fixture=fresh();call=bounded(unavailable);fixture.request(call);
   fixture.noDispatch(call,TIMEOUT);
   check(fixture.enrollCount==0,"Insufficient input admitted enrollment");
  }

  fixture=fresh();call=bounded(5_000);fixture.request(call);
  SystemClock.now+=5_000;
  fixture.queued.removeFirst().run();
  fixture.noDispatch(call,TIMEOUT);
  check(fixture.enrollCount==0,"Expired queued request entered enrollment");

  fixture=fresh();
  call=new PluginCall(new JSONObject().put("path","/api/conversations")
    .put("method","POST").put("ownerId","owner").put("body","{}").put("timeoutMs",5_000));
  fixture.request(call);
  SystemClock.now+=5_000;
  fixture.queued.removeFirst().run();
  fixture.noDispatch(call,TIMEOUT);
  check(fixture.enrollCount==0,"Expired mutation entered enrollment");

  fixture=fresh();call=bounded(5_000);fixture.enrollMs=4_001;fixture.request(call);
  fixture.queued.removeFirst().run();
  fixture.noDispatch(call,TIMEOUT);
  check(fixture.enrollCount==1,"Fixture did not expire during enrollment");

  fixture=fresh();call=bounded(1_000);fixture.request(call);
  fixture.queued.removeFirst().run();
  fixture.sent(call,1_000);

  fixture=fresh();call=bounded(600_000L);fixture.request(call);
  SystemClock.now+=500;
  fixture.queued.removeFirst().run();
  fixture.sent(call,119_500);

  fixture=fresh();call=notes();fixture.request(call);
  SystemClock.now+=125_000;
  fixture.queued.removeFirst().run();
  fixture.sent(call,120_000);

  fixture=fresh();call=bounded(5_000);fixture.request(call);
  fixture.ownerIdentity="another-owner";
  fixture.queued.removeFirst().run();
  check(call.replies==1&&call.result.getInt("status")==409&&ElizaAgentService.calls==0&&fixture.pending.isEmpty(),
    "An explicit budget weakened the owner guard");

  fixture=fresh();call=bounded(5_000);fixture.request(call);lifecycleEpoch++;
  fixture.queued.removeFirst().run();
  check(call.replies==1&&"LOCAL_AGENT_EPOCH_CHANGED".equals(call.code)&&ElizaAgentService.calls==0&&fixture.pending.isEmpty(),
    "An explicit budget weakened the lifecycle guard");
  fixture=fresh();call=bounded(1_000);call.data.put("cancelId","11111111-1111-4111-8111-111111111111");fixture.request(call);
  SystemClock.now+=1_000;fixture.queued.removeFirst().run();fixture.noDispatch(call,TIMEOUT);
  check(fixture.withdrawable.isEmpty(),"An expired request retained its withdrawal identity");
  System.out.println("PASS resident explicit deadline, legacy dispatch budget, owner and lifecycle");
 }
}
@interface PluginMethod {}
class JSObject extends JSONObject {
 JSObject(){super();}
 JSObject(String value){super(value);}
 @Override public JSObject put(String name,int value){super.put(name,value);return this;}
 @Override public JSObject put(String name,boolean value){super.put(name,value);return this;}
 @Override public JSObject put(String name,Object value){super.put(name,value);return this;}
}
class PluginCall {
 final JSONObject data; int replies; String error,code; JSONObject result;
 PluginCall(JSONObject data){this.data=data;}
 String getString(String name,String fallback){return data.optString(name,fallback);}
 String getString(String name){return getString(name,null);}
 JSONObject getObject(String name){return data.optJSONObject(name);}
 JSONObject getData(){return data;}
 void resolve(JSObject result){replies++;this.result=result;}
 void reject(String message){reject(message,null);}
 void reject(String message,String reason){replies++;error=message;code=reason;}
}
class Context {Assets getAssets(){return new Assets();}}
class Assets {InputStream open(String name){throw new AssertionError(name);}}
class OwnerRoutes {
 interface ReadAsset {InputStream open(String name);}
 static OwnerRoutes shipped(ReadAsset assets){return new OwnerRoutes();}
 String group(String path){return ResidentRequestDeadlineTest.PATH.equals(path)?"records":null;}
 boolean allowed(String group,String path,String method){return "GET".equals(method);}
}
class PreparedViewNavigation {
 static boolean allowed(String path,String method,String body){throw new AssertionError(path);}
}
class ElizaAgentService {
 static JSONObject last;
 static int calls;
 static String localAgentToken(){throw new AssertionError("Unexpected ASR route");}
 static String requestLocalAgent(String envelope){
  calls++;last=new JSONObject(envelope);
  return "{\"status\":200,\"body\":\"{}\"}";
 }
}
