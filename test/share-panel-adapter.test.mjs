import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
// The adapter with its two runtime imports replaced by a panel that records what it was given.
const source=readFileSync(new URL('../apps/app/src/prototype/share-panel-adapter.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
const code=`const panels=[];export {panels};const openSharePanel=options=>{panels.push(options);return Promise.resolve();};const shareSelectedText=async()=>{};const copySelectedText=async()=>{};const selectedText=value=>value;\n${stripTypeScriptTypes(source,{mode:'strip'})}`;
const {installSharePanelAdapter,panels}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
globalThis.document??={hidden:false};

function shell(view,state,values){
 class Shell{renderVals(){return values();}componentDidMount(){}componentWillUnmount(){}}
 installSharePanelAdapter(Shell,{});
 const instance=new Shell();Object.assign(instance,{S:()=>({view}),vget:module=>state[module],api:()=>({toast(){}})});
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

test('browser policy refusal hides sharing while native device sharing stays available',()=>{
 const textSource=readFileSync(new URL('../apps/app/src/runtime/text-share.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
 const code=stripTypeScriptTypes(textSource,{mode:'strip'}).replace(/^export /gm,'');
 const read=new Function('Capacitor','registerPlugin','navigator','document',code+';return platformSharingAvailable();');
 const platform=native=>({isNativePlatform:()=>native});
 const navigator={share(){}};
 assert.equal(read(platform(false),()=>({}),navigator,{permissionsPolicy:{allowsFeature:()=>false}}),false);
 assert.equal(read(platform(false),()=>({}),navigator,{permissionsPolicy:{allowsFeature:()=>true}}),true);
 assert.equal(read(platform(true),()=>({}),navigator,{permissionsPolicy:{allowsFeature:()=>false}}),true);
});
