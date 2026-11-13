import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
const shared='vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeRuntimeEmbeddings.java';
test('Alpha selects embeddings only through the shared native runtime profile',()=>{
 assert.ok(JSON.parse(fs.readFileSync('android/consumer-host.json','utf8')).residentHost.helpers.includes('plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderSlot.java'),'NativeProviderSlot.java must be staged for the APK compile');
 // The shared class is compiled from the selected-source staging list, like NativeProviderAdmission.
 // stage-local-agent-sources.ts stages the consumer host descriptor's resident helpers.
 assert.ok(JSON.parse(fs.readFileSync('android/consumer-host.json','utf8')).residentHost.helpers.includes('plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeRuntimeEmbeddings.java'),'NativeRuntimeEmbeddings.java must be staged for the APK compile');
});
test('the shared profile keeps native embeddings local and Cloud QA on Cloud',()=>{
 assert.ok(fs.existsSync(shared),'The eliza pin must include NativeRuntimeEmbeddings (plugin-native-agent)');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-policy-'));
 try{fs.writeFileSync(path.join(dir,'EmbeddingProfileTest.java'),`
import java.io.*;import java.util.*;import ai.eliza.plugins.agent.runtime.NativeRuntimeEmbeddings;
class EmbeddingProfileTest {
 static Map<String,String> cloud(){Map<String,String> e=new HashMap<>();e.put("ELIZAOS_CLOUD_USE_EMBEDDINGS","true");e.put("ELIZA_DISABLE_LOCAL_EMBEDDINGS","true");e.put("ELIZA_LOCAL_EMBEDDING_ENABLED","0");return e;}
 static void check(boolean x){if(!x)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  File f=new File(args[0],"files"),l=new File(args[0],"libs");f.mkdirs();l.mkdirs();
  File engine=new File(l,"libelizainference.so"),jni=new File(l,"libelizavoicejni.so"),model=new File(f,".eliza/local-inference/models/bge-small-en-v1.5-f16.gguf");model.getParentFile().mkdirs();engine.createNewFile();jni.createNewFile();model.createNewFile();
  Map<String,String> e=cloud();NativeRuntimeEmbeddings.apply("native",l,f,e);check("1".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("false".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));check("384".equals(e.get("ELIZA_LOCAL_EMBEDDING_DIMENSIONS")));
  e=cloud();NativeRuntimeEmbeddings.apply("cloud",l,f,e);check("0".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("true".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));
  for(File asset:new File[]{model,engine,jni}){asset.delete();e=cloud();e.put("ELIZA_LOCAL_EMBEDDING_MODEL_PATH","stale-model");NativeRuntimeEmbeddings.apply("native",l,f,e);check("0".equals(e.get("ELIZA_LOCAL_EMBEDDING_ENABLED")));check("false".equals(e.get("ELIZAOS_CLOUD_USE_EMBEDDINGS")));check(!e.containsKey("ELIZA_LOCAL_EMBEDDING_MODEL_PATH"));asset.createNewFile();}
  System.out.println("PASS native, cloud, and three missing asset gates");
 }
}`);execFileSync(javaBinary('javac'),['--release','11','-d',dir,shared,path.join(dir,'EmbeddingProfileTest.java')]);assert.match(execFileSync(javaBinary('java'),['-cp',dir,'EmbeddingProfileTest',dir],{encoding:'utf8'}),/PASS native, cloud/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
