import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runJvm} from './fixtures/jvm-tools.mjs';
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
  const literal=value=>value===null?'null':typeof value==='number'?value+'L':JSON.stringify(value);
  try{
    const source=join(dir,'ResendTest.java');
    writeFileSync(source,'package ai.eliza.auth.cloud; public class ResendTest { public static void main(String[] args) {'+cases.map(([reported,header,delay])=>`if(CloudEmailCode.resendAt(${literal(reported)},${literal(header)},${now}L)!=${now+delay}L)throw new AssertionError("resend deadline");`).join('\n')+'System.out.println("PASS native resend deadlines");}}');
    // The shared native client's calculation (vendor/eliza packages/auth/android).
    const shared=join(root,'vendor/eliza/packages/auth/android');
    assert.match(runJvm([join(shared,'src/main/java/ai/eliza/auth/cloud/CloudSignInConfig.java'),join(shared,'src/main/java/ai/eliza/auth/cloud/CloudSignInEnvironment.java'),join(shared,'src/main/java/ai/eliza/auth/cloud/CloudSignInFlow.java'),join(shared,'src/main/java/ai/eliza/auth/cloud/CloudEmailCode.java'),join(shared,'test/org/json/JSONObject.java'),source],'ai.eliza.auth.cloud.ResendTest'),/PASS native resend deadlines/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
