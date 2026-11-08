import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['apps/app/src/runtime/action-message-presentation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {workflowReplyText}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
// The exact reply shape plugin-workflow's WORKFLOW run action returns (workflow.ts op 'run').
const marker=JSON.stringify({id:'run-1',workflowId:'wf-1',runId:'run-1',title:'Morning digest',steps:[{label:'Read mail',nodeId:'n1',status:'pending'}],widgets:[]});
const reply=`Submitted workflow run run-1.\n\n[WORKFLOW]\n${marker}\n[/WORKFLOW]`;

test('a well-formed workflow block becomes a run card and keeps the submitted line',()=>{
 assert.deepEqual(workflowReplyText(reply),{text:'Submitted workflow run run-1.',runs:[{workflowId:'wf-1',runId:'run-1',title:'Morning digest'}]});
 const around=workflowReplyText('Starting it now.\n'+reply.slice(reply.indexOf('[WORKFLOW]'))+'\n\nI will tell you when it finishes.');
 assert.equal(around.text,'Starting it now.\n\nI will tell you when it finishes.');assert.equal(around.runs.length,1);
 // No title falls back to a plain label.
 assert.equal(workflowReplyText('[WORKFLOW]\n{"workflowId":"wf-2","runId":"run-2"}\n[/WORKFLOW]').runs[0].title,'Workflow run');
});

test('malformed and unterminated blocks are removed and give no card',()=>{
 for(const body of ['{not json','[]','"run-1"','{"workflowId":"wf-1"}','{"runId":"run-1","workflowId":7}','{"runId":"","workflowId":"wf-1"}',''])
  assert.deepEqual(workflowReplyText(`Submitted workflow run run-1.\n\n[WORKFLOW]\n${body}\n[/WORKFLOW]\n\nDone.`),{text:'Submitted workflow run run-1.\n\nDone.',runs:[]},body);
 // A cut-off block (a stream still arriving, or a truncated reply) is hidden, even with complete JSON.
 assert.deepEqual(workflowReplyText(`Submitted workflow run run-1.\n\n[WORKFLOW]\n${marker}`),{text:'Submitted workflow run run-1.',runs:[]});
 assert.deepEqual(workflowReplyText(`Submitted workflow run run-1.\n\n[WORKFLOW]\n{"id":"run-1","workfl`),{text:'Submitted workflow run run-1.',runs:[]});
 assert.deepEqual(workflowReplyText('Submitted workflow run run-1.\n\n[WORKFLOW]'),{text:'Submitted workflow run run-1.',runs:[]});
});

test('ordinary text, including prose that names the tag, is kept exactly',()=>{
 for(const text of ['  An indented reply.\n\n\tSecond paragraph.  \n','The reply marker is [WORKFLOW] followed by JSON.','Use [WORKFLOW] and [/WORKFLOW] tags.'])
  assert.deepEqual(workflowReplyText(text),{text,runs:[]});
});

test('the text left for speech has no block',()=>{
 for(const text of [reply,reply.slice(0,-'[/WORKFLOW]'.length),reply+'\n[WORKFLOW]\n{"broken"'])
  assert.doesNotMatch(workflowReplyText(text).text,/WORKFLOW\]|runId|"steps"/);
});
