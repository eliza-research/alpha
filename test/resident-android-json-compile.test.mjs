import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {javaBinary,nativeSource} from './fixtures/jvm-tools.mjs';

const roots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,path.join(os.homedir(),'Library/Android/sdk'),path.join(os.homedir(),'Android/Sdk')].filter(Boolean);
const androidJar=roots.flatMap(root=>{
 const platforms=path.join(root,'platforms');
 if(!fs.existsSync(platforms))return [];
 return fs.readdirSync(platforms).filter(name=>/^android-\d+$/.test(name)).sort((a,b)=>Number(b.slice(8))-Number(a.slice(8))).map(name=>path.join(platforms,name,'android.jar')).filter(file=>fs.existsSync(file));
})[0];

// Android's JSONException is checked; the desktop org.json fixture jar cannot prove this compilation.
test('resident session and transport compile against Android JSON signatures',{skip:!androidJar&&'Android SDK required; full Android build remains a separate gate'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-android-json-'));
 try{
  const declarations=path.join(dir,'Collaborators.java');
  // Only collaborator type surfaces are fixtures. Both production classes and org.json are real.
  fs.writeFileSync(declarations,`package ai.alphacompute.alphaphone;
import org.json.JSONObject;
final class HostedInbox {
 interface Store {String read(String slot)throws Exception;void write(String slot,String value)throws Exception;void remove(String slot)throws Exception;}
 interface DeliveryTransport extends AutoCloseable {JSONObject request(String path,JSONObject body)throws Exception;void check()throws Exception;void verify()throws Exception;void close();}
 static String id(String value)throws Exception{return value;}
}
final class HostedResultNotices {static String hash(String value){return value;}}
`);
  const session=nativeSource('ResidentResultSession.java');
  execFileSync(javaBinary('javac'),['--release','11','-cp',androidJar,'-sourcepath',dir,'-d',dir,declarations,nativeSource('ResidentResultTransport.java'),session],{stdio:'pipe',timeout:30000});
  assert.ok(fs.existsSync(path.join(dir,'ai/alphacompute/alphaphone/ResidentResultSession.class')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
