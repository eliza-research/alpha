// Host-JVM: the actual renderer secureRead/secureWrite/secureRemove/secureCompareExchange methods
// refuse the SMS send ledger and per-operation slots. AlphaTelephony owns them; a renderer write
// could otherwise erase or forge the record that stops a resend after a lost reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeSource,upstreamConnection,javaBinary,jsonJar} from './fixtures/jvm-tools.mjs';
function method(source,name){const a=source.indexOf('@PluginMethod public void '+name+'(');assert.ok(a>=0);const z=source.indexOf('\n }',a);assert.ok(z>a);return source.slice(a,z+3).replace('@PluginMethod ','');}
function run(files,main){assert.ok(jsonJar,'Pinned JSON dependency required; no skipped security proof');const dir=mkdtempSync(join(tmpdir(),'renderer-slot-policy-'));try{const paths=files.map(([name,content])=>{const p=join(dir,name);writeFileSync(p,content);return p;});execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',dir,...paths],{stdio:'pipe',timeout:30000});return execFileSync(javaBinary('java'),['-cp',dir+':'+jsonJar,main],{encoding:'utf8',stdio:'pipe',timeout:30000});}finally{rmSync(dir,{recursive:true,force:true});}}
test('renderer slot methods refuse the native SMS send ledger and operation records',()=>{
 const source=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 const methods=['secureRead','secureWrite','secureRemove','secureCompareExchange'].map(name=>method(source,name)).join('\n');
 const java=`package ai.elizaresearch.alphaphone;
 import java.util.*;import org.json.*;
 class JSObject extends JSONObject {}
 class PluginCall {final JSONObject data=new JSONObject();boolean resolved,rejected;PluginCall(String slot)throws Exception{data.put("slot",slot).put("value","replacement").put("expectedValue",JSONObject.NULL);}String getString(String key){return data.isNull(key)?null:data.optString(key,null);}JSONObject getData(){return data;}void resolve(){resolved=true;}void resolve(JSObject x){resolved=true;}void reject(String... message){rejected=true;}}
 class AlphaCredentialStore {static final String NOTES_DRAFT="notes-draft:v1:device";static class StorageFullException extends Exception{} final Map<String,String> values=new HashMap<>();int effects;void writeCredentialSlot(String n,String v)throws Exception{effects++;values.put(n,v);}String readCredentialSlot(String n)throws Exception{effects++;return values.get(n);}void removeCredentialSlot(String n)throws Exception{effects++;values.remove(n);}boolean compareExchangeCredentialSlot(String n,String e,String v)throws Exception{effects++;if(!Objects.equals(values.get(n),e))return false;if(v==null)values.remove(n);else values.put(n,v);return true;}}
 class ConnectionMethods {static final String STORAGE_FULL_MESSAGE="full",STORAGE_FULL="full";final AlphaCredentialStore store=new AlphaCredentialStore();interface Work{void run()throws Exception;}void submitStorage(PluginCall c,Work w){try{w.run();}catch(Exception e){c.reject("fixture");}}long credentialIntent(String n){return 0;}AlphaCredentialStore storage(){return store;}AlphaCredentialStore storage(long n){return store;}String readCredentialSlot(String n)throws Exception{return store.readCredentialSlot(n);}
 ${methods}
 }
 public class SmsSlotBoundaryTest {static void call(ConnectionMethods b,String op,PluginCall c)throws Exception{switch(op){case "read":b.secureRead(c);break;case "write":b.secureWrite(c);break;case "remove":b.secureRemove(c);break;default:b.secureCompareExchange(c);}}
 public static void main(String[]args)throws Exception{
 ConnectionMethods bridge=new ConnectionMethods();int checks=0;
 for(String slot:new String[]{"sms-send-ledger","sms-send-ledger:v1:device","alpha-sms-operation:v1:x","alpha-sms-operation:v1:0123abcd"})for(String operation:new String[]{"read","write","remove","cas"}){
 bridge.store.values.put(slot,"synthetic-ledger");int before=bridge.store.effects;PluginCall c=new PluginCall(slot);call(bridge,operation,c);
 if(!c.rejected||c.resolved||bridge.store.effects!=before||!"synthetic-ledger".equals(bridge.store.values.get(slot)))throw new AssertionError(operation+" reached "+slot);checks++;
 }
 for(String operation:new String[]{"write","read","remove"}){PluginCall c=new PluginCall("sms-send-ledger-fixture:v1");call(bridge,operation,c);if(!c.resolved||c.rejected)throw new AssertionError("Unrelated slot refused");checks++;}
 System.out.println("PASS renderer SMS ledger boundary "+checks);
 }} `;
 assert.match(run([['SecureSlotPolicy.java',readFileSync(upstreamConnection('SecureSlotPolicy.java'),'utf8')],['RendererCredentialSlots.java',readFileSync(nativeSource('RendererCredentialSlots.java'),'utf8')],['SmsSlotBoundaryTest.java',java]],'ai.elizaresearch.alphaphone.SmsSlotBoundaryTest'),/^PASS renderer SMS ledger boundary 19/);
});
