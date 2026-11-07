import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
// The Eliza Cloud Settings page as the adapter builds it (settings-facts region, cloudAccountPage).
const text=readFileSync(process.env.SETTINGS_SOURCE||'apps/app/src/prototype/settings-adapter.ts','utf8');
const region=text.slice(text.indexOf('// settings-facts:begin'),text.indexOf('// settings-facts:end'));
assert.ok(region.includes('export function cloudAccountPage('));
const m=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region,{mode:'strip'})).toString('base64'));
for(const busy of [false,true])test(`Cloud account operations retain a usable ${busy?'Cancel':'Sign out'} action`,()=>{
 let cancellations=0,signouts=0,asked=0;
 const page=m.cloudAccountPage({plan:{signedIn:true,offline:false,account:'synthetic@example.invalid',plan:'Synthetic plan',status:null,endsAt:null,allowance:null,limit:null,keyExpiresAt:null,keyExpiring:false,inference:'Unavailable'},busy,message:'Signing out…',serviceName:'Nebula',runtimeLocation:'On this device',day:String,confirm:()=>{asked++;return true;},
  actions:{cancel:()=>{cancellations++;},signOut:()=>{signouts++;},approve(){},redeem(){},manage(){},recheck(){},signIn(){}}});
 if(busy){assert.deepEqual(page.actions.map(r=>r.label),['Cancel']);assert(page.rows.some(r=>r.label==='Status'&&r.value==='Signing out…'));page.actions[0].go();assert.equal(cancellations,1);assert.equal(signouts,0);}
 else{const signout=page.actions.find(r=>r.label==='Sign out');assert(signout);assert(!page.actions.some(r=>r.label==='Cancel'));signout.go();assert.equal(asked,1,'Sign out asks first');assert.equal(signouts,1);}
});
test('the adapter renders the page from residentPlanSettings and its real Cancel and Sign out operations',()=>{
 assert.match(text,/if \(current === 'cloud-plan' && plan\) \{\n\s+const cloudPage = cloudAccountPage\(\{ plan, busy: connection\.busy, message: connection\.message \|\| '',/);
 assert.match(text,/cancel: \(\) => connectionController\.cancel\(\)/);
 assert.match(text,/signOut: \(\) => void connectionController\.cloudSignOut\(\)/);
 assert.match(text,/subpage\(`\$\{serviceName\} account & plan`/);
});
