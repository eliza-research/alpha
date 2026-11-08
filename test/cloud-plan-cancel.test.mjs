import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const text=readFileSync(process.env.SETTINGS_SOURCE||'apps/app/src/prototype/settings-adapter.ts','utf8');
const start=text.indexOf('        const plan=connectionController.residentPlanSettings();');
const end=text.indexOf("        page.groups.push(group([{kNav:true,label:'Agent connection'",start);
assert(start>=0&&end>start);
const source=stripTypeScriptTypes(text.slice(start,end),{mode:'transform'});
for(const busy of [false,true])test(`Cloud account operations retain a usable ${busy?'Cancel':'Sign out'} action`,()=>{
 let cancellations=0,signouts=0;const box={serviceName:'Nebula',state:{page:'cloud-plan'},connection:{busy,message:'Signing out…'},connectionController:{residentPlanSettings:()=>({signedIn:true,account:'synthetic@example.invalid',plan:'Synthetic plan',inference:'Unavailable'}),cancel:()=>{cancellations++;},cloudSignOut:()=>{signouts++;}},info:(label,value)=>({label,value}),group:rows=>({rows}),action:(label,go)=>({label,go}),runtimeLocation:'On this device',page:{groups:[]},out:{stack:[]},api:{set:()=>{}}};
 vm.runInNewContext(source,box);assert.equal(box.out.stack[0].title,'Nebula account & plan');const rows=box.out.stack[0].groups.at(-1).rows;
 if(busy){assert.deepEqual(Array.from(rows,r=>r.label),['Cancel']);assert(box.out.stack[0].groups[0].rows.some(r=>r.label==='Status'&&r.value==='Signing out…'));rows[0].go();assert.equal(cancellations,1);assert.equal(signouts,0);}
 else{const signout=rows.find(r=>r.label==='Sign out');assert(signout);assert(!rows.some(r=>r.label==='Cancel'));signout.go();assert.equal(signouts,1);}
});
