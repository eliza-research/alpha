package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
import ai.eliza.plugins.agent.runtime.CredentialRequestFence;
import ai.eliza.plugins.agent.runtime.CredentialShutdownLease;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Observes the real request and service-stop leases at public entry points. */
public final class CredentialLeaseTraces {
 static JSONObject shutdown(CredentialShutdownLease lease) throws Exception {
  return Trace.fields("leaseSequence", Trace.read(lease,"sequence"), "leasePending", Trace.read(lease,"pending"),
   "leaseConfirmed", Trace.read(lease,"confirmed"), "leaseAbandoned", Trace.read(lease,"abandoned"));
 }
 static void start(CredentialShutdownLease lease,Trace trace) throws Exception {
  try { lease.beforeStart(); trace.step("serviceStarts",shutdown(lease)); }
  catch(CredentialShutdownLease.Pending expected) { trace.value.getJSONArray("steps").put(new JSONObject()
   .put("label","pending shutdown rejects launch").put("action",Trace.action("serviceStarts").put("reject",true)).put("expect",shutdown(lease))); }
 }
 static JSONObject request(CredentialRequestFence requests,CredentialIntentFence intents,String id) throws Exception {
  Object lease=((Map<?,?>)Trace.read(requests,"requests")).get(id);
  JSONObject out=Trace.fields("ownerEpoch",intents.current(),"requestKnown",lease!=null,"requestBegun",lease!=null&&(Boolean)Trace.read(lease,"begun"));
  if(lease!=null)out.put("s.requestEpoch",Trace.read(lease,"intent"));
  return out;
 }
 public static void main(String[] args)throws Exception {
  JSONArray traces=new JSONArray();
  for(String mode:new String[]{"ack-release","abandon-before-ack","ack-before-abandon","new-owner","false-ack","stale-release"}){
   CredentialShutdownLease lease=new CredentialShutdownLease();Trace trace=new Trace("shutdown-lease-"+mode,shutdown(lease));
   long first=lease.acquire();trace.step("acquireShutdownLease",shutdown(lease));start(lease,trace);
   lease.retry(first);trace.step("retryShutdownLease",shutdown(lease),first);
   if(mode.equals("new-owner")||mode.equals("stale-release")){
    long second=lease.acquire();trace.step("acquireShutdownLease",shutdown(lease));
    lease.acknowledge(first,true);trace.step("acknowledgeShutdownLease",shutdown(lease),first,true);
    if(lease.release(first))throw new AssertionError("stale release");trace.step("releaseShutdownLease",shutdown(lease),first);
    lease.acknowledge(second,true);trace.step("acknowledgeShutdownLease",shutdown(lease),second,true);
    lease.release(second);trace.step("releaseShutdownLease",shutdown(lease),second);
   }else{
    if(mode.equals("abandon-before-ack")){lease.abandon(first);trace.step("abandonShutdownLease",shutdown(lease),first);}
    if(mode.equals("false-ack")){lease.acknowledge(first,false);trace.step("acknowledgeShutdownLease",shutdown(lease),first,false);start(lease,trace);}
    lease.acknowledge(first,true);trace.step("acknowledgeShutdownLease",shutdown(lease),first,true);
    if(mode.equals("ack-before-abandon")){lease.abandon(first);trace.step("abandonShutdownLease",shutdown(lease),first);}
    if(mode.equals("ack-release")||mode.equals("false-ack")){start(lease,trace);lease.release(first);trace.step("releaseShutdownLease",shutdown(lease),first);}
    start(lease,trace);
   }
   traces.put(trace.value);
  }
  for(String mode:new String[]{"cancel-before-begin","cancel-after-begin","unknown-cancel","expiry","finish-wrong","new-intent","stale-begin"}){
   Object lock=new Object();long[] now={0};CredentialIntentFence intents=new CredentialIntentFence(lock);
   CredentialRequestFence requests=new CredentialRequestFence(lock,intents,()->now[0]);
   Trace trace=new Trace("provider-request-"+mode,request(requests,intents,"missing"));
   String id=requests.reserve();trace.step("reserveProviderRequest",request(requests,intents,id));
   if(!mode.equals("cancel-before-begin")&&!mode.equals("expiry")&&!mode.equals("stale-begin")) {requests.begin(id);trace.step("beginProviderRequest",request(requests,intents,id));}
   if(mode.equals("stale-begin")){
    intents.reserve();trace.step("ownerChanged",request(requests,intents,id));
    boolean refused=false;try{requests.begin(id);}catch(IllegalStateException expected){refused=true;}
    if(!refused)throw new AssertionError("stale request admitted");
    trace.step("staleProviderRequestRefused",request(requests,intents,id));
   }
   else if(mode.equals("expiry")){now[0]=120_000_000_000L;requests.cancel("unknown");trace.step("expireProviderRequest",request(requests,intents,id));}
   else if(mode.equals("finish-wrong")){requests.finish(id,999);trace.step("finishProviderRequest",request(requests,intents,id),false);requests.finish(id,1);trace.step("finishProviderRequest",request(requests,intents,id),true);}
   else if(mode.equals("new-intent")){intents.reserve();trace.step("ownerChanged",request(requests,intents,id));requests.cancel(id);trace.step("cancelProviderRequest",request(requests,intents,id),true);}
   else {boolean matching=!mode.equals("unknown-cancel");requests.cancel(matching?id:"unknown");trace.step("cancelProviderRequest",request(requests,intents,id),matching);}
   traces.put(trace.value);
  }
  System.out.println(traces);
 }
}
