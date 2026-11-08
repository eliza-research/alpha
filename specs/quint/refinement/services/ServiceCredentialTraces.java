package ai.elizaresearch.alphaphone;
import android.content.Context;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ServiceCredentialTraces {
 static void reset() { JsonCredentialSlots.VALUES.clear(); AlphaLocalAgentPlugin.requested=false; AlphaLocalAgentPlugin.beforeCommit=()->{}; }
 static void put(String key,String value) { JsonCredentialSlots.VALUES.put(CloudDeployment.storageSlot(key),value); }
 static String get(String key) { return JsonCredentialSlots.VALUES.get(CloudDeployment.storageSlot(key)); }
 static JSONArray traces()throws Exception {
  JSONArray result=new JSONArray();
  for(boolean conflict:new boolean[]{false,true}) {
   reset();String before="{\"key\":\"old\"}",after="{\"key\":\"new\"}";
   put("cloud:production",before);put(LocalAgentProviderAdmission.PROVIDER_SLOT,"{\"environment\":\"production\",\"admissionGeneration\":\"old\",\"admissionFingerprint\":\"old\"}");
   AlphaCredentialStore store=new AlphaCredentialStore(new Context());
   Trace trace=new Trace("real-slot-mutation-provider-race-"+conflict,Trace.fields("credential",get("cloud:production").equals(before)?1:2));
   AlphaLocalAgentPlugin.beforeCommit=()->{if(conflict)put(LocalAgentProviderAdmission.PROVIDER_SLOT,"{\"environment\":\"production\",\"revision\":2}");};
   boolean rejected=false;
   try { store.compareExchangeCredentialSlot("cloud:production",before,after); } catch(IllegalStateException expected) { rejected=true; }
   trace.step("begin",Trace.fields("requiresStop",AlphaLocalAgentPlugin.requested),"cloud",2,1);
   if(conflict) trace.macro("actual before/provider recheck rejects changed provider",Trace.fields("credential",get("cloud:production").equals(before)?1:2,"committed",!rejected),Trace.action("concurrentProvider"),Trace.action("stale"));
   else trace.macro("actual slot write strips provider admission",Trace.fields("credential",get("cloud:production").equals(after)?2:1,"admissionInvalidated",!new JSONObject(get(LocalAgentProviderAdmission.PROVIDER_SLOT)).has("admissionGeneration")),Trace.action("retire"),Trace.action("observeStop",true,true),Trace.action("prepareCommit"),Trace.action("write"));
   result.put(trace.value);
  }
  reset();String before="{\"value\":1}";put("cloud:production",before);AlphaCredentialStore store=new AlphaCredentialStore(new Context());
  boolean rejected=false;try{store.writeCredentialSlot("cloud:production","x".repeat(AlphaCredentialStore.retainedLimit("cloud:production")+1));}catch(AlphaCredentialStore.StorageFullException expected){rejected=true;}
  Trace cap=new Trace("actual retained-cap preflight precedes lifecycle callback",Trace.fields("credential",1));
  cap.step("begin",Trace.fields("phase",rejected?"full":"captured","credential",get("cloud:production").equals(before)?1:2,"requestedStop",AlphaLocalAgentPlugin.requested?1:0),"cloud",2,4);result.put(cap.value);
  return result;
 }
 public static void main(String[] args)throws Exception {System.out.println(traces());}
}
