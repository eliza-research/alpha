package ai.eliza.sense;

import ai.elizaresearch.alphaphone.Trace;
import android.os.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Observes the real provider and lease. Ports supply Binder, caller and clock facts. */
public final class IndicatorProviderTraces {
 static final IndicatorLeaseProvider provider=new IndicatorLeaseProvider();
 static final Map<Integer,Token> tokens=new HashMap<>();
 static Trace trace;static Bundle reply;static String outcome="none";
 static final class Token implements IBinder {
  final int id;final boolean alive;final List<DeathRecipient> callbacks=new ArrayList<>();boolean unlinkFails;
  Token(int id,boolean alive){this.id=id;this.alive=alive;}
  public void linkToDeath(DeathRecipient value,int flags)throws RemoteException {if(!alive)throw new RemoteException();callbacks.add(value);}
  public boolean unlinkToDeath(DeathRecipient value,int flags){if(unlinkFails)throw new IllegalStateException("controlled unlink failure");return callbacks.remove(value);}
 }
 static long capturedGeneration(Object recipient)throws Exception {
  if(recipient==null)return 0;
  for(Field field:recipient.getClass().getDeclaredFields())if(field.getType()==long.class){field.setAccessible(true);return (long)field.get(recipient);}
  throw new AssertionError("No captured lease generation");
 }
 static JSONObject observe()throws Exception {
  Object lease=Listener.lease;Object link=Trace.read(provider,"linkedToken");long boot=(long)Trace.read(lease,"boot");
  return Trace.fields("generation",Trace.read(lease,"generation"),"live",Trace.read(lease,"live"),
   "acknowledged",Trace.read(lease,"acknowledged"),"expiresAt",Trace.read(lease,"expiresAt"),
   "leaseBoot",boot==Long.MIN_VALUE?-1:boot,"surface",Trace.read(lease,"surfaceVisible"),
   "chip",Trace.read(lease,"chipVisible"),"recording",Trace.read(lease,"recordingObserved"),
   "display",Trace.read(lease,"display")==null?"unknown":Trace.read(lease,"display"),"reason",Trace.read(lease,"reason"),
   "lastLoss",Trace.read(lease,"lastLoss").toString().toLowerCase(Locale.ROOT),
   "linkedToken",link==null?0:((Token)link).id,"linkedGeneration",capturedGeneration(Trace.read(provider,"linkedRecipient")),
   "now",ProviderPorts.now,"boot",ProviderPorts.boot,"reply",outcome,
   "returnedGeneration",reply==null?0:reply.getLong(IndicatorLease.KEY_GENERATION,0),
   "accepted",reply!=null&&reply.getBoolean(IndicatorLease.KEY_ACCEPTED,false),"identities",ProviderPorts.identities.get());
 }
 static void call(String method,Bundle input){reply=null;try{reply=provider.call(method,null,input);outcome=method.equals(IndicatorLease.ACQUIRE)?"acquire":method.equals(IndicatorLease.RENEW)?reply.getBoolean(IndicatorLease.KEY_ACCEPTED,false)?"accepted":"refused":"empty";}catch(SecurityException error){outcome="security";}catch(IllegalArgumentException error){outcome="argument";}}
 static void acquire(int id,boolean alive)throws Exception {
  Token token=new Token(id,alive);tokens.put(id,token);Bundle input=new Bundle();input.putBinder(IndicatorLease.KEY_TOKEN,token);
  call(IndicatorLease.ACQUIRE,input);trace.step("acquire",observe(),id,alive);
 }
 static void renew(int generation,String report)throws Exception {
  Bundle input=new Bundle();input.putLong(IndicatorLease.KEY_GENERATION,generation);
  input.putBoolean(IndicatorLease.KEY_SURFACE,report.equals("visible")||report.equals("chip_hidden"));
  input.putBoolean(IndicatorLease.KEY_CHIP,report.equals("visible"));
  input.putBoolean(IndicatorLease.KEY_RECORDING,report.equals("visible")||report.equals("chip_hidden"));
  input.putString(IndicatorLease.KEY_DISPLAY,report.equals("off")?"off":report.equals("aod")?"doze":report.equals("unknown")?"invalid":"on");
  input.putString(IndicatorLease.KEY_REASON,Set.of("fullscreen","shade","transition").contains(report)?report:"none");
  call(IndicatorLease.RENEW,input);trace.step("renew",observe(),generation,report);
 }
 static void revoke(int generation)throws Exception {Bundle input=new Bundle();input.putLong(IndicatorLease.KEY_GENERATION,generation);call(IndicatorLease.REVOKE,input);trace.step("revoke",observe(),generation);}
 static void death(int token,int generation)throws Exception {
  Token value=tokens.get(token);IBinder.DeathRecipient callback=value.callbacks.get(0);int before=ProviderPorts.refreshes.get();
  callback.binderDied();if(ProviderPorts.refreshes.get()!=before+1)throw new AssertionError("Death must request listener convergence");
  trace.step("binderDeath",observe(),generation);
 }
 static void environment(long now,long boot)throws Exception {ProviderPorts.now=now;ProviderPorts.boot=boot;trace.step("environment",observe(),now,boot);}
 static void failure(String method,Bundle input,String expected)throws Exception {call(method,input);if(!outcome.equals(expected))throw new AssertionError("Expected "+expected+" got "+outcome);trace.step("failedCall",observe(),expected);}
 static void run(String mode)throws Exception {
  trace=new Trace("indicator-provider-"+mode,observe());
  switch(mode){
   case "replace": acquire(1,true);renew(1,"visible");acquire(2,true);renew(1,"visible");renew(2,"visible");revoke(1);death(2,2);break;
   case "unlink-failure": acquire(1,true);tokens.get(1).unlinkFails=true;acquire(2,true);death(1,1);renew(2,"visible");death(2,2);break;
   case "same-token": acquire(1,true);tokens.get(1).unlinkFails=true;Token same=tokens.get(1);Bundle input=new Bundle();input.putBinder(IndicatorLease.KEY_TOKEN,same);call(IndicatorLease.ACQUIRE,input);trace.step("acquire",observe(),1,true);death(1,1);renew(2,"visible");same.callbacks.get(1).binderDied();trace.step("binderDeath",observe(),2);break;
   case "dead-token": acquire(1,false);renew(1,"visible");revoke(1);break;
   case "revoke": acquire(1,true);renew(1,"visible");revoke(1);renew(1,"visible");death(1,1);break;
   case "expired": acquire(1,true);renew(1,"visible");environment(3099,1);renew(1,"hidden");environment(3100,1);renew(1,"visible");acquire(2,true);break;
   case "boot": acquire(1,true);renew(1,"visible");environment(100,2);renew(1,"visible");acquire(2,true);renew(2,"visible");break;
   case "invalid-expired": acquire(1,true);renew(1,"visible");environment(3100,1);failure("unknown",null,"argument");break;
   case "missing-token": failure(IndicatorLease.ACQUIRE,null,"argument");break;
   case "missing-renew": acquire(1,true);failure(IndicatorLease.RENEW,null,"argument");break;
   case "unknown": failure("unknown",null,"argument");break;
   case "denied-permission": acquire(1,true);ProviderPorts.authorized=false;failure(IndicatorLease.ACQUIRE,null,"security");break;
   case "denied-signature": acquire(1,true);ProviderPorts.signed=false;failure(IndicatorLease.REVOKE,null,"security");break;
   case "denied-package": ProviderPorts.owners=new String[]{"other"};failure(IndicatorLease.ACQUIRE,null,"security");break;
   case "denied-shared-uid": ProviderPorts.owners=new String[]{"com.android.systemui","other"};failure(IndicatorLease.ACQUIRE,null,"security");break;
   case "denied-user": ProviderPorts.uid=102000;failure(IndicatorLease.ACQUIRE,null,"security");break;
   case "denied-low-uid": ProviderPorts.uid=999;failure(IndicatorLease.ACQUIRE,null,"security");break;
   case "denied-missing-package": ProviderPorts.owners=null;failure(IndicatorLease.ACQUIRE,null,"security");break;
   default: acquire(1,true);renew(1,mode.equals("unknown-report")?"unknown":mode);renew(1,"visible");break;
  }
  System.out.println(trace.value);
 }
 public static void main(String[]args)throws Exception {
  if(!args[0].equals("campaign")){run(args[0]);return;}
  JSONArray traces=new JSONArray();for(int i=1;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),IndicatorProviderTraces.class.getName(),args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String text=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8);if(process.waitFor()!=0)throw new AssertionError("Provider scenario failed "+args[i]);traces.put(new JSONObject(text));
  }System.out.println(traces);
 }
}
