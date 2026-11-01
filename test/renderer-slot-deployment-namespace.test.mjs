// Host-JVM: the renderer secure-slot guard refuses the physical Cloud deployment namespace. Without
// it a renderer secureSet('cloud-deployment:<hash>:cloud:production') or ':local-agent-provider:v1'
// reaches the same physical slot as the native credential writes, skipping mutateCredentials and
// the listener-owner cache invalidation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runJvm,nativeSource,upstreamConnection} from './fixtures/jvm-tools.mjs';

test('renderer slots cannot address the Cloud deployment storage namespace',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'renderer-slot-namespace-'));
 try{
  const harness=join(temporary,'Harness.java');
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public final class Harness {
 static boolean refused(String slot){try{RendererCredentialSlots.requireAllowed(slot);return false;}catch(SecurityException expected){return true;}}
 public static void main(String[] args){
  String ns=CloudDeployment.STORAGE_NAMESPACE;
  for(String slot:new String[]{ns+"cloud:production",ns+"cloud:staging",ns+"local-agent-provider:v1",ns+"cloud-signin:pending","cloud-deployment","google-workspace-return","google-workspace-return:v1:pending"})
   if(!refused(slot))throw new AssertionError("admitted "+slot);
  // The physical name of every namespaced logical slot is refused, and the logical names stay guarded where they were.
  for(String logical:new String[]{"cloud:production","local-agent-provider:v1"}){String physical=CloudDeployment.storageSlot(logical);if(physical.equals(logical)||!refused(physical))throw new AssertionError("physical "+physical);}
  if(RendererCredentialSlots.compareExchangeAllowed("google-workspace-return:v1:pending"))throw new AssertionError("Google pending CAS admitted");
  if(refused("notes-draft:v1:device"))throw new AssertionError("ordinary renderer slot refused");
  System.out.println("PASS deployment namespace");
 }
}`);
  assert.match(runJvm([upstreamConnection('SecureSlotPolicy.java'),nativeSource('RendererCredentialSlots.java'),nativeSource('CloudDeployment.java'),harness],'ai.elizaresearch.alphaphone.Harness'),/PASS deployment namespace/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
