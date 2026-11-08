import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ALPHA_SETTINGS_SOURCE||'apps/app/src/prototype/settings-adapter.ts','utf8');
const row=source.split('\n').find(line=>line.includes("kNav:true,label:'Sign out'"));assert.ok(row,'Account and plan Sign out row');
for(const accepted of [false,true])test(`Settings sign-out ${accepted?'confirms once':'cancels without changing the account'}`,()=>{
 const prompts=[],calls=[];
 const box={serviceName:'Eliza Cloud',window:{confirm:text=>{prompts.push(text);return accepted;}},connectionController:{cloudSignOut:()=>{calls.push('sign-out');return Promise.resolve();}}};
 const action=vm.runInNewContext('('+row.trim().replace(/,$/,'')+')',box);
 assert.equal(calls.length,0,'rendering does not sign out');assert.equal(prompts.length,0);
 action.go();assert.deepEqual(prompts,['Sign out of Eliza Cloud? Your notes and chats will stay on this phone.']);assert.deepEqual(calls,accepted?['sign-out']:[]);
});
