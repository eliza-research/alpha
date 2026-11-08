import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
const helper=stripTypeScriptTypes(readFileSync('apps/app/src/runtime/prepared-view-navigation.ts','utf8'),{mode:'transform'}).replace(/^export /gm,'');
const admitted=new Function(helper+';return isPreparedViewNavigationRequest;')();
const valid={clientId:'renderer-1',delivery:'completed-action',prepareOnly:true,viewType:'gui',completedActionHandoffId:'observed-1'};
const cases=[
 ...['settings','calendar','chat','automations'].map(view=>({path:`/api/views/${view}/navigate`,body:valid,method:'POST',owner:'owner',allowed:true})),
 ...[undefined,false,'true'].map(prepareOnly=>({body:{...valid,prepareOnly},allowed:false})),
 ...[{delivery:'originating-client'},{viewType:'tui'},{action:'close'},{clientId:'bad id'},{completedActionHandoffId:''}].map(change=>({body:{...valid,...change},allowed:false})),
 ...['/api/views/../calendar/navigate','/api/views/%63alendar/navigate','/api/views/calendar/navigate?x=1','/api/views/calendar/navigate\n','/api/views/calendar/navigate\r\n','/api/views/calendar/navigate\t','/api/views/calendar/navigate\u0000'].map(path=>({path,allowed:false})),
 ...['\n','\r','\u2028','\u2029'].flatMap(end=>[
  {path:'/api/views/calendar/navigate'+end,allowed:false},
  {body:{...valid,clientId:'renderer-1'+end},allowed:false},
  {body:{...valid,completedActionHandoffId:'observed-1'+end},allowed:false},
 ]),
 {method:'GET',allowed:false},{owner:null,allowed:false},
].map(row=>({path:'/api/views/calendar/navigate',body:valid,method:'POST',owner:'owner',...row}));
test('local and remote navigation entrypoints admit only exact preparation, retaining claim/result',async()=>{
 for(const file of ['local-agent.ts','remote-protocol.ts']){
  const source=readFileSync('apps/app/src/runtime/'+file,'utf8');
  const body=source.match(/async viewNavigationRequest\([^]*?\):Promise<unknown> \{([^]*?)\n  \}/)[1];
  const method=new Function('isPreparedViewNavigationRequest','RemoteProtocolError','path','body','signal', 'return(async()=>{'+body+'}).call(this);');
  for(const row of cases.filter(row=>row.method==='POST'&&row.owner)){
   let calls=0;const receiver={json:async()=>{calls++;return{};},authorized:async()=>{calls++;return{};}};
   if(row.allowed)await method.call(receiver,admitted,Error,row.path,row.body,new AbortController().signal);
   else await assert.rejects(method.call(receiver,admitted,Error,row.path,row.body,new AbortController().signal));
   assert.equal(calls,row.allowed?1:0,file+JSON.stringify(row));
  }
  for(const path of ['/api/views/interact-claim','/api/views/interact-result'])await method.call({json:async()=>({}),authorized:async()=>({})},admitted,Error,path,{},new AbortController().signal);
 }
});
test('actual native request gate agrees on preparation shape, method, owner and encoded paths',{skip:jsonJarSkip},()=>{
 const source=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const start=source.indexOf('  if((group!=null?',source.indexOf(' @PluginMethod public void request('));
 const end=source.indexOf('){',start);const expression=source.slice(start+5,end);
 const temp=mkdtempSync(join(tmpdir(),'alpha-navigation-gate-'));
 try{
  const file=join(temp,'NavigationGateTest.java');
  writeFileSync(file,`package ai.elizaresearch.alphaphone;
import org.json.*;
class OwnerRoutes { boolean allowed(String g,String p,String m){return true;} }
public class NavigationGateTest {
 static boolean allowed(String path,String method,String body,String expectedOwner){
  if(path.endsWith("/navigate")&&!PreparedViewNavigation.allowed(path,method,body))return false;
  String group=null;OwnerRoutes routes=new OwnerRoutes();return !(${expression});
 }
 public static void main(String[]args)throws Exception{
  JSONArray rows=new JSONArray(new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
  for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String owner=r.isNull("owner")?null:r.getString("owner");boolean observed=allowed(r.getString("path"),r.getString("method"),r.getJSONObject("body").toString(),owner);if(observed!=r.getBoolean("allowed"))throw new AssertionError("Case "+i);}
  if(!allowed("/api/views/interact-claim","POST","{}","owner")||!allowed("/api/views/interact-result","POST","{}","owner"))throw new AssertionError("Existing routes changed");
  System.out.println("PASS native actual request gate");
 }
}`);
  assert.match(runJvm([nativeSource('PreparedViewNavigation.java'),file],'ai.elizaresearch.alphaphone.NavigationGateTest',{json:true,input:JSON.stringify(cases)}),/PASS native actual request gate/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
