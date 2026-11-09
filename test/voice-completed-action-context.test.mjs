import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const viewSource=readFileSync(new URL('../apps/app/src/runtime/view-navigation.ts',import.meta.url),'utf8');
const start=viewSource.indexOf('\tmetadata(context:');
const end=viewSource.indexOf('\n\tcapture(',start);
const metadataMethod=stripTypeScriptTypes('class MetadataOwner { constructor(clientId,currentSession){this.clientId=clientId;this.currentSession=currentSession;this.disposed=false;}'+viewSource.slice(start,end)+'};',{mode:'strip'});
const MetadataOwner=new Function(metadataMethod+'return MetadataOwner;')();
const connectionSource=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const method=connectionSource.match(/voiceRendererMetadata\(context:ContextEnvelope\)\{[^\n]+\}/)?.[0];
assert(method,'actual connection API must delegate to bound canonical metadata owner');
const connectionFactory=new Function('boundNavigation',stripTypeScriptTypes('const connection={'+method+'};',{mode:'strip'})+'return connection;');
const adapterSource=readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
const callbackStart=adapterSource.indexOf('getUiContext:()=>{',adapterSource.indexOf('developmentCartesiaConversation({'));
const callbackEnd=adapterSource.indexOf(',onNavigate:',callbackStart);
const callback=stripTypeScriptTypes('const read='+adapterSource.slice(callbackStart+'getUiContext:'.length,callbackEnd)+';',{mode:'strip'});
function fixture(){let current=true;const context={view:'home',sensitive:false},owner=new MetadataOwner('canonical-client',()=>current),connection=connectionFactory(()=>owner);let contextReads=0;
const read=new Function('current','chat','prepared','connectionController',callback+'return read;')(()=>{if(!current)throw Error('changed');},{shell:{voiceConversationContext(){contextReads++;return context;}}},{binding:{}},connection);
return {read,context,owner,disconnect(){current=false;},get contextReads(){return contextReads;}};}
test('actual voice getUiContext obtains completed-action from canonical bound navigation metadata',()=>{
 const f=fixture();const value=f.read();assert.equal(value.viewDelivery,'completed-action');assert.equal(value.uiViewPath,'/chat');assert.equal(value.uiBrowserSurface,'native');assert.equal(f.contextReads,1);f.context.view='notes';assert.equal(f.read().uiViewPath,'/notes');
});
test('voice metadata never invents completed-action after sensitive context, disposal or owner replacement',()=>{
 for(const mode of ['sensitive','disposed','disconnected']){const f=fixture();if(mode==='sensitive')f.context.sensitive=true;else if(mode==='disposed')f.owner.disposed=true;else f.disconnect();assert.throws(()=>f.read(),/not bound|changed/);}
 const empty=connectionFactory(()=>undefined);assert.deepEqual(empty.voiceRendererMetadata({view:'home'}),{});
});
