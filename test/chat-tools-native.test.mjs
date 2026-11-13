import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {conversationReadPathAllowed} from '../apps/app/src/runtime/conversation-read-path.ts';
import {localAgentPathAllowed} from '../scripts/local-agent-dev-bridge.ts';

const conversation='11111111-1111-4111-8111-111111111111';
const message='22222222-2222-4222-8222-222222222222';
const allowed=[`/api/conversations/messages/search?q=launch+%26+calendar&limit=50&offset=0`,`/api/conversations/${conversation}/messages?around=${message}`];
const refused=[...allowed.map(path=>path+'&token=secret'),'/api/conversations/messages/search?q=a&limit=50&offset=-1','/api/conversations/messages/search?q=%ZZ&limit=50&offset=0',`/api/conversations/${conversation}/messages?around=../status`];
test('browser chat reads admit exact encoded search and centered history only',()=>{
 for(const path of allowed){assert.equal(conversationReadPathAllowed(path),true);assert.equal(localAgentPathAllowed(path),true);}
 for(const path of refused)assert.equal(conversationReadPathAllowed(path),false);
});
test('Android uses the same read-only routes and the server chat payload budget',()=>{
 const source=readFileSync(new URL('../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',import.meta.url),'utf8');
 const start=source.indexOf(' static boolean conversationReadPathAllowed('),end=source.indexOf(' private static void logRequestFailure(',start);
 assert(start>0&&end>start);
 const directory=mkdtempSync(join(tmpdir(),'alpha-chat-route-check-'));
 try{
  const java=join(directory,'ChatRouteTest.java');
  const cases=[...allowed.map(path=>`check(conversationReadPathAllowed("${path}","GET"));check(!conversationReadPathAllowed("${path}","POST"));`),...refused.map(path=>`check(!conversationReadPathAllowed("${path}","GET"));`)].join('\n');
  writeFileSync(java,'class ChatRouteTest {\n'+source.slice(start,end)+'\nstatic void check(boolean value){if(!value)throw new AssertionError();}\npublic static void main(String[] args){'+cases+`check(requestBodyLimit("/api/conversations/${conversation}/messages","POST")==20*1024*1024);check(requestBodyLimit("/api/status","POST")==2*1024*1024);`+'}\n}');
  execFileSync('/usr/bin/javac',[java],{stdio:'pipe'});execFileSync('/usr/bin/java',['-cp',directory,'ChatRouteTest'],{stdio:'pipe'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
