import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ALPHA_SETTINGS_SOURCE||'apps/app/src/prototype/settings-adapter.ts','utf8');
const row=source.split('\n').find(line=>line.includes("kNav:true,label:'Sign out'"));assert.ok(row,'Account and plan Sign out row');
const helper=source.slice(source.indexOf('  async function reviewSignOut(){'),source.indexOf('  let passwordOpening=',source.indexOf('  async function reviewSignOut(){')));
for(const accepted of [false,true])test(`Settings sign-out ${accepted?'confirms once':'cancels without changing the account'}`,async()=>{
 const prompts=[],calls=[],identity={sessionId:'owner-session',credentialId:'owner-credential'};
 const box={owner:{live:true,S:()=>({view:'settings'}),vget:()=>({page:'cloud-plan'})},accountReviews:{confirm:async(...args)=>{prompts.push(args);return accepted;}},connectionController:{getCloudClient:()=>identity,cloudSignOut:async()=>{calls.push('sign-out');}}};
 const review=vm.runInNewContext('('+helper.trim().replace('async function reviewSignOut','async function')+')',box);
 assert.equal(calls.length,0);await review();
 assert.equal(prompts.length,1);assert.equal(prompts[0][1],'Sign out?');assert.deepEqual(calls,accepted?['sign-out']:[]);
});
test('a changed account during the sign-out confirmation is preserved',async()=>{
 const calls=[];let identity={sessionId:'owner-session',credentialId:'owner-credential'};
 const box={owner:{live:true,S:()=>({view:'settings'}),vget:()=>({page:'cloud-plan'})},accountReviews:{confirm:async()=>{identity={sessionId:'new-owner-session',credentialId:'new-owner-credential'};return true;}},connectionController:{getCloudClient:()=>identity,cloudSignOut:async()=>calls.push('sign-out')}};
 await vm.runInNewContext('('+helper.trim().replace('async function reviewSignOut','async function')+')',box)();assert.equal(calls.length,0);
});
