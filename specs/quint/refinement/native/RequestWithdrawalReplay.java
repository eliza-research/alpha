package ai.alphacompute.alphaphone;

import java.nio.file.*;
import org.json.*;

/** Actions, never model states, enter this process. Every observation comes from the actual
 * request runnable, call callbacks, withdrawal registry and controlled worker-port entries. */
public final class RequestWithdrawalReplay {
 static String id(int request){return String.format("00000000-0000-4000-8000-%012d",request);}
 static JSObject input(int request){return new JSObject().put("path","/api/status").put("method","GET")
  .put("headers",new JSONObject().put("Accept","application/json")).put("timeoutMs",120000).put("cancelId",id(request));}
 static JSONObject observe(WithdrawalHost host,PluginCall cancellation){
  synchronized(WithdrawalHost.lifecycleLock){
   WithdrawalHost.check(host.failure.get()==null,"Unexpected worker failure: "+host.failure.get());
   JSONObject phase=new JSONObject(),call=new JSONObject(),withdrawnAt=new JSONObject(),answers=new JSONObject();
   JSONObject dispatches=new JSONObject(),enrollments=new JSONObject(),callbacks=new JSONObject(),inputs=new JSONObject();
   JSONArray registered=new JSONArray(),sent=new JSONArray();int running=0;
   for(int request=1;request<=3;request++){
    String key=String.valueOf(request);WithdrawalHost.Work item=host.work.get(request);PluginCall bridge=host.calls[request];
    phase.put(key,host.phase(request));call.put(key,host.callState(request));
    withdrawnAt.put(key,bridge==null?"none":bridge.withdrawnAt);answers.put(key,bridge==null?0:bridge.resolves+bridge.rejects);
    int dispatchCount=item==null?0:item.dispatches.get(),enrollmentCount=item==null?0:item.enrollments.get();
    dispatches.put(key,dispatchCount);enrollments.put(key,enrollmentCount);
    WithdrawalHost.check(dispatchCount<=1&&enrollmentCount<=1,"Independent port entry counts");
    if(item!=null&&item.started&&!item.finished)running++;
    if(dispatchCount>0)sent.put(request);
    if(host.withdrawable.containsKey(id(request)))registered.put(request);
    if(bridge!=null){inputs.put(key,bridge.data);callbacks.put(key,new JSONObject().put("resolves",bridge.resolves)
      .put("rejects",bridge.rejects).put("code",bridge.code==null?JSONObject.NULL:bridge.code)
      .put("reason",bridge.reason==null?JSONObject.NULL:bridge.reason)
      .put("result",bridge.result==null?JSONObject.NULL:bridge.result));}
   }
   WithdrawalHost.check(running<=2,"Two actual worker slots");
   JSONObject observation=new JSONObject().put("phase",phase).put("call",call).put("withdrawable",registered)
    .put("sent",sent).put("withdrawnAt",withdrawnAt).put("answers",answers).put("nativeOutcome",host.outcome)
    .put("eventSerial",host.eventSerial).put("dispatches",dispatches).put("enrollments",enrollments)
    .put("callbacks",callbacks).put("inputs",inputs).put("running",running);
   if(cancellation!=null)observation.put("cancellation",new JSONObject().put("input",cancellation.data).put("result",cancellation.result));
   return observation;
  }
 }
 public static void main(String[] args)throws Exception{
  JSONArray schedule=new JSONArray(Files.readString(Path.of(args[0]))),observations=new JSONArray();
  WithdrawalHost host=new WithdrawalHost();
  try{
   for(int at=0;at<schedule.length();at++){
    JSONObject command=schedule.getJSONObject(at);String action=command.getString("action");
    int request=command.optJSONObject("picks")==null?0:command.getJSONObject("picks").optInt("r",0);
    PluginCall cancellation=null;
    switch(action){
     case "init":break;
     case "request":host.admit(request,input(request));break;
     case "take":host.take(request);break;
     case "dispatch":host.dispatch(request);break;
     case "transportAnswers":host.transportAnswers(request);break;
     case "cancelRequest":cancellation=host.cancel(id(request));break;
     case "supersede":host.supersede();break;
     case "abort":case "check":case "":break; // renderer-only or a pure assertion boundary
     default:throw new AssertionError("Unrecognized action "+action);
    }
    observations.put(observe(host,cancellation));
   }
  }finally{host.close();}
  System.out.println(observations);
 }
}
