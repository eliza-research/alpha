import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=readFileSync('apps/app/src/prototype/inbox-cloud-adapter.ts','utf8');
const start=source.indexOf('    const googleConnected=');
const end=source.indexOf('    // The shared Home mail card',start);
assert.ok(start>=0&&end>start,'actual Home connection projection exists');
const project=new Function('accounts','connected','binding','accountsChecked','accountsSession','connectionController',source.slice(start,end)+';return homeGoogleConnected;');
const value=(change={})=>{
 const state={accounts:[{connected:true}],connected:true,binding:{sessionId:'current'},accountsChecked:true,accountsSession:'current',startupResolved:true,...change};
 return project(state.accounts,state.connected,state.binding,state.accountsChecked,state.accountsSession,{getSnapshot:()=>({startupResolved:state.startupResolved})});
};
test('Home Google connection stays unknown until a current-session account read',()=>{
 for(const change of [{accountsSession:'previous'},{accountsChecked:false},{startupResolved:false},{binding:null}])assert.equal(value(change),undefined);
 assert.equal(value(),true);
 assert.equal(value({accounts:[{connected:true}],connected:false}),true,'Calendar-only Google connection counts');
 assert.equal(value({accounts:[],connected:false}),false);
});
