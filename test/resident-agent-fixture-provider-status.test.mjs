import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

// Execute only the shared fake IPC model, never the product/native controller.
const source=readFileSync(new URL('./browser/helpers/resident-agent-plugin.ts',import.meta.url),'utf8');
const start=source.indexOf('function defineResidentAgentPlugin()');
assert.ok(start>=0,'actual fixture model entry');
const body=transformSync(source.slice(start),{loader:'ts',format:'cjs'}).code;
function make(extra={}){
 const window={createNativeNavigationFixture:()=>({register(){},request(){return undefined;}})};
 new Function('window',body+';defineResidentAgentPlugin();')(window);
 return window.createResidentAgentPlugin({owner:()=> 'fixture-owner',agentId:'fixture-agent',...extra});
}
test('provider status is opt-in and existing custom-provider fixtures retain their route',()=>{
 const agent=make();
 assert.equal(agent.methods(['getStatus','start','request']).some(row=>row.name==='providerStatus'),false);
 assert.equal(agent.answer('providerStatus',{}),undefined);
 assert.deepEqual(agent.state.unexpected,[]);
});
test('explicit resident fixture exposes an unconfigured Cloud read without inventing keys or inference',()=>{
 const agent=make({providerStatus:{provider:'elizacloud',configured:false}});
 assert.deepEqual(agent.methods(['start','request']).filter(row=>row.name==='providerStatus'),[{name:'providerStatus',rtype:'promise'}]);
 assert.deepEqual(agent.answer('providerStatus',{}),{provider:'elizacloud',configured:false});
 assert.equal(agent.answer('start',{}),undefined,'start still belongs to the spec native boundary');
 assert.deepEqual(agent.state.unexpected,[]);
});
test('provider fixture read returns a copy and does not alter its configured source',()=>{
 const status={provider:'cerebras',configured:true,selected:true,model:'fixture-model'};
 const agent=make({providerStatus:status});
 const first=agent.answer('providerStatus',{});first.configured=false;
 assert.deepEqual(agent.answer('providerStatus',{}),status);
 assert.equal(status.configured,true);
 assert.equal(agent.methods(['providerStatus']).filter(row=>row.name==='providerStatus').length,1);
});
test('provider capability leaves native navigation owner-fence failures observable',()=>{
 const agent=make({providerStatus:{provider:'elizacloud',configured:false}});
 assert.throws(()=>agent.answer('subscribeViewEvents',{subscriptionId:'s',ownerId:'other-owner',clientId:'client'}),/Invalid view event subscription/);
 assert.deepEqual(agent.state.unexpected,['Agent.subscribeViewEvents']);
});

test('all four connection-sheet fixture constructors opt in, without changing owner fences',()=>{
 for(const name of ['reminder-notice-question.spec.ts','resident-background-results.spec.ts','workflow-notice-taps.spec.ts','connection-activity-presentation.spec.ts']){
  const spec=readFileSync(new URL('./browser/'+name,import.meta.url),'utf8');
  const calls=spec.split('\n').filter(line=>line.includes('.createResidentAgentPlugin('));
  assert.equal(calls.length,1,name+' has one explicit native model constructor');
  assert.match(calls[0],/providerStatus:\s*\{provider:\s*'elizacloud',\s*configured:\s*false\}/,name+' opts in at the constructor');
 }
 const workflows=readFileSync(new URL('./browser/workflow-notice-taps.spec.ts',import.meta.url),'utf8');
 assert.equal(workflows.split('\n').find(line=>line.startsWith('const ownerFence=')),"const ownerFence=(ownerId:string)=>({owner:{origin:'https://device.alpha.invalid',ownerId,agentId:'fixture-agent'}});");
});
