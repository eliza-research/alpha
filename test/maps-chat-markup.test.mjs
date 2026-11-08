import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// The producing side is the pinned plugin's own serializer, so the wire contract cannot drift silently.
const load=async(entry,plugins=[])=>{const out=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false,plugins});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));};
const {appendMapsCard,routeCard}=await load('vendor/eliza/plugins/plugin-maps/src/card.ts');
const {appendInteractionBlock}=await load('vendor/eliza/packages/core/src/messaging/interaction-serialize.ts');
const {mapsChatText}=await load('apps/app/src/runtime/action-message-presentation.ts');
const place={name:'Ferry Building',latitude:37.7955,longitude:-122.3937,provider:'eliza-cloud',providerPlaceId:'osm:n1',formattedAddress:'1 Ferry Building, San Francisco',categories:[]};
const ref={name:place.name,coordinates:{latitude:place.latitude,longitude:place.longitude},provider:place.provider,providerPlaceId:place.providerPlaceId,formattedAddress:place.formattedAddress,categories:[]};
const attribution='© OpenStreetMap contributors';

test('place, search and route cards become readable cards with their attribution',()=>{
 const placeText=appendMapsCard('Found it.',{kind:'place',place,attribution});
 assert.deepEqual(mapsChatText(placeText),{displayText:'Found it.',cards:[{kind:'place',title:'Ferry Building',lines:['1 Ferry Building, San Francisco'],attribution}],choice:null});
 const search=mapsChatText(appendMapsCard('Two matches.',{kind:'places',query:'ferry',places:[place,{...place,name:'Pier 1',formattedAddress:undefined,providerPlaceId:'osm:n2'}],nextCursor:null,attribution}));
 assert.deepEqual(search.cards[0].lines,['Ferry Building, 1 Ferry Building, San Francisco','Pier 1']);assert.equal(search.cards[0].attribution,attribution);
 const route=mapsChatText(appendMapsCard('Here is the route.',routeCard({origin:{...ref,name:'Home'},destination:ref,travelMode:'walk',distanceMeters:1530,durationSeconds:1260,warnings:['Steep section']},attribution)));
 assert.deepEqual(route.cards[0],{kind:'route',title:'Route to Ferry Building',lines:['From Home','Walking · 1.5 km · 21 min','Steep section'],attribution});
 assert.equal(route.displayText,'Here is the route.');
});

test('a locate card says the phone does not send location; a handoff link is text only',()=>{
 const locate=mapsChatText(appendMapsCard('Where are you starting from?',{kind:'locate',intent:'route-origin',prompt:'Where are you starting from?'}));
 assert.equal(locate.cards[0].title,'Location needed');assert.match(locate.cards[0].lines[0],/does not send your location/);
 const handoff=mapsChatText(appendMapsCard('Shared.',{kind:'handoff',handoffKind:'share',place,geoUri:'geo:37.7955,-122.3937',appleMapsUri:'https://maps.apple.com/?ll=37.7955,-122.3937',webUri:'https://www.openstreetmap.org/?mlat=37.7955&mlon=-122.3937'}));
 assert.deepEqual(handoff.cards[0].lines,['1 Ferry Building, San Francisco','https://www.openstreetmap.org/?mlat=37.7955&mlon=-122.3937']);
});

test('the share confirmation keeps its question as prose and offers its two exact answers',()=>{
 const prompt='Share the location of Ferry Building?';
 const text=appendInteractionBlock(prompt,{kind:'choice',id:'maps-share-m1',scope:'maps-share',prompt,options:[{value:'Yes, share the location of Ferry Building (confirmed).',label:'Share location'},{value:'No, do not share my location.',label:"Don't share"}]});
 assert.deepEqual(mapsChatText(text),{displayText:prompt,cards:[],choice:{id:'maps-share-m1',options:[{value:'Yes, share the location of Ferry Building (confirmed).',label:'Share location'},{value:'No, do not share my location.',label:"Don't share"}]}});
});

test('ordinary, malformed, out-of-policy and foreign markup stays literal',()=>{
 const ordinary='  An indented reply.\n\n\tSecond paragraph.  \n';
 assert.deepEqual(mapsChatText(ordinary),{displayText:ordinary,cards:[],choice:null});
 const literal=[
  '[MAPSCARD]\n{not json}\n[/MAPSCARD]',
  '[MAPSCARD]\n'+JSON.stringify({kind:'place',place:{...place,latitude:200},attribution})+'\n[/MAPSCARD]',
  '[MAPSCARD]\n'+JSON.stringify({kind:'handoff',handoffKind:'share',place,geoUri:'geo:1,2',appleMapsUri:'https://maps.apple.com/',webUri:'https://evil.example/'})+'\n[/MAPSCARD]',
  '[CHOICE:maps-share id=maps-share-x]\nonly-one=Option\n[/CHOICE]',
  '[CHOICE:maps-share id=maps-share-x]\nno separator\nb=B\n[/CHOICE]',
  '[CHOICE:other-scope id=maps-share-x]\na=A\nb=B\n[/CHOICE]',
 ];
 for(const text of literal)assert.deepEqual(mapsChatText(text),{displayText:text,cards:[],choice:null},text);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const adapterSource=fs.readFileSync('apps/app/src/prototype/maps-adapter.ts','utf8');
const adapterBody=adapterSource.slice(adapterSource.indexOf('/** Presentation only:')).replace('export function','function');
const adapterScope={mapsChatText,document:{get hidden(){return globalThis.mapsChatFixture?.hidden??false;}},connectionController:{getSnapshot:()=>globalThis.mapsChatFixture.snapshot,getSelectedConversationId:()=>globalThis.mapsChatFixture.conversation}};
vm.runInNewContext(stripTypeScriptTypes('type Bag=Record<string,any>;\n'+adapterBody+'\nglobalThis.installMapsChatAdapter=installMapsChatAdapter;', {mode:'transform'}),adapterScope);
const {installMapsChatAdapter}=adapterScope;
const shareText=appendInteractionBlock('Share the location of Ferry Building?',{kind:'choice',id:'maps-share-m1',scope:'maps-share',prompt:'',options:[{value:'Yes, share the location of Ferry Building (confirmed).',label:'Share location'},{value:'No, do not share my location.',label:"Don't share"}]});
function fixture(msgs){const f={snapshot:{open:false,busy:false,session:{ownerId:'owner',agentId:'agent'}},conversation:'chat',sent:[],toasts:[]};globalThis.mapsChatFixture=f;
 class Shell{live=true;st={msgs,draft:'',typing:false};S(){return this.st;}renderVals(){return {msgs:this.st.msgs.map(m=>({...m,isAgent:m.from==='agent',isUser:m.from==='user',displayText:m.text,hasCalendarText:true,messageActionsLabel:'Message actions: '+m.text}))};}setState(p){Object.assign(this.st,p);}toast(t){f.toasts.push(t);}async send(t){f.sent.push(t);}}
 installMapsChatAdapter(Shell);return {f,shell:new Shell()};}

test('rendering sends nothing; one tap sends the exact answer once and stored text is unchanged',async()=>{
 const card=appendMapsCard('Found it.',{kind:'place',place,attribution});
 const {f,shell}=fixture([{id:'u0',from:'user',text:card},{id:'a1',from:'agent',text:card},{id:'a2',from:'agent',text:shareText}]);
 try{
  for(let n=0;n<20;n++)shell.renderVals();assert.equal(f.sent.length,0);
  let view=shell.renderVals();
  assert.equal(view.msgs[0].displayText,card,'literal user text stays literal');assert.equal(view.msgs[0].mapsCards,undefined);
  assert.equal(view.msgs[1].displayText,'Found it.');assert.equal(view.msgs[1].mapsCards[0].hasAttribution,true);assert.equal(shell.st.msgs[1].text,card);
  assert.equal(view.msgs[2].hasMapsChoice,true);assert.deepEqual(view.msgs[2].mapsChoices.map(c=>c.label),['Share location',"Don't share"]);
  view.msgs[2].mapsChoices[0].choose();view.msgs[2].mapsChoices[0].choose();await tick();
  assert.deepEqual(f.sent,['Yes, share the location of Ferry Building (confirmed).']);
  assert.equal(shell.renderVals().msgs[2].hasMapsChoice,false,'an answered question offers no second answer');
 }finally{delete globalThis.mapsChatFixture;}
});

test('an older question, a draft or a busy connection never sends an answer',async()=>{
 const older=fixture([{id:'a1',from:'agent',text:shareText},{id:'u2',from:'user',text:'Never mind'}]);
 try{assert.equal(older.shell.renderVals().msgs[0].hasMapsChoice,false);}finally{delete globalThis.mapsChatFixture;}
 const draft=fixture([{id:'a1',from:'agent',text:shareText}]);
 try{draft.shell.st.draft='Keep my words';draft.shell.renderVals().msgs[0].mapsChoices[0].choose();await tick();assert.equal(draft.f.sent.length,0);assert.equal(draft.f.toasts.length,1);assert.equal(draft.shell.st.draft,'Keep my words');}finally{delete globalThis.mapsChatFixture;}
 const busy=fixture([{id:'a1',from:'agent',text:shareText}]);
 try{busy.f.snapshot.busy=true;busy.shell.renderVals().msgs[0].mapsChoices[1].choose();await tick();assert.equal(busy.f.sent.length,0);}finally{delete globalThis.mapsChatFixture;}
});

test('a form-only reply shows its prose and offers nothing to send',()=>{
 const prompt='What place or address should I look up?';
 const {f,shell}=fixture([{id:'a1',from:'agent',text:appendInteractionBlock(prompt,{kind:'form',id:'maps-search-m1',fields:[{name:'query',type:'text',label:'Place or address',required:true}]})}]);
 try{const view=shell.renderVals().msgs[0];assert.equal(view.displayText,prompt);assert.deepEqual(view.mapsCards,[]);assert.equal(view.hasMapsChoice,false);assert.equal(f.sent.length,0);}finally{delete globalThis.mapsChatFixture;}
});

test('a retained Maps choice cannot send after account, conversation, newest-message or recording changes',async()=>{
 for(const change of ['account','conversation','message','edited','recording','hidden']){
  const {f,shell}=fixture([{id:'a1',from:'agent',text:shareText}]);
  try{
   const choose=shell.renderVals().msgs[0].mapsChoices[0].choose;
   if(change==='account')f.snapshot.session={ownerId:'other',agentId:'agent'};
   if(change==='conversation')f.conversation='other';
   if(change==='message')shell.st.msgs.push({id:'a2',from:'agent',text:'Never mind'});
   if(change==='edited')shell.st.msgs[0].text='A replaced answer';
   if(change==='recording')shell.st.recording=true;
   if(change==='hidden')f.hidden=true;
   choose();await tick();assert.deepEqual(f.sent,[],change);
  }finally{delete globalThis.mapsChatFixture;}
 }
});
