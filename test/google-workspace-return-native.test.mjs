import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeSource,javaBinary,root as repo} from './fixtures/jvm-tools.mjs';

test('actual native Workspace return contract validates exact callback, binding and TTL',()=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-workspace-return-'));
 try {
  const source=join(root,'WorkspaceReturnTest.java');
  writeFileSync(source,`package ai.elizaresearch.alphaphone;
public class WorkspaceReturnTest {
 static int checks;
 static final String HOST="eliza.app",CALLBACK="https://eliza.app/alphaphone/gmail/callback",NONCE="A".repeat(43),USER="11111111-1111-4111-8111-111111111111",ORG="22222222-2222-4222-8222-222222222222",HASH="a".repeat(64);
 static void check(boolean ok){if(!ok)throw new AssertionError("check "+checks);checks++;}
 interface Work{void run();}
 static void invalid(Work work){try{work.run();}catch(IllegalArgumentException expected){checks++;return;}throw new AssertionError("expected rejection "+checks);}
 static GoogleWorkspaceReturn.Binding binding(String user,String org,String credential,String hash){return new GoogleWorkspaceReturn.Binding("production",user,org,credential,hash);}
 public static void main(String[]args){
  check("verified".equals(GoogleWorkspaceReturn.association(true,true,true,false)));
  check("user-selected".equals(GoogleWorkspaceReturn.association(true,true,false,true)));
  check(GoogleWorkspaceReturn.association(false,true,true,false)==null);
  check(GoogleWorkspaceReturn.association(false,true,false,true)==null);
  check(GoogleWorkspaceReturn.association(true,false,true,false)==null);
  check(GoogleWorkspaceReturn.association(true,true,false,false)==null);
  // The return is the build's App Link host plus the exact path; no host (a build without ELIZAOS_APP_LINK_HOST) means no return.
  check(CALLBACK.equals(GoogleWorkspaceReturn.callback(HOST)));
  for(String host:new String[]{null,"","Eliza.app","eliza.app:443","eliza.app/x","https://eliza.app","user@eliza.app","eliza.app.","eliza",".eliza.app","eliza..app"," eliza.app"})check(GoogleWorkspaceReturn.callback(host)==null);
  String url=CALLBACK+"#state="+NONCE+"&result=connected&connectionId=grant_1";
  GoogleWorkspaceReturn.Binding owner=binding(USER,ORG,"credential",HASH);
  GoogleWorkspaceReturn.Pending pending=new GoogleWorkspaceReturn.Pending(owner,NONCE,1000L);
  GoogleWorkspaceReturn.Callback callback=GoogleWorkspaceReturn.parse(HOST,url);
  check(callback!=null&&callback.state.equals(NONCE)&&callback.result.equals("connected")&&callback.connectionId.equals("grant_1"));
  check(GoogleWorkspaceReturn.accepts(pending,owner,callback,1000));
  check(GoogleWorkspaceReturn.accepts(pending,owner,callback,600999));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,callback,601000));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,callback,999));
  check(!GoogleWorkspaceReturn.accepts(null,owner,callback,1000));
  check(!GoogleWorkspaceReturn.accepts(pending,null,callback,1000));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,null,1000));
  for(String result:new String[]{"denied","failed"}){
   GoogleWorkspaceReturn.Callback c=GoogleWorkspaceReturn.parse(HOST,CALLBACK+"#result="+result+"&state="+NONCE);
   check(c!=null&&c.connectionId==null&&GoogleWorkspaceReturn.accepts(pending,owner,c,1000));
  }
  for(GoogleWorkspaceReturn.Binding other:new GoogleWorkspaceReturn.Binding[]{binding(ORG,ORG,"credential",HASH),binding(USER,USER,"credential",HASH),binding(USER,ORG,"other",HASH),binding(USER,ORG,"credential","b".repeat(64))})check(!GoogleWorkspaceReturn.accepts(pending,other,callback,1000));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,new GoogleWorkspaceReturn.Callback("B".repeat(43),"connected","grant_1"),1000));
  // This pure predicate does not consume; replay resistance belongs to the host's atomic CAS.
  check(GoogleWorkspaceReturn.accepts(pending,owner,callback,1001));
  for(String bad:new String[]{
   url.replace("https:","http:"),url.replace("eliza.app","evil.example"),url.replace("eliza.app","user@eliza.app"),url.replace("eliza.app","eliza.app:443"),url.replace("eliza.app","alphacompute.ai"),url.replace("eliza.app","staging.eliza.app"),url.replace("eliza.app","ELIZA.app"),url.replace("/gmail/callback","/auth/callback"),url.replace("/gmail/","/gmail%2F"),url.replace("#","?"),url.replace("#","?x=1#"),url+"&extra=x",url+"&state="+NONCE,url+"&connectionId=other",url.replace("state=","%73tate="),url.replace("state=A","state=%41"),url.replace("result=connected","result=%63onnected"),url.replace("result=connected","result=unknown"),url.replace("&connectionId=grant_1",""),url.replace("connectionId=grant_1","connectionId="),url.replace("connectionId=grant_1","connectionId=grant+1"),url.replace("connectionId=grant_1","connectionId=grant%5f1"),url.replace("connectionId=grant_1","connectionId="+"x".repeat(129)),url+"&",url+"#x",CALLBACK,CALLBACK+"#",url.replace(NONCE,"A".repeat(42))
  })check(GoogleWorkspaceReturn.parse(HOST,bad)==null);
  check(GoogleWorkspaceReturn.parse(HOST,null)==null);
  check(GoogleWorkspaceReturn.parse(HOST,CALLBACK+"#state="+NONCE+"&result=denied&connectionId=x")==null);
  check(GoogleWorkspaceReturn.parse(HOST,CALLBACK+"#state="+NONCE+"&result=failed&connectionId=x")==null);
  // Without a configured host nothing parses, and a return on one host is never admitted for another.
  for(String host:new String[]{null,"","staging.eliza.app","alphacompute.ai","ELIZA.APP"})check(GoogleWorkspaceReturn.parse(host,url)==null);
  check(GoogleWorkspaceReturn.parse("links.example.com","https://links.example.com/alphaphone/gmail/callback#state="+NONCE+"&result=denied")!=null);
  invalid(()->new GoogleWorkspaceReturn.Binding("staging",USER,ORG,"credential",HASH));
  invalid(()->binding("1-1-1-1-1",ORG,"credential",HASH));
  invalid(()->binding(USER,"not-uuid","credential",HASH));
  invalid(()->binding(USER,ORG,"",HASH));
  invalid(()->binding(USER,ORG,"x".repeat(257),HASH));
  invalid(()->binding(USER,ORG,"x\\ny",HASH));
  invalid(()->binding(USER,ORG," ",HASH));
  invalid(()->binding(USER,ORG,"credential","z".repeat(64)));
  invalid(()->new GoogleWorkspaceReturn.Pending(owner,"bad",1000));
  invalid(()->new GoogleWorkspaceReturn.Pending(owner,NONCE,-1));
  invalid(()->new GoogleWorkspaceReturn.Callback(NONCE,"connected",null));
  invalid(()->new GoogleWorkspaceReturn.Callback(NONCE,"denied","grant"));
  check(binding(USER,ORG,"credential",HASH.toUpperCase()).same(owner));
  System.out.println("PASS Workspace return pure contract "+checks);
 }
}`);
  execFileSync(javaBinary('javac'),['--release','11','-d',root,nativeSource('GoogleWorkspaceReturn.java'),source],{timeout:30000,stdio:'pipe'});
  assert.match(execFileSync(javaBinary('java'),['-cp',root,'ai.elizaresearch.alphaphone.WorkspaceReturnTest'],{timeout:30000,encoding:'utf8'}),/^PASS Workspace return pure contract 85/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the Workspace return is the build-gated App Link on ELIZAOS_APP_LINK_HOST, never a fixed domain',()=>{
 const read=file=>readFileSync(join(repo,file),'utf8');
 const gradle=read('android/app/product.gradle'),connection=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 const overlay=gradle.slice(gradle.indexOf('if (appLinkHost) {'),gradle.indexOf('} else file(appLinksManifest).delete()'));
 assert.ok(overlay.includes('<data android:scheme="https" android:host="\\${appLinkHost}" android:path="/alphaphone/gmail/callback"/></intent-filter>'),'ELIZAOS_APP_LINK_HOST adds the Workspace return beside the sign-in return');
 assert.equal(gradle.match(/\/alphaphone\/gmail\/callback/g).length,1,'no other, always-on Workspace return filter');
 assert.doesNotMatch(gradle,/workspace-return|workspaceReturnManifest/);
 // The native host, association lookup and admission all read the build's App Link host.
 for(const call of ['new GoogleWorkspaceReturnFlow(BuildConfig.ELIZAOS_APP_LINK_HOST,','GoogleWorkspaceReturn.callback(BuildConfig.ELIZAOS_APP_LINK_HOST)','getHostToStateMap().get(BuildConfig.ELIZAOS_APP_LINK_HOST)','GoogleWorkspaceReturn.parse(BuildConfig.ELIZAOS_APP_LINK_HOST,url)'])assert.ok(connection.includes(call),call);
 const tracked=execFileSync('git',['ls-files','-z','android','apps/app/src'],{cwd:repo,encoding:'utf8'}).split('\0').filter(file=>/\.(java|kt|gradle|xml|ts|tsx|js|mjs|json)$/.test(file));
 assert.ok(tracked.length>100);
 for(const file of tracked)assert.doesNotMatch(read(file),/alphacompute\.ai/,file);
});
