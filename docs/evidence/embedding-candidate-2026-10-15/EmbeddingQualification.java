package ai.alphacompute.alphaphone;
import android.app.Instrumentation;
import android.os.Bundle;
import java.io.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import org.json.*;
public final class EmbeddingQualification extends Instrumentation {
 public void onCreate(Bundle args){super.onCreate(args);start();}
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static double dot(float[] a,float[] b){double sum=0;for(int i=0;i<a.length;i++)sum+=(double)a[i]*b[i];return sum;}
 static void valid(float[] a){check(a.length==384,"dimensions");for(float x:a)check(Float.isFinite(x),"finite");check(Math.abs(dot(a,a)-1)<0.001,"normalized");}
 public void onStart(){Bundle result=new Bundle();try{
  File root=new File(getTargetContext().getFilesDir(),"embedding-bundle"),text=new File(root,"text");check(text.mkdirs()||text.isDirectory(),"directory");
  File model=new File(text,"bge-small-en-v1.5-f16.gguf");MessageDigest hash=MessageDigest.getInstance("SHA-256");
  try(InputStream in=getTargetContext().getAssets().open("bge-small-en-v1.5-f16.gguf");OutputStream out=new FileOutputStream(model)){byte[] buf=new byte[65536];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);hash.update(buf,0,n);}}
  StringBuilder sha=new StringBuilder();for(byte b:hash.digest())sha.append(String.format("%02x",b));check(sha.toString().equals("f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999"),"model hash");
  check(ElizaVoiceNative.ensureLoaded(),"native loader");check(ElizaVoiceNative.nativeEmbedSupported()==1,"embedding support");
  JSONArray runs=new JSONArray();float[] baseline=null;
  for(int round=0;round<2;round++){long started=System.nanoTime(),handle=ElizaVoiceNative.nativeContextCreate(root.getAbsolutePath());check(handle!=0,"context");try{
   float[] a=ElizaVoiceNative.nativeEmbed(handle,"A cat sits on the mat.",1),again=ElizaVoiceNative.nativeEmbed(handle,"A cat sits on the mat.",1),related=ElizaVoiceNative.nativeEmbed(handle,"The kitten rests on a rug.",1),different=ElizaVoiceNative.nativeEmbed(handle,"The satellite launched into orbit.",1),unicode=ElizaVoiceNative.nativeEmbedWithOptionsUtf8(handle,"café 東京".getBytes(StandardCharsets.UTF_8),1,false);
   for(float[] v:new float[][]{a,again,related,different,unicode})valid(v);
   check(dot(a,again)>0.99999,"repeat deterministic");check(dot(a,related)>dot(a,different),"semantic ranking");if(baseline!=null)check(dot(a,baseline)>0.99999,"reopen deterministic");baseline=a;
   runs.put(new JSONObject().put("round",round).put("dimensions",a.length).put("normSquared",dot(a,a)).put("repeatCosine",dot(a,again)).put("relatedCosine",dot(a,related)).put("unrelatedCosine",dot(a,different)).put("elapsedMs",(System.nanoTime()-started)/1000000.0));
  }finally{ElizaVoiceNative.nativeContextDestroy(handle);}}
  JSONObject report=new JSONObject().put("passed",true).put("qualified",false).put("abi",android.os.Build.SUPPORTED_ABIS[0]).put("sdk",android.os.Build.VERSION.SDK_INT).put("modelSha256",sha.toString()).put("runs",runs);
  result.putString("report",report.toString());finish(-1,result);
 }catch(Throwable failure){result.putString("failure",failure.toString());finish(0,result);}}
}
