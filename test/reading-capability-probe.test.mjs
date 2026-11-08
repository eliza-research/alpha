import assert from 'node:assert/strict';
import test from 'node:test';
// The shared page-reading module from the prepared client features. These probes touch no DOM;
// the web build's menu cases stay in test/browser/reading-capability.spec.ts.
import {createReadingSupport,READING_UNSUPPORTED_MESSAGE} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';

const probe=async answers=>{
 let asked=0,changed=0;const states=[];
 const support=createReadingSupport(async()=>{const answer=answers[Math.min(asked++,answers.length-1)];if(answer==='throw')throw new Error('bridge closed');return answer;},()=>{changed++;});
 states.push(support.state);
 const together=await Promise.all([support.check(),support.check()]);states.push(support.state);
 const again=await support.check();states.push(support.state);
 return {asked,changed,states,together,again};
};
test('an explicit native "no" is remembered as unavailable and asked for once',async()=>{
 assert.deepEqual(await probe([{available:false}]),{asked:1,changed:1,states:['unknown','unavailable','unavailable'],together:['unavailable','unavailable'],again:'unavailable'});
});
test('an explicit native "yes" is remembered as available',async()=>{
 assert.deepEqual(await probe([{available:true}]),{asked:1,changed:1,states:['unknown','available','available'],together:['available','available'],again:'available'});
});
test('a failed or malformed answer is never read as unavailable or available, and is asked again',async()=>{
 // Unknown lets the review start; the native side then refuses on its own if it must.
 assert.deepEqual(await probe(['throw',{available:false}]),{asked:2,changed:1,states:['unknown','unknown','unavailable'],together:['unknown','unknown'],again:'unavailable'});
 for(const malformed of [null,{},{available:'false'},{available:0},'no'])
  assert.deepEqual((await probe([malformed,malformed])).states,['unknown','unknown','unknown'],JSON.stringify(malformed));
});
test('the message names both actions, the cause and the remedy, and promises nothing else',()=>{
 assert.equal(READING_UNSUPPORTED_MESSAGE,'Read aloud and Ask about page are unavailable on this device: its Android System WebView cannot read a page privately. Update Android System WebView.');
});
