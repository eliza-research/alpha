import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// The producing side is the pinned plugin's own serializer, so the wire contract cannot drift silently.
const load=async(entry,plugins=[])=>{const out=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false,plugins});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));};
const {appendMapsCard,routeCard}=await load('vendor/eliza/plugins/plugin-maps/src/card.ts');
const {appendInteractionBlock}=await load('vendor/eliza/packages/core/src/messaging/interaction-serialize.ts');
const {mapsChatText}=await load('apps/app/src/runtime/maps-chat-markup.ts');
const place={name:'Ferry Building',latitude:37.7955,longitude:-122.3937,provider:'eliza-cloud',providerPlaceId:'osm:n1',formattedAddress:'1 Ferry Building, San Francisco',categories:[]};
const ref={name:place.name,coordinates:{latitude:place.latitude,longitude:place.longitude},provider:place.provider,providerPlaceId:place.providerPlaceId,formattedAddress:place.formattedAddress,categories:[]};
const attribution='© OpenStreetMap contributors';

test('place, search and route cards become readable cards with their attribution',()=>{
 const placeText=appendMapsCard('Found it.',{kind:'place',place,attribution});
 assert.deepEqual(mapsChatText(placeText),{displayText:'Found it.',cards:[{kind:'place',title:'Ferry Building',lines:['1 Ferry Building, San Francisco'],attribution}],specs:[{kind:'place',place,attribution}],choice:null});
 const search=mapsChatText(appendMapsCard('Two matches.',{kind:'places',query:'ferry',places:[place,{...place,name:'Pier 1',formattedAddress:undefined,providerPlaceId:'osm:n2'}],nextCursor:null,attribution}));
 assert.deepEqual(search.cards[0].lines,['Ferry Building, 1 Ferry Building, San Francisco','Pier 1']);assert.equal(search.cards[0].attribution,attribution);
 // The validated cards themselves travel alongside, in the same order, for opening a result in Maps.
 assert.equal(search.specs.length,1);assert.equal(search.specs[0].kind,'places');assert.equal(search.specs[0].query,'ferry');assert.deepEqual(search.specs[0].places.map(item=>item.providerPlaceId),['osm:n1','osm:n2']);
 const route=mapsChatText(appendMapsCard('Here is the route.',routeCard({origin:{...ref,name:'Home'},destination:ref,travelMode:'walk',distanceMeters:1530,durationSeconds:1260,warnings:['Steep section']},attribution)));
 assert.deepEqual(route.cards[0],{kind:'route',title:'Route to Ferry Building',lines:['From Home','Walking · 1.5 km · 21 min','Steep section'],attribution});
 assert.equal(route.displayText,'Here is the route.');
 assert.equal(route.specs[0].kind,'route');assert.equal(route.specs[0].destination.providerPlaceId,'osm:n1');assert.equal(route.specs[0].travelMode,'walk');
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
 assert.deepEqual(mapsChatText(text),{displayText:prompt,cards:[],specs:[],choice:{id:'maps-share-m1',options:[{value:'Yes, share the location of Ferry Building (confirmed).',label:'Share location'},{value:'No, do not share my location.',label:"Don't share"}]}});
});

test('ordinary, malformed, out-of-policy and foreign markup stays literal',()=>{
 const ordinary='  An indented reply.\n\n\tSecond paragraph.  \n';
 assert.deepEqual(mapsChatText(ordinary),{displayText:ordinary,cards:[],specs:[],choice:null});
 const literal=[
  '[MAPSCARD]\n{not json}\n[/MAPSCARD]',
  '[MAPSCARD]\n'+JSON.stringify({kind:'place',place:{...place,latitude:200},attribution})+'\n[/MAPSCARD]',
  '[MAPSCARD]\n'+JSON.stringify({kind:'handoff',handoffKind:'share',place,geoUri:'geo:1,2',appleMapsUri:'https://maps.apple.com/',webUri:'https://evil.example/'})+'\n[/MAPSCARD]',
  '[CHOICE:maps-share id=maps-share-x]\nonly-one=Option\n[/CHOICE]',
  '[CHOICE:maps-share id=maps-share-x]\nno separator\nb=B\n[/CHOICE]',
  '[CHOICE:other-scope id=maps-share-x]\na=A\nb=B\n[/CHOICE]',
 ];
 for(const text of literal)assert.deepEqual(mapsChatText(text),{displayText:text,cards:[],specs:[],choice:null},text);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
// The connection and the phone's Maps binding are fixtures; the binding records what it was asked to open.
const ports={'connection-ui':'export const connectionController={getSnapshot:()=>globalThis.mapsChatFixture.snapshot};',
 'agent-navigation':'export const mapsAgentResultsPort={get current(){return globalThis.mapsChatFixture?.maps??null;}};'};
const {installMapsChatAdapter}=await load('apps/app/src/prototype/maps-chat-adapter.ts',[{name:'ports',setup(b){b.onResolve({filter:/\/(connection-ui|agent-navigation)$/},args=>({path:args.path.split('/').at(-1),namespace:'port'}));b.onLoad({filter:/.*/,namespace:'port'},args=>({loader:'js',contents:ports[args.path]}));}}]);
const shareText=appendInteractionBlock('Share the location of Ferry Building?',{kind:'choice',id:'maps-share-m1',scope:'maps-share',prompt:'',options:[{value:'Yes, share the location of Ferry Building (confirmed).',label:'Share location'},{value:'No, do not share my location.',label:"Don't share"}]});
function fixture(msgs){const f={snapshot:{open:false,busy:false},sent:[],toasts:[],opened:[],options:[],views:[],maps:{open:async(target,options)=>{f.opened.push(target);f.options.push(options);return null;}}};globalThis.mapsChatFixture=f;
 class Shell{live=true;st={msgs,draft:'',typing:false};S(){return this.st;}openView(view,patch){f.views.push([view,patch]);}renderVals(){return {msgs:this.st.msgs.map(m=>({...m,isAgent:m.from==='agent',isUser:m.from==='user',displayText:m.text,hasCalendarText:true,messageActionsLabel:'Message actions: '+m.text}))};}setState(p){Object.assign(this.st,p);}toast(t){f.toasts.push(t);}async send(t){f.sent.push(t);}}
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

test('restored history never opens Maps; a new reply opens its newest result once and sends nothing',async()=>{
 const search=appendMapsCard('Three coffee places.',{kind:'places',query:'coffee',places:[place],nextCursor:null,attribution});
 const route=appendMapsCard('Home is 7 minutes away.',routeCard({origin:{...ref,name:'Here'},destination:ref,travelMode:'drive',distanceMeters:3000,durationSeconds:420,warnings:[]},attribution));
 const {f,shell}=fixture([{id:'a1',from:'agent',text:search}]);
 try{
  for(let n=0;n<5;n++)shell.renderVals();await tick();
  assert.equal(f.opened.length,0,'history shown at first render is not replayed');
  // History replacing the list (another conversation restored) is not new either.
  shell.st.msgs=[{id:'h1',from:'user',text:'Coffee?'},{id:'h2',from:'agent',text:search}];shell.renderVals();await tick();
  assert.equal(f.opened.length,0);
  // The user asks; the reply streams in and its card completes at the end.
  shell.st.msgs=[...shell.st.msgs,{id:'u3',from:'user',text:'Take me home'}];shell.renderVals();
  shell.st.msgs=[...shell.st.msgs,{id:'a4',from:'agent',text:'Home is'}];shell.renderVals();await tick();
  assert.equal(f.opened.length,0,'nothing opens before the card is complete');
  shell.st.msgs=[...shell.st.msgs.slice(0,-1),{id:'a4',from:'agent',text:route}];
  for(let n=0;n<5;n++)shell.renderVals();await tick();
  assert.equal(f.opened.length,1,'opened once');
  assert.equal(f.opened[0].kind,'route');assert.equal(f.opened[0].destination.providerPlaceId,'osm:n1');assert.equal(f.opened[0].travelMode,'drive');
  assert.deepEqual(f.options,[{allowDirectStart:true}],'a reply that just arrived is the agent acting, so its own direct-start setting applies');
  assert.deepEqual(f.views,[],'an automatic open that changed nothing stays quiet');
  assert.equal(f.sent.length,0,'nothing is sent to the agent');assert.equal(shell.st.msgs.at(-1).text,route,'stored text is unchanged');
  // A later message makes it history; it does not open again.
  shell.st.msgs=[...shell.st.msgs,{id:'u5',from:'user',text:'Thanks'}];shell.renderVals();await tick();
  assert.equal(f.opened.length,1);
 }finally{delete globalThis.mapsChatFixture;}
});

test('Show in Maps opens that card on a tap; the assistant window and unopenable cards offer none',async()=>{
 const search=appendMapsCard('Two matches.',{kind:'places',query:'ferry',places:[place],nextCursor:null,attribution});
 const locate=appendMapsCard('Where are you starting from?',{kind:'locate',intent:'route-origin',prompt:'Where are you starting from?'});
 const {f,shell}=fixture([{id:'a1',from:'agent',text:search},{id:'a2',from:'agent',text:locate}]);
 try{
  const view=shell.renderVals();
  assert.equal(view.msgs[0].mapsCards[0].canOpen,true);assert.equal(view.msgs[1].mapsCards[0].canOpen,false);
  view.msgs[0].mapsCards[0].open();await tick();
  assert.deepEqual(f.opened.map(target=>[target.kind,target.query]),[['places','ferry']]);
  assert.deepEqual(f.options,[{allowDirectStart:false}],'a tap never starts guidance by itself');
  // Already shown (or guidance is on): the tap brings Maps to the front rather than doing nothing.
  assert.deepEqual(f.views,[['maps',{keepState:true}]]);
  assert.equal(f.sent.length,0);
  f.maps={open:async()=>({state:'selected'})};shell.renderVals().msgs[0].mapsCards[0].open();await tick();
  assert.equal(f.views.length,1,'an open that showed the result needs nothing more');
  // A refusal is said in one line on an explicit tap.
  f.maps={open:async()=>{throw new Error('Open Alpha on the phone to use Maps. Nothing was changed on the map.');}};
  shell.renderVals().msgs[0].mapsCards[0].open();await tick();
  assert.deepEqual(f.toasts,['Open Alpha on the phone to use Maps. Nothing was changed on the map.']);
  f.maps=null;shell.renderVals().msgs[0].mapsCards[0].open();await tick();
  assert.equal(f.toasts.at(-1),'Maps isn’t available right now.');
  shell.props={assistantSurface:true};
  assert.equal(shell.renderVals().msgs[0].mapsCards[0].canOpen,false);
 }finally{delete globalThis.mapsChatFixture;}
});
