import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
// The Eliza Cloud page is a pure function in the settings-facts region of the adapter.
const text=readFileSync(process.env.SETTINGS_SOURCE||'apps/app/src/prototype/settings-adapter.ts','utf8');
const start=text.indexOf('        const plan=connectionController.residentPlanSettings();');
const end=text.indexOf("        page.groups.push(group([{...connectionHelpRow()",start);
assert(start>=0&&end>start);
const source=stripTypeScriptTypes(text.slice(start,end),{mode:'strip'});
for(const busy of [false,true])test(`legacy account navigation delegates without financial effects while busy=${busy}`,()=>{
 let opened=0,cancellations=0,signouts=0,confirmations=0;const box={window:{confirm:()=>{confirmations++;return true;}},serviceName:'Nebula',state:{page:'cloud-plan'},connection:{busy,message:'Signing out…'},connectionController:{residentPlanSettings:()=>({signedIn:true,account:'synthetic@example.invalid',plan:'Synthetic plan',inference:'Unavailable'}),openPlan:()=>{opened++;},cancel:()=>{cancellations++;},cloudSignOut:()=>{signouts++;}},info:(label,value)=>({label,value}),group:rows=>({rows}),action:(label,go)=>({label,go}),runtimeLocation:'On this device',page:{groups:[]},out:{stack:[]},api:{set:()=>{}}};
 vm.runInNewContext(source,box);assert.equal(box.out.stack[0].title,'Account');const rows=box.out.stack[0].groups.at(-1).rows;
 assert.deepEqual(Array.from(rows,r=>r.label),['Open account']);rows[0].go();
 assert.equal(opened,1);assert.equal(cancellations,0);assert.equal(signouts,0);assert.equal(confirmations,0);
});
