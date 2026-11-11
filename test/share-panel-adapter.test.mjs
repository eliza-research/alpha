import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
// The adapter with its two runtime imports replaced by a panel that records what it was given; the selection check is the real one.
const source=readFileSync(new URL('../apps/app/src/prototype/share-panel-adapter.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
const panel=stripTypeScriptTypes(readFileSync(new URL('../apps/app/src/runtime/share-panel.ts',import.meta.url),'utf8'),{mode:'strip'}).match(/^export function unchangedSince[\s\S]*?^}$/m)[0].replace('export ','');
const code=`const panels=[];${panel}\nexport {panels};const openSharePanel=options=>{panels.push(options);};const setShareEmailComposer=()=>{};const shareSelectedText=async()=>{};const copySelectedText=async()=>{};const selectedText=value=>value;\n${stripTypeScriptTypes(source,{mode:'strip'})}`;
const {installSharePanelAdapter,panels}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
globalThis.document??={hidden:false};

function shell(view,state,values){
 class Shell{renderVals(){return values();}componentDidMount(){}componentWillUnmount(){}}
 installSharePanelAdapter(Shell,{});
 const instance=new Shell();Object.assign(instance,{S:()=>({view,vs:state}),vget:module=>state[module],api:()=>({toast(){}})});
 return instance;
}

test('photos: refresh counters keep the panel current and a changed selection does not',()=>{
 const state={photos:{open:'native-camera-1',nativePhotoSelection:{id:'1',revision:'a'},nativeLibraryRevision:1,nativeCaptureRevision:1}};
 const instance=shell('photos',state,()=>({photos:{v:{share(){}}}}));
 instance.renderVals().photos.v.share();const panel=panels.at(-1);
 state.photos={...state.photos,nativeLibraryRevision:2,nativeCaptureRevision:2,nativeEditRevision:3};assert.equal(panel.current(),true);
 state.photos={...state.photos,nativePhotoSelection:{id:'1',revision:'b'}};assert.equal(panel.current(),false);
});

test('calendar: a revision refresh keeps the panel current and an edited event does not',()=>{
 const state={calendar:{open:'e1'}};let notes='Bring slides';
 const instance=shell('calendar',state,()=>({calendar:{ev:{title:'Review',day:'Today',notes}}}));
 instance.renderVals().calendar.ev.share();const panel=panels.at(-1);
 state.calendar={...state.calendar,nativeAgentRevision:'r1'};instance.renderVals();assert.equal(panel.current(),true);
 notes='Bring the report';state.calendar={...state.calendar,nativeAgentRevision:'r2'};instance.renderVals();assert.equal(panel.current(),false);
});
