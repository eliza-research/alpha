import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudSignInError, signInFailureMessage} from '../apps/app/src/runtime/cloud-sign-in.ts';

test('transport failures survive the native bridge and have distinct recovery instructions', () => {
 const messages=[];
 for(const code of ['dns','offline','timeout','secure-connection']) {
  const error=CloudSignInError.from({code,message:'private details'});
  assert.equal(error.code,code);
  const message=signInFailureMessage(error.code,'Eliza Cloud');
  assert.ok(message.includes('Eliza Cloud'));
  assert.ok(!message.includes('private details'));
  messages.push(message);
 }
 assert.equal(new Set(messages).size,4);
 assert.match(messages[0],/Could not find/);
 assert.match(messages[1],/could not reach/);
 assert.match(messages[2],/too long/);
 // No retry is scheduled for a secure-connection failure, so the copy promises none.
 assert.match(messages[3],/date and time, then try again\.$/);assert.doesNotMatch(messages[3],/will try again/);
 // Verify keeps the code step on a transport failure, so the owner re-enters the code there.
 for(const message of messages.slice(0,3))assert.match(message,/enter the code again\.$/i);

});

test('sign-in copy is short and never narrates what the owner just did', () => {
 for(const code of ['cancelled','browser-closed'])assert.equal(signInFailureMessage(code,'Eliza Cloud'),'');
 assert.match(signInFailureMessage('invalid-code','Eliza Cloud'),/check it, or resend/i);
 for(const code of ['account-check','state-mismatch','rejected','invalid-request','storage','browser-unavailable','provider-refused','mfa-browser','mfa-unsupported'])
  assert.doesNotMatch(signInFailureMessage(code,'Eliza Cloud'),/Eliza Cloud|Cloud support|in Alpha/,code);
});
