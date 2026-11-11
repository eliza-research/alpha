// The scan page capture dialog driven through its real entry point in jsdom. The camera stream,
// video element and canvas are controlled stand-ins: this proves the dialog's decisions, not a camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const tick=async(n=10)=>{for(let i=0;i<n;i++)await new Promise(done=>setTimeout(done,0));};

test('page capture: a stopped camera cannot be used to discard the reviewed capture',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><main class="os"></main></body></html>',{url:'https://scan.example.test/'});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const ended=[],track={readyState:'live',stop(){},addEventListener(_name,listener){ended.push(listener);}};
 const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
 const video=dom.window.HTMLVideoElement.prototype;video.play=async()=>{};video.pause=()=>{};
 Object.defineProperty(video,'readyState',{get:()=>4});Object.defineProperty(video,'videoWidth',{get:()=>640});Object.defineProperty(video,'videoHeight',{get:()=>480});Object.defineProperty(video,'srcObject',{set(){},get(){return null;}});
 const canvas=dom.window.HTMLCanvasElement.prototype;canvas.getContext=()=>({drawImage(){}});canvas.toBlob=done=>done(new Blob(['frame'],{type:'image/jpeg'}));
 const revoked=[];
 const context=vm.createContext({document:dom.window.document,window:dom.window,HTMLElement:dom.window.HTMLElement,console,setTimeout,clearTimeout,Blob,navigator:{mediaDevices:{getUserMedia:async()=>stream}},URL:{createObjectURL:()=>'blob:capture',revokeObjectURL:url=>revoked.push(url)}});
 const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/scan-page-camera.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'));
 vm.runInContext(code+';globalThis.captureScanPage=captureScanPage;',context);
 const result=context.captureScanPage(new AbortController().signal);await tick();
 const button=name=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===name);
 button('Capture page').click();await tick();
 assert.equal(button('Use captured page').disabled,false);assert.equal(button('Retake capture').hidden,false);
 track.readyState='ended';for(const listener of ended)listener();
 assert.equal(button('Retake capture').disabled,true,'Retake is unavailable once the camera stopped');
 button('Retake capture').disabled=false;button('Retake capture').click();
 assert.deepEqual(revoked,[],'the only capture is not discarded without a live camera');assert.equal(button('Use captured page').disabled,false);
 button('Use captured page').click();
 assert.equal((await result).size,5,'the reviewed capture is still the result');
 dom.window.close();
});
