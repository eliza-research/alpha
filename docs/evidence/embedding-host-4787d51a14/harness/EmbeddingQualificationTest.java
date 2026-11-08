package ai.elizaresearch.alphaphone;
import static org.junit.Assert.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
@RunWith(AndroidJUnit4.class)
public class EmbeddingQualificationTest {
 static byte[] utf(String s){return s.getBytes(StandardCharsets.UTF_8);}
 static double dot(float[] a,float[] b){double n=0;for(int i=0;i<a.length;i++)n+=(double)a[i]*b[i];return n;}
 static float[] embed(long h,String s){float[] v=ElizaVoiceNative.nativeEmbedWithOptionsUtf8(h,utf(s),2,true);assertNotNull(v);assertEquals(384,v.length);for(float x:v)assertTrue(Float.isFinite(x));double n=Math.sqrt(dot(v,v));assertTrue(n>0);for(int i=0;i<v.length;i++)v[i]/=n;return v;}
 @Test public void exactAlphaJniRunsPinnedBge() throws Exception {
  var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File bundle=new File(context.getFilesDir(),"bge");assertTrue(bundle.isDirectory()||bundle.mkdirs());
  File textDir=new File(bundle,"text");assertTrue(textDir.isDirectory()||textDir.mkdirs());
  try(var in=context.getAssets().open("bge-small-en-v1.5-f16.gguf");var out=new FileOutputStream(new File(textDir,"bge-small-en-v1.5-f16.gguf"))){in.transferTo(out);}
  assertTrue(ElizaVoiceNative.getLoadError(),ElizaVoiceNative.ensureLoaded());assertEquals(1,ElizaVoiceNative.nativeEmbedSupported());
  JSONArray rounds=new JSONArray();
  for(int round=0;round<2;round++){
   long h=ElizaVoiceNative.nativeContextCreateUtf8(utf(bundle.getAbsolutePath()));assertNotEquals(0L,h);long start=System.nanoTime();
   try{
    float[] first=embed(h,"A cat is sitting on the mat.");float[] repeat=embed(h,"A cat is sitting on the mat.");
    double same=dot(first,repeat),related=dot(first,embed(h,"The kitten rests on a rug.")),unrelated=dot(first,embed(h,"Database replication uses transaction logs."));
    assertEquals(1.0,dot(first,first),1e-5);assertTrue(same>0.99999);assertTrue("semantic rank",related>unrelated+0.1);
    int[] before=ElizaVoiceNative.nativeTokenizeWithOptionsUtf8(h,utf("before"),true),nul=ElizaVoiceNative.nativeTokenizeWithOptionsUtf8(h,utf("before\u0000 after"),true);assertTrue(nul.length>before.length);
    float[] unicode=embed(h,"😀 café 漢字"),ascii=embed(h,"cafe");assertTrue(dot(unicode,ascii)<0.999);
    rounds.put(new JSONObject().put("round",round).put("dimensions",384).put("normSquared",dot(first,first)).put("repeatCosine",same).put("relatedCosine",related).put("unrelatedCosine",unrelated).put("unicodeDistinct",true).put("nulSuffixTokenized",true).put("elapsedMs",(System.nanoTime()-start)/1e6));
   }finally{ElizaVoiceNative.nativeContextDestroy(h);}
  }
  JSONObject report=new JSONObject().put("pass",true).put("model",android.os.Build.MODEL).put("abi",android.os.Build.SUPPORTED_ABIS[0]).put("nativeAbi",ElizaVoiceNative.nativeVoiceAbiVersion()).put("rounds",rounds);
  Files.write(new File(context.getExternalFilesDir(null),"embedding-qualification.json").toPath(),utf(report.toString(2)));
 }
}
