import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeSource,javaBinary} from './fixtures/jvm-tools.mjs';

test('actual native Workspace return contract validates exact callback, binding and TTL',()=>{
 const root=mkdtempSync(join(tmpdir(),'alpha-workspace-return-'));
 try {
  const source=join(root,'WorkspaceReturnTest.java');
  writeFileSync(source,`package ai.elizaresearch.alphaphone;
public class WorkspaceReturnTest {
 static int checks;
 static final String NONCE="A".repeat(43),USER="11111111-1111-4111-8111-111111111111",ORG="22222222-2222-4222-8222-222222222222",HASH="a".repeat(64);
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
  String url=GoogleWorkspaceReturn.CALLBACK+"#state="+NONCE+"&result=connected&connectionId=grant_1";
  GoogleWorkspaceReturn.Binding owner=binding(USER,ORG,"credential",HASH);
  GoogleWorkspaceReturn.Pending pending=new GoogleWorkspaceReturn.Pending(owner,NONCE,1000L);
  GoogleWorkspaceReturn.Callback callback=GoogleWorkspaceReturn.parse(url);
  check(callback!=null&&callback.state.equals(NONCE)&&callback.result.equals("connected")&&callback.connectionId.equals("grant_1"));
  check(GoogleWorkspaceReturn.accepts(pending,owner,callback,1000));
  check(GoogleWorkspaceReturn.accepts(pending,owner,callback,600999));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,callback,601000));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,callback,999));
  check(!GoogleWorkspaceReturn.accepts(null,owner,callback,1000));
  check(!GoogleWorkspaceReturn.accepts(pending,null,callback,1000));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,null,1000));
  for(String result:new String[]{"denied","failed"}){
   GoogleWorkspaceReturn.Callback c=GoogleWorkspaceReturn.parse(GoogleWorkspaceReturn.CALLBACK+"#result="+result+"&state="+NONCE);
   check(c!=null&&c.connectionId==null&&GoogleWorkspaceReturn.accepts(pending,owner,c,1000));
  }
  for(GoogleWorkspaceReturn.Binding other:new GoogleWorkspaceReturn.Binding[]{binding(ORG,ORG,"credential",HASH),binding(USER,USER,"credential",HASH),binding(USER,ORG,"other",HASH),binding(USER,ORG,"credential","b".repeat(64))})check(!GoogleWorkspaceReturn.accepts(pending,other,callback,1000));
  check(!GoogleWorkspaceReturn.accepts(pending,owner,new GoogleWorkspaceReturn.Callback("B".repeat(43),"connected","grant_1"),1000));
  // This pure predicate does not consume; replay resistance belongs to the host's atomic CAS.
  check(GoogleWorkspaceReturn.accepts(pending,owner,callback,1001));
  for(String bad:new String[]{
   url.replace("https:","http:"),url.replace("alphacompute.ai","evil.example"),url.replace("alphacompute.ai","user@alphacompute.ai"),url.replace("alphacompute.ai","alphacompute.ai:443"),url.replace("/gmail/callback","/auth/callback"),url.replace("/gmail/","/gmail%2F"),url.replace("#","?"),url.replace("#","?x=1#"),url+"&extra=x",url+"&state="+NONCE,url+"&connectionId=other",url.replace("state=","%73tate="),url.replace("state=A","state=%41"),url.replace("result=connected","result=%63onnected"),url.replace("result=connected","result=unknown"),url.replace("&connectionId=grant_1",""),url.replace("connectionId=grant_1","connectionId="),url.replace("connectionId=grant_1","connectionId=grant+1"),url.replace("connectionId=grant_1","connectionId=grant%5f1"),url.replace("connectionId=grant_1","connectionId="+"x".repeat(129)),url+"&",url+"#x",GoogleWorkspaceReturn.CALLBACK,GoogleWorkspaceReturn.CALLBACK+"#",url.replace(NONCE,"A".repeat(42))
  })check(GoogleWorkspaceReturn.parse(bad)==null);
  check(GoogleWorkspaceReturn.parse(null)==null);
  check(GoogleWorkspaceReturn.parse(GoogleWorkspaceReturn.CALLBACK+"#state="+NONCE+"&result=denied&connectionId=x")==null);
  check(GoogleWorkspaceReturn.parse(GoogleWorkspaceReturn.CALLBACK+"#state="+NONCE+"&result=failed&connectionId=x")==null);
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
  assert.match(execFileSync(javaBinary('java'),['-cp',root,'ai.elizaresearch.alphaphone.WorkspaceReturnTest'],{timeout:30000,encoding:'utf8'}),/^PASS Workspace return pure contract 63/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
