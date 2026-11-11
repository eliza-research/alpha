import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
import vm from 'node:vm';

// msg-alphaphone-029: a Cloud protocol refusal used to reach the owner as "Cloud http (403)" or
// "Cloud invalid-response". errorMessage now says what happened and what to do; the code and status
// go to the diagnostic log only. Runs the shipped errorMessage.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(start,end)=>{const from=ui.indexOf(start),to=ui.indexOf(end,from);assert.ok(from>=0&&to>from,start);return ui.slice(from,to);};
const code=stripTypeScriptTypes(between('/** A code that expired on the code step','/** A resident start that does not open the dialog'),{mode:'strip'});
// The shipped class's shape (cloud-protocol.ts uses parameter properties, which node cannot strip).
class CloudProtocolError extends Error{constructor(code,status){super(`Cloud ${code}${status?` (${status})`:''}`);this.code=code;this.status=status;}}

function harness(){
  const logged=[];
  const box={CloudProtocolError,CloudSignInError:class extends Error{},EntitlementError:class extends Error{},DOMException,testMocksEnabled:false,cloud:{environment:'production'},
    cloudServiceName:()=>'Eliza Cloud',residentRecoveryReason:()=>null,residentSignInExpired:()=>'Your Eliza Cloud sign-in has expired. Sign in again.',
    reportCloudProtocolError:error=>logged.push([error.code,error.status])};
  vm.createContext(box);vm.runInContext(code,box);
  return {errorMessage:box.errorMessage,logged};
}

test('a Cloud server failure or rate limit says the service is unavailable',()=>{
  const {errorMessage,logged}=harness();
  for(const status of [500,502,408,429])assert.equal(errorMessage(new CloudProtocolError('http',status)),'Unavailable');
  assert.deepEqual(logged,[['http',500],['http',502],['http',408],['http',429]],'code and status are logged, not shown');
});

test('an unreadable response or another refusal says the account could not be checked',()=>{
  const {errorMessage}=harness();
  for(const error of [new CloudProtocolError('invalid-response'),new CloudProtocolError('http',403),new CloudProtocolError('http',404)])
    assert.equal(errorMessage(error),'Couldn’t check');
});

test('a changed account asks for a new sign-in',()=>{
  assert.equal(harness().errorMessage(new CloudProtocolError('account-changed')),'Account changed');
});

test('401 keeps its sign-in copy first, so the saved-sign-in comparison still holds',()=>{
  const {errorMessage}=harness();
  assert.equal(errorMessage(new CloudProtocolError('http',401)),errorMessage({status:401}));
  assert.equal(errorMessage({status:401}),'Your Eliza Cloud sign-in has expired. Sign in again.');
  assert.equal(errorMessage(new CloudProtocolError('http',503)),'Agent starting');
});
