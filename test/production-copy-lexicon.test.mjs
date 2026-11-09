// scripts/audit-production-copy.mjs on fixture sources: it reports implementation terms in
// user copy, keeps reviewed uses, and never reads protocol keys or test-mocks-only branches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {scanScriptSource,scanJavaSource,copyFindings,readLexicon,auditProductionCopy} from '../scripts/audit-production-copy.mjs';

const lexicon=readLexicon();
const findings=(file,source)=>copyFindings(scanScriptSource(file,source),lexicon).map(({term,text})=>({term,text}));

test('a flagged JSX string, an allowlisted one and a protocol key',()=>{
  const source=`export const View=({receipt}:{receipt:{provider:string}})=><section>
    <p>Reconnect the current phone enrollment before reviewing sources.</p>
    <label>Cerebras API key<input/></label>
    <span data-kind={receipt.provider==='cerebras'?'provider':'receipt'}>{receipt.provider}</span>
  </section>;
  const body={provider:'cerebras',receipt:'r1',enrollmentId:'e1',runtime:'cloud-runtime'};`;
  assert.deepEqual(findings('apps/app/src/runtime/connection-ui.tsx',source),[{term:'enrollment',text:'Reconnect the current phone enrollment before reviewing sources.'}]);
  // The same label outside its reviewed file is reported.
  assert.deepEqual(findings('apps/app/src/runtime/other.tsx','const v=<label>Cerebras API key</label>;'),[{term:'vendor',text:'Cerebras API key'}]);
});

test('copy sinks, DOM text, Error messages and *Message() returns are read; test-mocks branches are not',()=>{
  const source=`
    setMessage(ok?'Saved.':'Open this workflow to reconcile its phone receipts');
    toast(\`The \${name} runtime changed. Try again.\`);
    el.textContent='Attach a receipt in Inbox.';
    el.setAttribute('aria-label','Workflow adapter');
    el.setAttribute('data-provider','The provider key');
    throw new Error('The local runtime must expose exactly one agent.');
    function failureMessage(code){ return code==='x'?'The provider refused this.':'Try again.'; }
    const offMessage=()=>ok?'Saved.':'Sign in to turn the provider back on.';
    const label=()=>'The provider key';
    throw speechError('local-runtime','Connect the local runtime to transcribe.');
    setSubmissionError('That receipt could not be confirmed.');
    function payload(){ return 'provider receipt runtime'; }
    setNotice(testMocksEnabled?'Development provider selected':'Saved.');
    if(testMocksEnabled) toast('Mock provider ready.');
    const extra=testMocksEnabled&&ready&&<p>Development runtime attached.</p>;
    setMessage('provider');`;
  assert.deepEqual(findings('apps/app/src/prototype/x.tsx',source),[
    {term:'receipt',text:'Open this workflow to reconcile its phone receipts'},
    {term:'reconcil',text:'Open this workflow to reconcile its phone receipts'},
    {term:'runtime',text:'The … runtime changed. Try again.'},
    {term:'receipt',text:'Attach a receipt in Inbox.'},
    {term:'adapter',text:'Workflow adapter'},
    {term:'runtime',text:'The local runtime must expose exactly one agent.'},
    {term:'provider',text:'The provider refused this.'},
    {term:'provider',text:'Sign in to turn the provider back on.'},
    {term:'runtime',text:'Connect the local runtime to transcribe.'},
    {term:'receipt',text:'That receipt could not be confirmed.'},
  ]);
});

test('Java Toast and notification text is read; other Java strings are not',()=>{
  const source=`class A{void f(){
    Toast.makeText(context,"Inference adapter failed",Toast.LENGTH_SHORT).show();
    builder.setContentTitle(title.isEmpty()?"Navigation":title).setContentText("Open Alpha Phone\\nto review.");
    Log.w(TAG,"provider runtime receipt missing");
    String key="provider";
  }}`;
  const copy=scanJavaSource('android/app/src/main/java/A.java',source);
  assert.deepEqual(copy.map(item=>item.text),['Inference adapter failed','Navigation','Open Alpha Phone to review.']);
  assert.equal(copy[0].line,2);
  assert.deepEqual(copyFindings(copy,lexicon).map(item=>item.term),['inference','adapter']);
});

test('the CLI reports findings and exits 0 while ignored development sources are skipped',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'alpha-copy-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(file,content)=>{mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),content);};
  write('apps/app/src/runtime/a.tsx','export const A=()=><p>Choose an MVP provider.</p>;');
  write('apps/app/src/runtime/development-b.tsx','export const B=()=><p>Development provider ready.</p>;');
  write('android/app/src/main/java/C.java','class C{void f(){Toast.makeText(c,"Receipt saved",0).show();}}');
  const result=auditProductionCopy({root,lexicon});
  assert.deepEqual(result.findings.map(item=>`${item.term} ${item.file}:${item.line}`).sort(),
    ['MVP apps/app/src/runtime/a.tsx:1','provider apps/app/src/runtime/a.tsx:1','receipt android/app/src/main/java/C.java:1']);
  const run=spawnSync(process.execPath,[path.resolve('scripts/audit-production-copy.mjs')],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/^REPORT \d+ implementation term\(s\) in \d+ pieces of user copy/m);
  assert.equal(spawnSync(process.execPath,[path.resolve('scripts/audit-production-copy.mjs'),'--strict'],{encoding:'utf8'}).status,2);
});
