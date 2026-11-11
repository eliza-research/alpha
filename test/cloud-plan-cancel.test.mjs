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
for(const busy of [false,true])test(`Cloud account uses the shared account panel while busy=${busy}`,()=>{
 let opened=0,signouts=0;
 const box={serviceName:'Nebula',state:{page:'cloud-plan'},connection:{busy},
  connectionController:{residentPlanSettings:()=>({signedIn:true,account:'synthetic@example.invalid',plan:'Synthetic plan',inference:'Unavailable'}),openPlan:()=>{opened++;},cloudSignOut:()=>{signouts++;}},
  info:(label,value)=>({label,value}),group:rows=>({rows}),action:(label,go)=>({label,go}),runtimeLocation:'On this device',page:{groups:[]},out:{stack:[]},api:{set:()=>{}}};
 vm.runInNewContext(source,box);
 const panel=box.out.stack[0],rows=panel.groups[0].rows;
 assert.equal(panel.title,'Account');
 assert.deepEqual(Array.from(rows,row=>row.label),['Open account']);
 rows[0].go();assert.equal(opened,1);assert.equal(signouts,0);
});
