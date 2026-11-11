import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
// Run the callbacks from the current Account sheet. Cancellation stays inside
// the sheet; confirmation compares the entire account binding before sign-out.
const confirm=source.match(/onClick=\{(\(\)=>\{const expected=signOutAccount;[^\n]*?connectionController\.cloudSignOut\(\);\})\}>Sign out/)[1];
const cancel=source.match(/onClick=\{(\(\)=>\{if\(signOutAccount\)setSignOutAccount\(null\);else dismiss\(\);\})\}/)[1];
const identity=()=>({environment:'production',userId:'owner',organizationId:'org',sessionId:'owner-session',credentialId:'owner-credential'});
for(const accepted of [false,true])test(`Settings sign-out ${accepted?'confirms once':'cancels without changing the account'}`,async()=>{
 const calls=[],account=identity();let pending=account;
 const box={get signOutAccount(){return pending;},setSignOutAccount:value=>{pending=value;},dismiss:()=>calls.push('dismiss'),connectionController:{getSnapshot:()=>({cloudAccount:account}),cloudSignOut:async()=>calls.push('sign-out')}};
 await vm.runInNewContext('('+ (accepted?confirm:cancel) +')',box)();
 assert.equal(pending,null);assert.deepEqual(calls,accepted?['sign-out']:[]);
});
test('a changed account during the sign-out confirmation is preserved',async()=>{
 for(const field of ['environment','userId','organizationId','credentialId','sessionId']){
  const calls=[],account=identity();const current={...account,[field]:'changed'};
  const box={signOutAccount:account,setSignOutAccount:()=>{},connectionController:{getSnapshot:()=>({cloudAccount:current}),cloudSignOut:async()=>calls.push('sign-out')}};
  await vm.runInNewContext('('+confirm+')',box)();assert.deepEqual(calls,[],field);
 }
});
