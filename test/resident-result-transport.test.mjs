import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
test('resident result IPC verifies identity and preserves durable inbox recovery',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'resident-result-transport-'));
 const base=join(root,'android/app/src/main/java/ai/alphacompute/alphaphone');
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/SecureSlotPolicy.java'),...['CloudDeployment','RendererCredentialSlots','ResidentResultTransport','ResidentResultSession','HostedInbox','HostedResultNotices','HostedStorageFault'].map(name=>join(base,name+'.java')),...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'test/fixtures/ResidentResultTransportTest.java')],{timeout:20000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.ResidentResultTransportTest'],{encoding:'utf8',timeout:20000}),/^PASS resident/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('resident delivery coordinator uses IPC and retires its encrypted session binding',{skip:jvmSkip('json')},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'resident-delivery-'));
 const base=join(root,'android/app/src/main/java/ai/alphacompute/alphaphone');
 try{
  const context=join(temporary,'Context.java');writeFileSync(context,'package android.content; public class Context {public Context getApplicationContext(){return this;}}');
  const support=join(temporary,'Support.java');writeFileSync(support,`package ai.alphacompute.alphaphone;
import android.content.Context;import org.json.*;import java.util.*;
class BuildConfig {static final boolean DEBUG=false;static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;}
class AlphaCredentialStore {static final Map<String,String> data=new HashMap<>();AlphaCredentialStore(Context c){}String readCredentialSlot(String key){return data.get(key);}void writeCredentialSlot(String key,String value){data.put(key,value);}void removeCredentialSlot(String key){data.remove(key);}}
class HostedNoticePoster implements HostedResultNotices.Poster {HostedNoticePoster(Context c){}public boolean allowed(){return false;}public boolean active(String key){return false;}public void post(String key){throw new AssertionError();}public void cancel(String key){}}
class HostedDeliveryWorker {static boolean resident;static int scheduled;static void cancel(Context c){}static void schedule(Context c,String generation,boolean local){resident=local;scheduled++;}}
class AlphaLocalAgentPlugin {static JSONObject captureResultSession(String owner)throws Exception {if(!owner.equals("owner"))throw new SecurityException();return ResidentResultSession.snapshot(owner,"session",ResidentResultTransportTest.EXPIRES,ElizaAgentService.root);}}
class ElizaAgentService {static String root="root";static final ResidentResultTransportTest.Channel channel=new ResidentResultTransportTest.Channel();static String localAgentToken(){return root;}static String localAgentToken(Context c){return root;}static String requestLocalAgent(String raw)throws Exception {JSONObject r=new JSONObject(raw);if(!r.getJSONObject("headers").getString("Authorization").equals("Bearer session"))throw new AssertionError();return channel.exchange(r.getString("path"),r.getString("method"),r.has("body")?new JSONObject(r.getString("body")):null,r.getInt("timeoutMs")).toString();}}
`);
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/SecureSlotPolicy.java'),context,support,...['CloudDeployment','RendererCredentialSlots','ResidentResultTransport','ResidentResultSession','HostedTransport','NativeDigestSources','HostedDelivery','HostedInbox','HostedResultNotices','HostedStorageFault','HostedDeliveryCancelled','NativeDeviceEnrollmentKey'].map(name=>join(base,name+'.java')),...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'test/fixtures/ResidentResultTransportTest.java'),join(root,'test/fixtures/ResidentDeliveryTest.java')],{timeout:20000});
  assert.match(execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.ResidentDeliveryTest'],{encoding:'utf8',timeout:20000}),/^PASS resident configure/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
