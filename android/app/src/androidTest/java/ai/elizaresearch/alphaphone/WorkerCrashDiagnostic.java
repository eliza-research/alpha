package ai.elizaresearch.alphaphone;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.*;

/** Test-only fixed projection. Never retains native trace bytes, descriptions, paths or memory. */
final class WorkerCrashDiagnostic {
 static final int LIMIT=1024*1024;
 static JSONObject capture(Context context,JSONObject identity){
  ExecutorService executor=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"owned-worker-crash-observation");t.setDaemon(true);return t;});
  Future<JSONObject> pending=executor.submit(()->observe(context,identity));
  try{return pending.get(2,TimeUnit.SECONDS);}catch(Exception unavailable){pending.cancel(true);return safeUnavailable();}finally{executor.shutdownNow();}
 }
 private static JSONObject safeUnavailable(){try{return new JSONObject().put("available",false);}catch(Exception impossible){return new JSONObject();}}
 private static JSONObject observe(Context context,JSONObject identity)throws Exception{
  int pid=identity.getInt("pid"),uid=identity.getInt("uid");long started=identity.getLong("startedAt"),now=System.currentTimeMillis();
  if(pid<=0||uid!=android.os.Process.myUid()||started<=0||started>now)return safeUnavailable();
  List<ApplicationExitInfo> entries=context.getSystemService(ActivityManager.class).getHistoricalProcessExitReasons(context.getPackageName(),pid,8);
  ApplicationExitInfo exact=null;
  for(ApplicationExitInfo entry:entries)if(entry.getPid()==pid&&entry.getRealUid()==uid&&entry.getTimestamp()>=started&&entry.getTimestamp()<=now){if(exact!=null)return safeUnavailable();exact=entry;}
  if(exact==null)return safeUnavailable();
  JSONObject result=new JSONObject().put("available",true).put("pid",pid).put("uid",uid).put("reason",exact.getReason()).put("status",exact.getStatus()).put("timestamp",exact.getTimestamp()).put("traceAvailable",false);
  if(exact.getReason()!=ApplicationExitInfo.REASON_CRASH_NATIVE)return result;
  try(InputStream in=exact.getTraceInputStream()){
   if(in==null)return result;ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
   while((n=in.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedException();if(out.size()+n>LIMIT)return result.put("traceOverBound",true);out.write(buffer,0,n);}
   JSONObject trace=parse(out.toByteArray(),pid,uid);result.put("traceAvailable",true).put("trace",trace);return result;
  }
 }
 /** Android 15 debuggerd/proto/tombstone.proto: inspect only pid/uid/signal/cause fields. */
 static JSONObject parse(byte[] bytes,int expectedPid,int expectedUid)throws Exception{
  if(bytes.length>LIMIT)throw new IllegalArgumentException();Cursor c=new Cursor(bytes,0,bytes.length);long pid=-1,uid=-1,signal=-1,code=-1,syscall=-1,arch=-1;
  boolean p=false,u=false,s=false,a=false;
  while(c.more()){
   long tag=c.varint();int field=(int)(tag>>>3),wire=(int)(tag&7);if(field==0)throw new IllegalArgumentException();
   if((field==1||field==5||field==7)&&wire==0){long v=c.varint();if(field==1){if(a)throw new IllegalArgumentException();a=true;arch=v;}else if(field==5){if(p)throw new IllegalArgumentException();p=true;pid=v;}else{if(u)throw new IllegalArgumentException();u=true;uid=v;}}
   else if(field==10&&wire==2){if(s)throw new IllegalArgumentException();s=true;Cursor sub=c.message();boolean sn=false,sc=false;while(sub.more()){long t=sub.varint();int f=(int)(t>>>3),w=(int)(t&7);if(f==1&&w==0){if(sn)throw new IllegalArgumentException();sn=true;signal=sub.varint();}else if(f==3&&w==0){if(sc)throw new IllegalArgumentException();sc=true;code=sub.varint();}else sub.skip(w);}}
   else if(field==15&&wire==2){Cursor sub=c.message();while(sub.more()){long t=sub.varint();if((t>>>3)==1&&(t&7)==2){Cursor text=sub.message();if(text.end-text.pos<=256){String value=new String(bytes,text.pos,text.end-text.pos,StandardCharsets.UTF_8);java.util.regex.Matcher match=java.util.regex.Pattern.compile("seccomp prevented call to disallowed (?:x86_64|x86|arm64|arm|riscv64) system call ([0-9]{1,5})").matcher(value);if(match.matches()){if(syscall!=-1)throw new IllegalArgumentException();syscall=Long.parseLong(match.group(1));}}}else sub.skip((int)(t&7));}}
   else c.skip(wire);
  }
  if(pid!=expectedPid||uid!=expectedUid||!p||!u||!s)throw new IllegalArgumentException();
  JSONObject result=new JSONObject().put("identityMatches",true);
  if(arch>=0&&arch<=5)result.put("architecture",arch);
  if(signal>=0&&signal<=64)result.put("signal",signal);
  if(code>=0&&code<=255)result.put("signalCode",code);
  if(signal==31&&code==1&&syscall>=0&&syscall<=65535)result.put("seccompSyscall",syscall);
  return result;
 }
 private static final class Cursor {
  final byte[] bytes;int pos;final int end;Cursor(byte[] b,int p,int e){bytes=b;pos=p;end=e;}
  boolean more(){return pos<end;}
  long varint(){long value=0;for(int i=0;i<10;i++){if(pos>=end)throw new IllegalArgumentException();int v=bytes[pos++]&255;if(i==9&&(v&254)!=0)throw new IllegalArgumentException();value|=(long)(v&127)<<(i*7);if((v&128)==0)return value;}throw new IllegalArgumentException();}
  Cursor message(){long size=varint();if(size<0||size>end-pos)throw new IllegalArgumentException();Cursor child=new Cursor(bytes,pos,pos+(int)size);pos=child.end;return child;}
  void skip(int wire){if(wire==0)varint();else if(wire==2)message();else if(wire==1||wire==5){int n=wire==1?8:4;if(end-pos<n)throw new IllegalArgumentException();pos+=n;}else throw new IllegalArgumentException();}
 }
}
