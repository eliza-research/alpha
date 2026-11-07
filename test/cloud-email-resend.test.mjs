import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runJvm} from './fixtures/jvm-tools.mjs';
import {execFileSync} from 'node:child_process';
import {emailCodeResendAt} from '../scripts/cloud-email-code.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const cases=[
  [null,null,30000], [null,'5',30000], [now+60000,null,60000],
  [new Date(now+90000).toISOString(),null,90000], [null,'120',120000],
  [now+45000,new Date(now+180000).toUTCString(),180000],
  ['invalid','not a date',30000], [now-1000,'0',30000],
];
test('browser email resend uses a thirty-second minimum and never shortens server deadlines',()=>{
  for(const [reported,header,delay]of cases)assert.equal(emailCodeResendAt(reported,header,now),now+delay);
});
test('the actual native resend calculation matches all browser deadline cases',()=>{
  const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-resend-'));
  const java=process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
  const literal=value=>value===null?'null':typeof value==='number'?value+'L':JSON.stringify(value);
  try{
    const source=join(dir,'ResendTest.java');
    writeFileSync(source,'package ai.eliza.auth.cloud; public class ResendTest { public static void main(String[] args) {'+cases.map(([reported,header,delay])=>`if(CloudEmailCode.resendAt(${literal(reported)},${literal(header)},${now}L)!=${now+delay}L)throw new AssertionError("resend deadline");`).join('\n')+'System.out.println("PASS native resend deadlines");}}');
    // The shared native client's calculation (vendor/eliza packages/auth/android).
    const shared=join(root,'vendor/eliza/packages/auth/android');
    assert.match(runJvm([join(shared,'src/main/java/ai/eliza/auth/cloud/CloudSignInConfig.java'),join(shared,'src/main/java/ai/eliza/auth/cloud/CloudSignInEnvironment.java'),join(shared,'src/main/java/ai/eliza/auth/cloud/CloudSignInFlow.java'),join(shared,'src/main/java/ai/eliza/auth/cloud/CloudEmailCode.java'),join(shared,'test/org/json/JSONObject.java'),source],'ai.eliza.auth.cloud.ResendTest'),/PASS native resend deadlines/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('native and browser send paths retain server cooldowns before rejecting failed sends',()=>{
  const native=readFileSync(new URL('../vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java',import.meta.url),'utf8');
  assert.ok(native.includes('connection.getHeaderField("Retry-After")'));
  assert.ok(native.indexOf('emailSendAllowedAt = Math.max(emailSendAllowedAt, resendAt)')<native.indexOf('if (sent.status != 200'));
  const browser=readFileSync(new URL('../scripts/browser-cloud-dev-bridge.ts',import.meta.url),'utf8');
  assert.ok(browser.includes("response.headers.get('Retry-After')"));
  assert.ok(browser.indexOf('emailSendAllowedAt=Math.max(emailSendAllowedAt,emailCodeResendAt')<browser.indexOf('if(sent.status!==200'));
});
