import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeFixture} from './fixtures/native-source.mjs';
const root=resolve(import.meta.dirname,'..');
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jar=process.env.ALPHA_JSON_JAR||cached;
test('patched native secure store handles actual 32 MiB authenticated records within 192 MiB heap',{skip:!jar?'Pinned JVM JSON dependency unavailable':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-secure-memory-'));
 const relative='plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java';
 try{
  const source=join(dir,relative);mkdirSync(dirname(source),{recursive:true});
  writeFileSync(source,readFileSync(join(prepareNativeFixture(root,dir).root,relative)));
  let java=readFileSync(source,'utf8');
  // Only host unavailable Android key acquisition is adapted. AES/GCM, AAD,
  // JSON parsing, bounded reads, committed-byte checks and CAS are real source.
  java=java.replace('import android.security.keystore.KeyGenParameterSpec;','').replace('import android.security.keystore.KeyProperties;','');
  const start=java.indexOf(' private SecretKey key()'),end=java.indexOf(' private static Object parseJson',start);
  assert.ok(start>0&&end>start);
  java=java.slice(0,start)+' private SecretKey key(){return new javax.crypto.spec.SecretKeySpec(new byte[32],"AES");}\n'+java.slice(end);
  writeFileSync(source,java);
  const fixture=join(root,'test/fixtures/secure-store-memory');
  const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(binary('javac'),['--release','11','-cp',jar,'-d',dir,source,join(fixture,'android/util/AtomicFile.java'),join(fixture,'MemoryTest.java')],{timeout:60000,stdio:'pipe'});
  const result=execFileSync(binary('java'),['-Xmx192m','-cp',dir+':'+jar,'MemoryTest',join(dir,'slots')],{timeout:600000,encoding:'utf8'});
  assert.match(result,/PASS 32 MiB authenticated write\/read\/CAS with 192 MiB heap/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
