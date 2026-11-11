import {prepareNativeFixture,noticeSources} from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
import {javaBinary as binary} from './fixtures/jvm-tools.mjs';
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
// Without the pinned org.json jar NativeDigestSources is never compiled. On CI that is a failure, not a
// skip, so bun run verify cannot pass there without this test; elsewhere the skip is printed.
const missingJar='Pinned JVM JSON dependency unavailable (no org.json 20250517 jar in ~/.gradle and ALPHA_JSON_JAR unset)';
if(!jsonJar&&!process.env.CI)process.stderr.write(`SKIPPED native digest sources: ${missingJar}. Run a Gradle build once or set ALPHA_JSON_JAR.\n`);
test('native digest consent and source reads remain bounded across persistence and revocation',{skip:!jsonJar&&!process.env.CI?missingJar:false},()=>{
 assert.ok(jsonJar,`${missingJar}. CI must provide it (ALPHA_JSON_JAR or the Gradle cache).`);
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'native-digest-'));
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...noticeSources(prepareNativeFixture(root,temporary).root,'NoticeOwner'),join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/NativeDigestSources.java'),join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/HostedResultNotices.java'),join(root,'test/fixtures/NativeDigestSourcesTest.java')],{timeout:20000});
  assert.match(execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.alphacompute.alphaphone.NativeDigestSourcesTest'],{encoding:'utf8',timeout:20000}),/^PASS native digest sources/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('native digest reads accept every occurrence the agent admits',()=>{
 const root=resolve(import.meta.dirname,'..');
 const policy=readFileSync(join(root,'vendor/eliza/plugins/plugin-workflow/src/services/hosted-digest-policy.ts'),'utf8').match(/export const DIGEST_RUN_WINDOW_MS = (\d+) \* (\d+)_?(\d*);/);
 const native=readFileSync(join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/NativeDigestSources.java'),'utf8').match(/static final long NATIVE_READ_PAST_MS=(\d+)L\*(\d+);/);
 assert.ok(policy&&native,'run window constants moved');
 assert.ok(Number(native[1])*Number(native[2])>=Number(policy[1])*Number(policy[2]+policy[3]));
});
