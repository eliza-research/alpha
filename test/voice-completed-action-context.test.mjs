import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {tsImport} from 'tsx/esm/api';
const viewSource=readFileSync(new URL('../apps/app/src/runtime/view-navigation.ts',import.meta.url),'utf8');
const start=viewSource.indexOf('\tmetadata(context:');
const end=viewSource.indexOf('\n\tcapture(',start);
const metadataMethod=stripTypeScriptTypes('class MetadataOwner { constructor(clientId,currentSession){this.clientId=clientId;this.currentSession=currentSession;this.disposed=false;}'+viewSource.slice(start,end)+'};',{mode:'transform'});
const {alphaCanonicalViewId,alphaViewPath}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
const MetadataOwner=new Function('alphaCanonicalViewId',metadataMethod+'return MetadataOwner;')(alphaCanonicalViewId);
const connectionSource=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const method=connectionSource.match(/voiceRendererMetadata\(context:ContextEnvelope\)\{[^\n]+\}/)?.[0];
assert(method,'actual connection API must delegate to bound canonical metadata owner');
const connectionFactory=new Function('boundNavigation',stripTypeScriptTypes('const connection={'+method+'};',{mode:'transform'})+'return connection;');
const adapterSource=readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
const callbackStart=adapterSource.indexOf('getUiContext:()=>{',adapterSource.indexOf('developmentCartesiaConversation({'));
const callbackEnd=adapterSource.indexOf(',onNavigate:',callbackStart);
const callback=stripTypeScriptTypes('const read='+adapterSource.slice(callbackStart+'getUiContext:'.length,callbackEnd)+';',{mode:'transform'});
function fixture(){let current=true;const context={view:'home',sensitive:false},owner=new MetadataOwner('canonical-client',()=>current),connection=connectionFactory(()=>owner);let contextReads=0;
const read=new Function('current','chat','prepared','connectionController','alphaViewPath',callback+'return read;')(()=>{if(!current)throw Error('changed');},{shell:{voiceConversationContext(){contextReads++;return context;}}},{binding:{}},connection,alphaViewPath);
return {read,context,owner,disconnect(){current=false;},get contextReads(){return contextReads;}};}
test('actual voice getUiContext obtains completed-action from canonical bound navigation metadata',()=>{
 const f=fixture();const value=f.read();assert.equal(value.viewDelivery,'completed-action');assert.equal(value.uiViewPath,'/chat');assert.equal(value.uiBrowserSurface,'native');assert.equal(f.contextReads,1);f.context.view='notes';assert.equal(f.read().uiViewPath,'/notes');
});
test('voice metadata never invents completed-action after sensitive context, disposal or owner replacement',()=>{
 for(const mode of ['sensitive','disposed','disconnected']){const f=fixture();if(mode==='sensitive')f.context.sensitive=true;else if(mode==='disposed')f.owner.disposed=true;else f.disconnect();assert.throws(()=>f.read(),/not bound|changed/);}
 const empty=connectionFactory(()=>undefined);assert.deepEqual(empty.voiceRendererMetadata({view:'home'}),{});
});

test('authenticated upstream browser voice parser preserves only the explicit literal delivery protocol',()=>{
 const projected=readFileSync(new URL('../.eliza/client-features/packages/host/src/voice/ui-context.ts',import.meta.url),'utf8');
 const stamp=JSON.parse(readFileSync(new URL('../.eliza/client-features/.source.json',import.meta.url),'utf8'));
 assert.equal(stamp.sourceFiles['packages/host/src/voice/ui-context.ts'],stamp.files['packages/host/src/voice/ui-context.ts']);
 assert.equal(projected,readFileSync('vendor/eliza/packages/host/src/voice/ui-context.ts','utf8'));
 const js=stripTypeScriptTypes(projected.replace(/^import .*;$/gm,'').replace(/^export /gm,''),{mode:'transform'});
 const parse=new Function('parseViewInteractionClientId',js+';return parseVoiceUiContext;')(v=>typeof v==='string'&&v.length>0?v:null);
 const valid=parse({viewDelivery:'completed-action',uiBrowserSurface:'native',uiClientId:'fixture-client'});assert.equal(valid.viewDelivery,'completed-action');assert.equal(valid.uiClientId,'fixture-client');assert.deepEqual(parse({uiBrowserSurface:'native'}),{uiBrowserSurface:'native'});
 for(const value of [true,null,{},'hosted','completed-action '])assert.equal(parse({viewDelivery:value}),null);
});

test('shared voice context admits direct actions only for a bound renderer',()=>{
 const source=readFileSync('.eliza/client-features/packages/host/src/voice/ui-context.ts','utf8');
 const js=stripTypeScriptTypes(source.replace(/^import .*;$/gm,'').replace(/^export /gm,''),{mode:'transform'});
 const parse=new Function('parseViewInteractionClientId',js+';return parseVoiceUiContext;')(value=>typeof value==='string'&&value.length>0?value:null);
 const binding={viewDelivery:'completed-action',uiClientId:'11111111-2222-4333-8444-555555555555'};
 assert.equal(parse({...binding,agentActionMode:'direct-request-v1'}).agentActionMode,'direct-request-v1');
 assert.equal(parse({agentActionMode:'direct-request-v1'}),null);assert.equal(parse({...binding,agentActionMode:'always'}),null);
 assert.equal(parse(binding).agentActionMode,undefined);
});
test('shared completion parser preserves exact message IDs and refuses malformed correlation',()=>{
 const source=readFileSync('.eliza/client-features/packages/ui/src/voice/voice-session-protocol.ts','utf8');
 const js=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
 const parse=new Function('findViewActionHandoff',js+';return parseServerControl;')(()=>null);
 const frame={t:'reply_complete',traceId:'trace',userMessageId:'11111111-2222-4333-8444-555555555555'};
 assert.deepEqual(parse(JSON.stringify(frame)),frame);assert.equal(parse(JSON.stringify({...frame,userMessageId:'bad'})),null);
 assert.deepEqual(parse(JSON.stringify({t:'reply_complete',traceId:'trace'})),{t:'reply_complete',traceId:'trace'});
});
