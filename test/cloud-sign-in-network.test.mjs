import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudSignInError, signInFailureMessage} from '../apps/app/src/runtime/cloud-sign-in.ts';

test('the renderer accepts shared transport codes and refuses unknown codes without displaying server text', () => {
 const messages=[];
 for(const code of ['offline','unavailable']) {
  const error=CloudSignInError.from({code,message:'private details'});
  assert.equal(error.code,code);
  const message=signInFailureMessage(error.code,'Eliza Cloud');
  assert.ok(code==='unavailable'?message==='Unavailable':message.includes('Eliza Cloud'));
  assert.ok(!message.includes('private details'));
  messages.push(message);
 }
 assert.equal(new Set(messages).size,2);
 for(const code of ['dns','timeout','secure-connection','private details']) {
  const error=CloudSignInError.from({code,message:'private details'});
  assert.equal(error.code,'unavailable');
  assert.equal(signInFailureMessage(error.code,'Eliza Cloud'),messages[1]);
 }
});
