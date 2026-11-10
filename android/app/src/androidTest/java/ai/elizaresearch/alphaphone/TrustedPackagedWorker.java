package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.system.Os;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Test APK only. Direct instrumentation child: never claims resident-created ancestry. */
final class TrustedPackagedWorker implements AutoCloseable {
 private static String readUtf8(java.nio.file.Path path)throws IOException{return new String(Files.readAllBytes(path),StandardCharsets.UTF_8);}
 final File root,journal,home; final String runId; java.lang.Process process; private final Context context; private boolean replaying;
 private static String sha(byte[] bytes)throws Exception {StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format("%02x",b));return s.toString();}
 private static void write(File file,String value)throws Exception{if(file.exists())throw new IOException("Fixture path already exists");try(FileOutputStream out=new FileOutputStream(file)){out.write(value.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}Os.chmod(file.getPath(),0600);}
 TrustedPackagedWorker(Context context,File dependencyRoot,String source,String workerScript,String expectedScriptHash,java.net.ServerSocket server,String workflowId)throws Exception {
  this.context=context;
  if(!BuildConfig.DEBUG||android.os.Process.myUid()/100000==0||!java.util.Arrays.asList("arm64-v8a","x86_64").contains(Build.SUPPORTED_ABIS[0]))throw new IOException("Explicit disposable supported ABI debug fixture required");
  if(!server.isBound()||server.isClosed()||!"127.0.0.1".equals(server.getInetAddress().getHostAddress())||server.getLocalPort()<=0)throw new IOException("Owned loopback server required");
  if(!sha(workerScript.getBytes(StandardCharsets.UTF_8)).equals(expectedScriptHash))throw new IOException("Trusted harness source pin differs");
  if(!workflowId.matches("[a-zA-Z0-9-]+"))throw new IOException("Invalid fixture workflow ID");
  home=context.getFilesDir().getCanonicalFile();root=new File(home,".eliza/smthrs/trusted-native-fixture/"+workflowId);if(root.exists()||!root.mkdirs())throw new IOException("Fresh fixture state required");Os.chmod(root.getPath(),0700);
  runId=UUID.randomUUID().toString();String digest=sha(source.getBytes(StandardCharsets.UTF_8)),version="trusted-v1";File module=new File(root,version+"."+digest+".tsx");write(module,source);
  File modules=new File(root,"node_modules");if(!modules.mkdir())throw new IOException("Fixture modules create failed");for(String name:new String[]{"smthrs","zod"}){File target=new File(dependencyRoot,"node_modules/"+name).getCanonicalFile();if(!target.isDirectory())throw new IOException("Missing packaged workflow dependency");Os.symlink(target.getPath(),new File(modules,name).getPath());}
  File socketRoot=new File(home,".eliza-worker-ipc");if((socketRoot.getPath()+"/01234567890123456789.sock").getBytes(StandardCharsets.UTF_8).length>100)socketRoot=new File(home,".ew");if(!socketRoot.exists()){if(!socketRoot.mkdir())throw new IOException("Socket root create failed");Os.chmod(socketRoot.getPath(),0700);}if(!android.system.OsConstants.S_ISDIR(Os.lstat(socketRoot.getPath()).st_mode)||!socketRoot.getCanonicalFile().equals(socketRoot)||Os.lstat(socketRoot.getPath()).st_uid!=android.os.Process.myUid()||(Os.lstat(socketRoot.getPath()).st_mode&077)!=0)throw new IOException("Untrusted socket root");
  JSONObject lease=new JSONObject().put("rootDir",root.getCanonicalPath()).put("socketRoot",socketRoot.getPath()).put("sourcePath",module.getPath()).put("sourceSha256",digest).put("runId",runId).put("versionId",version);
  File script=new File(root,"trusted-worker.mjs"),payload=new File(root,"trusted-payload.json");write(script,workerScript);write(payload,new JSONObject().put("dependencyRoot",dependencyRoot.getCanonicalPath()).put("rootDir",root.getPath()).put("sourcePath",module.getPath()).put("runId",runId).put("workerLease",lease).put("endpoint","http://127.0.0.1:"+server.getLocalPort()+"/synthetic-survivor").toString());
  journal=new File(root,".worker-owners/"+sha(runId.getBytes(StandardCharsets.UTF_8))+"/owner.json");process=launch(payload);
 }
 private java.lang.Process launch(File payload)throws Exception {
  String abi=android.os.Build.SUPPORTED_ABIS[0];if(!java.util.Arrays.asList("arm64-v8a","x86_64").contains(abi))throw new IOException("Unsupported runtime ABI");
  File libs=new File(context.getApplicationInfo().nativeLibraryDir),bun=new File(libs,"libeliza_bun.so"),loader=new File(libs,abi.equals("arm64-v8a")?"libeliza_ld_musl_aarch64.so":"libeliza_ld_musl_x86_64.so");if(!bun.isFile()||!loader.isFile())throw new IOException("Packaged runtime missing");
  ProcessBuilder builder=new ProcessBuilder(loader.getPath(),bun.getPath(),new File(root,"trusted-worker.mjs").getPath(),payload.getPath()).directory(root).redirectInput(ProcessBuilder.Redirect.from(new File("/dev/null"))).redirectErrorStream(true).redirectOutput(new File(root,payload.getName().contains("replay")?"trusted-replay-worker.log":"trusted-worker.log"));Map<String,String> env=builder.environment();env.clear();env.put("HOME",home.getPath());env.put("TMPDIR",context.getCacheDir().getPath());env.put("PATH","/system/bin");env.put("LD_LIBRARY_PATH",libs.getPath()+":"+new File(home,"agent/"+abi).getPath());for(String flag:new String[]{"DISABLE_IO_POOL","FORCE_WAITER_THREAD","DISABLE_RWF_NONBLOCK","DISABLE_SPAWNSYNC_FAST_PATH","DISABLE_ASYNC_TRANSPILER"})env.put("BUN_FEATURE_FLAG_"+flag,"1");env.put("ELIZA_PLATFORM","android");env.put("ELIZA_MOBILE_PLATFORM","android");
  return builder.start();
 }

 JSONObject finish()throws Exception {return finish(replaying);}
 JSONObject replay()throws Exception {if(process.isAlive())throw new IOException("Original worker still alive");JSONObject payload=new JSONObject(readUtf8(new File(root,"trusted-payload.json").toPath())).put("replay",true);File replay=new File(root,"trusted-replay-payload.json");write(replay,payload.toString());process=launch(replay);replaying=true;return finish();}
 private JSONObject finish(boolean replay)throws Exception {if(!process.waitFor(30,TimeUnit.SECONDS))throw new IOException("Trusted worker did not settle");if(process.exitValue()!=0)throw new IOException("Trusted worker failed; inspect private retained log");JSONObject result=new JSONObject(readUtf8(new File(root,replay?"trusted-replay-result.json":"trusted-result.json").toPath()));if(!"finished".equals(result.getString("status"))||result.getInt("calls")!=(replay?0:1)||result.getJSONArray("output").length()!=1||result.getJSONArray("output").getJSONObject(0).getInt("value")!=1||!runId.equals(result.getJSONArray("output").getJSONObject(0).getString("runId"))||!"effect".equals(result.getJSONArray("output").getJSONObject(0).getString("nodeId"))||result.getJSONArray("output").getJSONObject(0).getInt("iteration")!=0)throw new IOException("Trusted canonical result differs");return result;}
 public void close()throws Exception {if(process.isAlive())throw new IOException("Trusted worker alive; release synthetic response and settle before cleanup, otherwise preserve disposable user");}
}
