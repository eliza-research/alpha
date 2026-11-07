import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
// The Eliza Cloud page is a pure function in the settings-facts region of the adapter.
const text=readFileSync(process.env.SETTINGS_SOURCE||'apps/app/src/prototype/settings-adapter.ts','utf8');
const region=text.slice(text.indexOf('// settings-facts:begin'),text.indexOf('// settings-facts:end'));
const m=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region,{mode:'strip'})).toString('base64'));
const plan={signedIn:true,offline:false,offerRedeem:false,account:'synthetic@example.invalid',plan:'Synthetic plan',status:'active',endsAt:Date.UTC(2026,11,6),keyExpiresAt:null,keyExpiring:false};
const page=(overrides={},confirm=()=>true)=>{const calls=[];const actions=Object.fromEntries(['cancel','approve','redeem','manage','signOut','recheck','signIn'].map(name=>[name,()=>calls.push(name)]));return {calls,out:m.cloudAccountPage({plan:{...plan,...overrides.plan},busy:!!overrides.busy,message:overrides.message||'',serviceName:'Nebula',day:at=>'day '+at,confirm,actions})};};
test('a busy account operation offers only Cancel and says what is happening',()=>{
 const {calls,out}=page({busy:true,message:'Signing out…'});
 assert.deepEqual(out.actions.map(a=>a.label),['Cancel']);assert.equal(out.status,'Signing out…');
 out.actions[0].go();assert.deepEqual(calls,['cancel']);
});
test('Sign out asks first and does nothing when declined',()=>{
 let asked='';const declined=page({},text=>{asked=text;return false;});
 const signOut=declined.out.actions.find(a=>a.label==='Sign out');assert.ok(signOut?.danger);
 signOut.go();assert.match(asked,/Sign out of Nebula\?/);assert.deepEqual(declined.calls,[]);
 const accepted=page();accepted.out.actions.find(a=>a.label==='Sign out').go();assert.deepEqual(accepted.calls,['signOut']);
 assert.ok(!accepted.out.actions.some(a=>a.label==='Cancel'));
});
test('the status line is the plan and its renewal; expiring sign-in and redeem appear only when they apply',()=>{
 assert.equal(page().out.status,'Synthetic plan · Access until day '+plan.endsAt);
 assert.equal(page().out.detail,'synthetic@example.invalid');
 assert.deepEqual(page().out.actions.map(a=>a.label),['Manage plan','Sign out']);
 const expiring=page({plan:{keyExpiring:true,offerRedeem:true}});
 assert.equal(expiring.out.status,'Sign-in expiring');
 assert.deepEqual(expiring.out.actions.map(a=>a.label),['Sign in again','Redeem code','Manage plan','Sign out']);
});
test('signed out and offline states each offer their one way forward',()=>{
 assert.deepEqual(page({plan:{signedIn:false,account:null}}).out.actions.map(a=>a.label),['Sign in with Nebula']);
 const offline=page({plan:{signedIn:false,offline:true,account:null}});
 assert.deepEqual(offline.out.actions.map(a=>a.label),['Check again']);assert.equal(offline.out.detail,'Nebula unreachable');
});
