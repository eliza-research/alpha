import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deferred} from './fixtures/wait-for.mjs';
test('direct read-aloud uses owner-bound native playback without renderer Cloud login, and rejects changed owner',async()=>{
 const {stripTypeScriptTypes}=await import('./support/strip-types.mjs'),vm=await import('node:vm');
 const source=(await readFile(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export type','type');
 let agent={session:{ownerId:'fixture-owner',sessionId:'fixture-session'}},uploads=0,synthesis=0,legacy=0,sends=0,release,reached;
 const native={transcribeDevelopmentCloudRecording:async()=>{uploads++;if(reached){const gate=new Promise(r=>release=r);reached.resolve();await gate;}return {text:'hello',local:false};},synthesizeDevelopmentCloud:async input=>{synthesis++;if(reached){const gate=new Promise(r=>release=r);reached.resolve();await gate;}assert.deepEqual(Object.keys(input).sort(),['requestId','route','text']);assert.equal(input.route,'direct');return {playbackId:'owned'};},transcribeRecording:async()=>{legacy++;},synthesize:async()=>{legacy++;}};
 const box={developmentCartesiaVoiceEnabled:true,developmentCloudVoiceEnabled:false,registerPlugin:()=>native,connectionController:{getCloudEnvironment:()=>null,getCloudClient:()=>null,getBrowserSpeechAgent:()=>agent,getSnapshot:()=>({open:false}),subscribe:()=>()=>{},send:()=>sends++},document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},AbortController,DOMException,markTtsPlaybackStarted(){},markTtsPlaybackEnded(){},playOwnedSpeech:async(_native,signal,prepare,current,started,strict)=>{assert.equal(strict,true);signal.throwIfAborted();current();await prepare('request');current();started();}};
 vm.runInNewContext('{'+stripTypeScriptTypes(source,{mode:'strip'})+';globalThis.create=createCloudVoice;}',box);
 const driver=box.create('direct');await driver.speak('reply',new AbortController().signal);assert.equal(uploads,0);assert.equal(synthesis,1);assert.equal(legacy,0);assert.equal(sends,0);

 reached=deferred();const pending=driver.speak('reply',new AbortController().signal);await Promise.race([reached.promise,pending.then(()=>{throw Error('speech finished without reaching synthesis');})]);agent={session:{ownerId:'other',sessionId:'other'}};release();await assert.rejects(pending,/Voice agent changed/);box.developmentCartesiaVoiceEnabled=false;assert.throws(()=>box.create('direct'),/disabled/);assert.equal(legacy,0);
});
