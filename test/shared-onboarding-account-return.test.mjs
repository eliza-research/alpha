import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const text=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const source=stripTypeScriptTypes(text.slice(text.indexOf('function update(patch:'),text.indexOf('// P-43:')),{mode:'strip'});
for(const [name,before,patch,expected] of [
 ['completed account sign-in closes the account panel',{purpose:'cloud-account',open:true,cloudAccount:null},{cloudAccount:{credentialId:'new'}},false],
 ['refresh of an existing account keeps explicitly opened Settings panel',{purpose:'cloud-account',open:true,cloudAccount:{credentialId:'same'}},{cloudAccount:{credentialId:'same'}},true],
 ['failed sign-in keeps its recovery panel',{purpose:'cloud-account',open:true,cloudAccount:null},{error:'Sign-in failed'},true],
])test(name,()=>{const context={state:before,isAndroid:false,testMocksEnabled:false,developmentPageSuspended:false,sending:null,flushConversationEvents:()=>{},listeners:new Set()};vm.runInNewContext(source+';update('+JSON.stringify(patch)+');globalThis.result=state;',context);assert.equal(context.result.open,expected);if(!expected)assert.equal(context.result.purpose,'agent');});
