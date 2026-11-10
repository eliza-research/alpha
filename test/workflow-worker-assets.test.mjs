import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {stageWorkerArtifact,verifyWorkerArtifact} from '../scripts/workflow-worker-artifact.ts';
import {writeWorkerFixture as fixture} from './fixtures/workflow-worker-assets.mjs';
import {javaBinary} from './fixtures/jvm-tools.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('worker staging rejects drift, traversal, missing files and symlinks before replacement',()=>{
 const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'worker-stage-')));
 try{
  const source=path.join(temporary,'source'),target=path.join(temporary,'assets/worker'),manifest=fixture(source);
  const expected={sourceStampSha256:manifest.sourceStampSha256,lockSha256:manifest.lockSha256};
  const first=stageWorkerArtifact(source,target,expected);assert.equal(first.files,7);
  const original=fs.readFileSync(path.join(target,'files.sha256'),'utf8');
  const overlay=`${source}.patch-overlay.json`;
  fs.writeFileSync(overlay,JSON.stringify({overlay:{baseCommit:'c'.repeat(40),patches:[{patch:'retired.patch'}]}}));
  assert.throws(()=>stageWorkerArtifact(source,target,expected),/Patched worker artifact/);
  assert.equal(fs.readFileSync(path.join(target,'files.sha256'),'utf8'),original);
  fs.writeFileSync(overlay,JSON.stringify({overlay:null}));
  assert.equal(stageWorkerArtifact(source,target,expected).indexSha256,first.indexSha256);
  fs.unlinkSync(overlay);

  assert.throws(()=>stageWorkerArtifact(source,target,{sourceStampSha256:'c'.repeat(64)}),/mismatch/);
  assert.throws(()=>stageWorkerArtifact(source,target,{lockSha256:'c'.repeat(64)}),/mismatch/);
  fs.appendFileSync(path.join(source,'lib/worker.js'),'changed');assert.throws(()=>stageWorkerArtifact(source,target,expected),/hash mismatch/);
  assert.equal(fs.readFileSync(path.join(target,'files.sha256'),'utf8'),original);fixture(source);
  fs.writeFileSync(path.join(source,'extra.txt'),'unexpected');assert.throws(()=>verifyWorkerArtifact(source),/Unexpected/);fs.unlinkSync(path.join(source,'extra.txt'));
  fs.unlinkSync(path.join(source,'lib/worker.js'));assert.throws(()=>verifyWorkerArtifact(source),/missing/);fixture(source);
  fs.unlinkSync(path.join(source,'lib/worker.js'));fs.symlinkSync(path.join(target,'lib/worker.js'),path.join(source,'lib/worker.js'));assert.throws(()=>verifyWorkerArtifact(source),/symlink/);fs.unlinkSync(path.join(source,'lib/worker.js'));fixture(source);
  const altered={...manifest,files:{...manifest.files,'../escape.js':'a'.repeat(64)}};fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(altered));assert.throws(()=>verifyWorkerArtifact(source),/Invalid or missing/);
  fixture(source);fs.truncateSync(path.join(source,'lib/worker.js'),64*1024*1024);assert.throws(()=>verifyWorkerArtifact(source),/exceeds/);
  fixture(source);const redirected=path.join(temporary,'redirected');fs.symlinkSync(path.join(temporary,'assets'),redirected);assert.throws(()=>stageWorkerArtifact(source,path.join(redirected,'must-not-create/worker')),/symlink/);assert.equal(fs.existsSync(path.join(temporary,'assets/must-not-create')),false);
  fixture(source);assert.equal(stageWorkerArtifact(source,target,expected).indexSha256,first.indexSha256);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
test('native worker extractor verifies bytes and preserves the previous installation on failure',()=>{
 const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'worker-extract-')));
 try{
  const source=path.join(temporary,'source'),assets=path.join(temporary,'assets'),state=path.join(temporary,'agent');fixture(source);stageWorkerArtifact(source,assets);fs.mkdirSync(state);
  const identity='ai.alphacompute.alphaphone';
  const harness=`package ${identity};
import java.io.*; import java.nio.file.*; import java.nio.charset.StandardCharsets;
public class WorkerAssetTest {
 public static void main(String[] args)throws Exception{
  String payloadName=args.length>2?args[2]:"lib/worker.js";
  File assets=new File(args[0]),root=new File(args[1]);byte[] index=Files.readAllBytes(new File(assets,"files.sha256").toPath());
  WorkflowWorkerAssets.Source source=p->new FileInputStream(new File(assets,p));
  File installed=WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),source,"1/100");
  java.util.Map<String,String> env=new java.util.HashMap<>();env.put("ELIZA_MOBILE_WORKFLOWS","stale");
  WorkflowWorkerAssets.configureEnvironment(installed,env);
  if(!installed.getCanonicalPath().equals(env.get("ELIZA_SMTHRS_RUNTIME_DIR")))throw new AssertionError("wrong resource path");
  try(java.util.stream.Stream<Path> walk=Files.walk(installed.toPath())){java.util.Set<String> indexed=new java.util.HashSet<>();for(String line:new String(index,StandardCharsets.UTF_8).split("\\n"))if(!line.isEmpty())indexed.add(line.split("\\t")[1]);indexed.add("files.sha256");for(Path file:(Iterable<Path>)walk.filter(Files::isRegularFile)::iterator){String name=installed.toPath().relativize(file).toString().replace(File.separatorChar,'/');if(!indexed.contains(name))throw new AssertionError("installed tree holds unindexed "+name);}}
  Path legacy=new File(installed,".installed-package").toPath();Files.write(legacy,"1/100".getBytes(StandardCharsets.UTF_8));
  WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),source,"1/100");
  if(Files.exists(legacy))throw new AssertionError("kept a legacy in-tree package stamp");
  Path alias=new File(root,"worker-alias").toPath();Files.createSymbolicLink(alias,installed.toPath());
  try{WorkflowWorkerAssets.configureEnvironment(alias.toFile(),env);if(!installed.getCanonicalPath().equals(env.get("ELIZA_SMTHRS_RUNTIME_DIR"))||!Files.isSameFile(alias,installed.toPath()))throw new AssertionError("worker alias did not preserve canonical resource identity");}finally{Files.delete(alias);}
  boolean compiler=new File(installed,"compiler/node_modules/typescript/lib/typescript.js").isFile()&&new File(installed,"compiler/node_modules/smthrs/package.json").isFile();
  if(compiler?!"1".equals(env.get("ELIZA_MOBILE_WORKFLOWS")):env.containsKey("ELIZA_MOBILE_WORKFLOWS"))throw new AssertionError("incorrect compiler enablement");
  byte[] prior=Files.readAllBytes(new File(installed,"manifest.json").toPath());
  WorkflowWorkerAssets.Source unread=p->{throw new AssertionError("re-extracted an unchanged install");};
  for(String leftover:new String[]{".workflow-worker-x",".workflow-worker-old-y"}){File stale=new File(root,leftover+"/lib");stale.mkdirs();Files.write(new File(stale,"worker.js").toPath(),new byte[]{1});}
  if(!WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),unread,"1/100").equals(installed))throw new AssertionError("unchanged install moved");
  for(File file:root.listFiles())if(file.getName().startsWith(".workflow-worker-"))throw new AssertionError("kept leftover staging "+file.getName());
  for(String damage:new String[]{"modified","missing","extra","symlink"}){
   Path payload=new File(installed,payloadName).toPath(),extra=new File(installed,"unindexed.js").toPath();
   if(damage.equals("modified"))Files.write(payload,new byte[]{1});
   if(damage.equals("missing"))Files.delete(payload);
   if(damage.equals("extra"))Files.write(extra,new byte[]{1});
   if(damage.equals("symlink")){Files.delete(payload);Files.createSymbolicLink(payload,new File(assets,payloadName).toPath());}
   int[] repaired={0};WorkflowWorkerAssets.Source repair=p->{repaired[0]++;return source.open(p);};
   WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),repair,"1/100");
   if(repaired[0]==0||Files.isSymbolicLink(payload)||!java.util.Arrays.equals(Files.readAllBytes(payload),Files.readAllBytes(new File(assets,payloadName).toPath()))||Files.exists(extra))throw new AssertionError("kept "+damage+" cached payload");
  }
  int[] opened={0};WorkflowWorkerAssets.Source counted=p->{opened[0]++;return source.open(p);};
  WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),counted,"2/200");
  if(opened[0]==0)throw new AssertionError("package update did not re-extract");
  opened[0]=0;WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),counted,null);
  if(opened[0]==0)throw new AssertionError("unknown package identity skipped extraction");
  WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),source,"2/200");
  WorkflowWorkerAssets.Source corrupt=p->p.equals("manifest.json")?new ByteArrayInputStream(new byte[]{1,2,3}):source.open(p);
  try{WorkflowWorkerAssets.install(root,new ByteArrayInputStream(index),corrupt,"3/300");throw new AssertionError("accepted corruption");}catch(IOException expected){}
  if(!java.util.Arrays.equals(prior,Files.readAllBytes(new File(installed,"manifest.json").toPath())))throw new AssertionError("lost previous artifact");
  for(String bad:new String[]{new String(index,StandardCharsets.UTF_8)+"${'a'.repeat(64)}\\t../escape\\n",new String(index,StandardCharsets.UTF_8)+new String(index,StandardCharsets.UTF_8),""}){
   try{WorkflowWorkerAssets.install(root,new ByteArrayInputStream(bad.getBytes(StandardCharsets.UTF_8)),source,"2/200");throw new AssertionError("accepted invalid index");}catch(IOException expected){}
  }
  try{WorkflowWorkerAssets.install(root,new ByteArrayInputStream(new byte[1024*1024+1]),source,"2/200");throw new AssertionError("accepted oversized index");}catch(IOException expected){}
  if(new File(root.getParentFile(),"escape").exists())throw new AssertionError("path escaped");
  for(File file:root.listFiles())if(file.getName().startsWith(".workflow-worker-"))throw new AssertionError("left partial staging");
  System.out.println("PASS extract, skip unchanged, sweep, update, corruption, traversal, duplicate, missing, rollback");
 }
}`;
  const harnessPath=path.join(temporary,'WorkerAssetTest.java');fs.writeFileSync(harnessPath,harness);
  execFileSync(javaBinary('javac'),['--release','8','-d',temporary,path.join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/WorkflowWorkerAssets.java'),harnessPath],{timeout:20000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary,identity+'.WorkerAssetTest',assets,state],{encoding:'utf8',timeout:20000}),/^PASS extract/);
  if(process.env.ALPHA_WORKFLOW_WORKER_OUTPUT){
   const realAssets=path.join(temporary,'real-assets'),realState=path.join(temporary,'real-agent');
   const staged=stageWorkerArtifact(process.env.ALPHA_WORKFLOW_WORKER_OUTPUT,realAssets);fs.mkdirSync(realState);
   const manifest=JSON.parse(fs.readFileSync(path.join(realAssets,'manifest.json'),'utf8'));
   const payload=Object.keys(manifest.files).find(name=>name.startsWith('lib/')&&name.endsWith('.js'));
   assert.ok(payload,'real artifact must contain a worker module');
   assert.match(execFileSync(javaBinary('java'),['-cp',temporary,identity+'.WorkerAssetTest',realAssets,realState,payload],{encoding:'utf8',timeout:30000}),/^PASS extract/);
   console.log(`Verified native extractor against ${staged.files} real worker artifact files (host JVM only)`);
  }
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
