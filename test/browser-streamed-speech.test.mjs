import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getEventListeners} from 'node:events';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
// The real streamed clip and MediaSource feeder against a stand-in MediaSource that keeps the Media
// Source Extensions event order: a failed append fires error, then updateend; detaching the element
// removes each SourceBuffer (abort, then updateend, while it appends) and then fires sourceclose.
// The clip body is held open by the test and records its cancellation; zero network, media or audio.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/browser/streamed-speech.ts','utf8').replace(/^export /gm,''),{mode:'transform'})+';return {StreamedSpeech,streamedSpeechSource};';
const idle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));};
function harness(){
 const medias=[],revoked=[],cancelled=[];let upstream;
 class SourceBuffer extends EventTarget{
  updating=false;removed=false;refuse=false;appended=[];
  appendBuffer(chunk){if(this.removed||this.updating)throw new DOMException('This SourceBuffer cannot append now.','InvalidStateError');if(this.refuse)throw new DOMException('The SourceBuffer is full.','QuotaExceededError');this.updating=true;this.appended.push(chunk);}
  /** Ends the pending append as the media engine does. */
  settle(failed=false){this.updating=false;if(failed)this.dispatchEvent(new Event('error'));this.dispatchEvent(new Event('updateend'));}
 }
 class MediaSource extends EventTarget{
  readyState='closed';buffers=[];constructor(){super();medias.push(this);}
  addSourceBuffer(type){assert.equal(type,'audio/mpeg');const buffer=new SourceBuffer();this.buffers.push(buffer);return buffer;}
  endOfStream(){this.readyState='ended';}
  open(){this.readyState='open';this.dispatchEvent(new Event('sourceopen'));}
  /** The element let the media go, as when its source is reset. */
  detach(){this.readyState='closed';for(const buffer of this.buffers){buffer.removed=true;if(buffer.updating){buffer.updating=false;buffer.dispatchEvent(new Event('abort'));buffer.dispatchEvent(new Event('updateend'));}}this.dispatchEvent(new Event('sourceclose'));}
 }
 const {StreamedSpeech,streamedSpeechSource}=new Function('MediaSource','URL',code)(MediaSource,{createObjectURL:()=>'blob:speech',revokeObjectURL:url=>revoked.push(url)});
 const body=new ReadableStream({start(controller){upstream=controller;},cancel(reason){cancelled.push(reason);}});
 const playback=new AbortController(),{url,fed}=streamedSpeechSource(new StreamedSpeech(body),playback.signal);
 let outcome='pending';fed.then(()=>{outcome='fed';},error=>{outcome='failed: '+error.message;});
 const media=medias[0],buffer=()=>media.buffers[0];
 /** Opens the media and appends the first chunk; the rest of the clip is still downloading. */
 const playing=async()=>{upstream.enqueue(new Uint8Array([73,68,51]));await idle();media.open();await idle();assert.equal(buffer().appended.length,1);};
 const listeners=()=>[...['sourceopen','sourceclose','error','abort'].map(type=>getEventListeners(media,type).length),...media.buffers.flatMap(value=>['updateend','error','abort'].map(type=>getEventListeners(value,type).length)),getEventListeners(playback.signal,'abort').length].reduce((sum,count)=>sum+count,0);
 return {url,upstream,playback,media,buffer,playing,listeners,revoked,cancelled,outcome:()=>outcome};
}
/** Feeding ended: the object URL is revoked and nothing still listens to the media, its buffer or Stop. */
function released(h,label){assert.deepEqual(h.revoked,[h.url],label);assert.equal(h.listeners(),0,label);}

test('a whole clip is appended and ended, then its URL and listeners are released without cancelling the download',async()=>{
 const h=harness();await h.playing();h.buffer().settle();await idle();
 h.upstream.enqueue(new Uint8Array([4,5]));await idle();assert.equal(h.buffer().appended.length,2);h.buffer().settle();h.upstream.close();await idle();
 assert.equal(h.outcome(),'fed');assert.equal(h.media.readyState,'ended');assert.deepEqual(h.cancelled,[]);released(h);
});
test('a detached element, a refused or failed append, or Stop cancels the download and releases the URL and listeners',async()=>{
 const faults={
  'detached while the rest downloads':h=>{h.buffer().settle();return idle().then(()=>h.media.detach());},
  'detached during an append':h=>h.media.detach(),
  'append refused':h=>{h.buffer().settle();h.buffer().refuse=true;h.upstream.enqueue(new Uint8Array([4,5]));},
  'append failed':h=>h.buffer().settle(true),
  'Stop':h=>h.playback.abort(new DOMException('Playback cancelled','AbortError')),
 };
 for(const [fault,cause] of Object.entries(faults)){
  const h=harness();await h.playing();await cause(h);await idle();
  assert.match(h.outcome(),/^failed: /,fault);assert.equal(h.cancelled.length,1,fault);assert.equal('failed: '+h.cancelled[0].message,h.outcome(),fault);
  assert.throws(()=>h.upstream.enqueue(new Uint8Array([6])),TypeError,fault);released(h,fault);
 }
});
