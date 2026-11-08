import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

// Execute both production header allowlists verbatim. No transport, enrollment,
// Android service or stored credential is used by this host-JVM contract test.
test('native JSON and chat-stream forwarding preserve the canonical renderer ID without forwarding authority headers',{skip:jsonJarSkip},()=>{
 const source=fs.readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const sections=[['raw',source.slice(source.indexOf(' private static JSONObject raw('),source.indexOf(' private static JSONObject json('))],['stream',source.slice(source.indexOf(' @PluginMethod public void requestStream('),source.indexOf(' /** A single ephemeral voice-only feed'))]];
 const bodies=sections.map(([name,text])=>{const start=text.indexOf('if(supplied!=null)for(');assert.ok(start>=0,name);const end=text.indexOf('\n  }',start);if(name==='raw')return text.slice(start,end+4);return text.slice(start,text.indexOf('\n',start));});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-navigation-header-'));
 try{const file=path.join(dir,'NativeHeaderTest.java');fs.writeFileSync(file,`package ai.elizaresearch.alphaphone;
import org.json.*;
public class NativeHeaderTest{
 ${bodies.map((body,i)=>`static JSONObject copy${i}(JSONObject supplied)throws Exception{JSONObject headers=new JSONObject().put("Authorization","Bearer synthetic-owner");${body};return headers;}`).join('\n')}
 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 public static void main(String[]args)throws Exception{
  for(int i=0;i<2;i++){
   JSONObject supplied=new JSONObject().put("X-ElizaOS-Client-Id","renderer-1._").put("X-Eliza-Device-Id","device-1").put("Authorization","Bearer forged").put("X-Other","no");
   JSONObject out=i==0?copy0(supplied):copy1(supplied);
   check("renderer-1._".equals(out.optString("X-ElizaOS-Client-Id")),"Canonical renderer ID dropped in path "+i);
   check("device-1".equals(out.optString("X-Eliza-Device-Id")),"Device header lost");
   check("Bearer synthetic-owner".equals(out.optString("Authorization"))&&!out.has("X-Other"),"Caller expanded header authority");
   for(String invalid:new String[]{"bad id","bad\\r\\nheader","",new String(new char[129]).replace('\\0','a')}){
    boolean rejected=false;try{JSONObject bad=new JSONObject().put("X-ElizaOS-Client-Id",invalid);if(i==0)copy0(bad);else copy1(bad);}catch(IllegalArgumentException expected){rejected=true;}
    check(rejected,"Invalid renderer identity admitted in path "+i);
   }
  }
  System.out.println("PASS canonical renderer ID in both paths; invalid IDs and caller authority refused");
 }
}`);assert.match(runJvm([file],'ai.elizaresearch.alphaphone.NativeHeaderTest',{json:true}),/^PASS canonical renderer/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
