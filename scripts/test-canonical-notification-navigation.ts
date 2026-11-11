import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';
import {createOwnNoticeRevisions} from '../apps/app/src/prototype/context-selection.ts';
const read=(path: string)=>readFile(new URL('../'+path,import.meta.url),'utf8');
const source=(await read('apps/app/src/prototype/notifications-adapter.ts')).replace(/^import .*;\n/gm,'').replaceAll('export function','function');
// main.tsx's own install statements, run with the real shade policy for each build shape.
{
 const shade=(await read('.eliza/client-features/plugins/plugin-native-system/src/client/shade.ts')).replace(/^export /gm,'');
 const installs=(await read('apps/app/src/main.tsx')).split('\n').filter(line=>/install(?:CanonicalNotificationTaps|NotificationsAdapter)\(Component\)/.test(line)).join('\n');
 assert.equal(installs.split('\n').length,2);
 const decide=(isAndroid: boolean,devSurfacesEnabled: boolean)=>{const installed: string[]=[];vm.runInNewContext(stripTypeScriptTypes(shade,{mode:'strip'})+'\nconst systemShade=shadeSurface({native:isAndroid,simulated:devSurfacesEnabled});\n'+installs,{isAndroid,devSurfacesEnabled,Component:{},installCanonicalNotificationTaps:()=>installed.push('taps'),installNotificationsAdapter:()=>installed.push('notices')});return installed;};
 assert.deepEqual(decide(true,false),['taps']);
 assert.deepEqual(decide(true,true),['taps']);
 assert.deepEqual(decide(false,true),['notices']);
 assert.deepEqual(decide(false,false),[]);
}
const tick=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
type Tap = Partial<Record<'token' | 'ownerId' | 'agentId' | 'view' | 'conversationId' | 'messageId', string>>;
type History = {conversationId: string; messages: {id: string}[]};
type FixtureState = {draft: string; typing: boolean; recording: boolean; view: string; chat: false | 'full'; shade: boolean};
type Callback = () => void;
type AsyncHook = () => Promise<void>;

function fixture({admitted=new Set(['calendar','notes','workflows'])}: {admitted?: ReadonlySet<string>} = {}){
 let pending: Tap = {};
 let readHook: AsyncHook | undefined, restoreHook: AsyncHook | undefined;
 let commitHook: Callback | undefined, commitDelay: ((done?: Callback) => void) | undefined;
 let selectedConversation: string | undefined;
 const navigation = {revision: 0};
 const acknowledgments: string[] = [], restores: string[] = [], views: string[] = [];
 const session={ownerId:'owner',agentId:'agent',sessionId:'session'};
 const connection: {session: typeof session; busy: boolean; open: boolean; history?: History | null} = {
  session,busy:false,open:false,history:undefined,
 };
 const state: FixtureState = {draft:'',typing:false,recording:false,view:'home',chat:false,shade:false};
 const native={
  addListener:async()=>({remove:async()=>{}}),
  canonicalPending:async()=>{const current={...pending};await readHook?.();return current;},
  acknowledgeCanonical:async({token}: {token: string})=>{
   if(token!==pending.token)throw Error('Changed tap');
   acknowledgments.push(token);pending={};return {ok:true};
  },
 };
 const controller={
  getSnapshot:()=>connection,getSelectedConversationId:()=>selectedConversation,subscribe:()=>()=>{},
  restoreHistory:async(id: string,canCommit: () => boolean)=>{
   restores.push(id);
   await restoreHook?.();
   if(canCommit()){selectedConversation=id;connection.history={conversationId:id,messages:[{id:'message'}]};}
  },
 };
 class Component {
  declare alphaCanonicalTap: () => Promise<void>;
  declare alphaCanonicalWake: Callback;
  declare alphaNoticesLive?: boolean;
  renderVals() { return {}; }
  S() { return state; }
  setState(patch: Partial<FixtureState>,done?: Callback) {
   Object.assign(state,patch);
   commitHook?.();
   if(commitDelay)commitDelay(done);else done?.();
  }
  openView(view: string) { views.push(view);state.view=view; }
  componentDidMount() {}
  componentWillUnmount() {}
 }
 const sandbox={Component,alphaClient:{getState:()=>({context:navigation})},connectionController:controller,registerPlugin:()=>native,Capacitor:{isNativePlatform:()=>true},queueMicrotask,window:{addEventListener(){},removeEventListener(){},setInterval:()=>1,clearInterval(){}},document:{hidden:false,addEventListener(){},removeEventListener(){}},reviewContentQuestion(){},sensitiveReadingText:()=>false,createOwnNoticeRevisions,noticeCurrent:()=>true,noticeExcerpt:()=>'',noticeReviewable:()=>true,isMvpView:(view: string)=>admitted.has(view)};
 vm.runInNewContext(stripTypeScriptTypes(source+'\ninstallCanonicalNotificationTaps(Component);',{mode:'transform'}),sandbox);
 const shell=new Component();shell.componentDidMount();
 return {
  shell,state,connection,navigation,acknowledgments,restores,views,
  select:(id: string)=>{selectedConversation=id;},
  commit:(fn: Callback)=>{commitHook=fn;},
  delayCommit:(fn: typeof commitDelay)=>{commitDelay=fn;},
  holdRead:(fn: typeof readHook)=>{readHook=fn;},
  setTap:(extra: Tap={})=>{pending={token:'tap-a',ownerId:'owner',agentId:'agent',view:'chat',conversationId:'conversation',messageId:'message',...extra};},
  hook:(fn: typeof restoreHook)=>{restoreHook=fn;},
 };
}
{
 const f=fixture();await tick();f.setTap();await f.shell.alphaCanonicalTap();await tick();assert.equal(f.state.chat,'full');assert.deepEqual(f.acknowledgments,['tap-a']);assert.deepEqual(f.restores,['conversation']);
}
{
 const f=fixture();await tick();f.setTap({ownerId:'other'});await f.shell.alphaCanonicalTap();assert.equal(f.acknowledgments.length,0);assert.equal(f.restores.length,0);
}
{
 // Approval needed and scheduled tasks carry no message coordinates: open the current chat and acknowledge.
 const f=fixture();await tick();f.connection.history=null;f.setTap({conversationId:undefined,messageId:undefined});await f.shell.alphaCanonicalTap();await tick();assert.deepEqual(f.acknowledgments,['tap-a']);assert.equal(f.restores.length,0);assert.equal(f.state.chat,'full');assert.equal(f.views.length,0);
 const guardSource=source.match(/const exactChat=\(\)=>[^;]+;/)?.[0];assert.ok(guardSource);
 const nullGuard=vm.runInNewContext('(restored,tap)=>{'+guardSource+'return exactChat();}',{});
 assert.equal(nullGuard(null,{conversationId:undefined,messageId:undefined}),false);
}
{
 const f=fixture();await tick();f.setTap({conversationId:undefined,messageId:undefined});f.state.draft='Keep my draft';await f.shell.alphaCanonicalTap();await tick();assert.equal(f.acknowledgments.length,0);assert.equal(f.state.chat,false);assert.equal(f.state.draft,'Keep my draft');
}
for(const active of ['draft','recording','typing'] as const){
 const f=fixture();await tick();f.setTap();if(active==='draft')f.state.draft='Keep my draft';else f.state[active]=true;await f.shell.alphaCanonicalTap();assert.equal(f.restores.length,0);assert.equal(f.acknowledgments.length,0);
}
{
 const f=fixture();await tick();f.setTap({view:'automations'});await f.shell.alphaCanonicalTap();await tick();assert.deepEqual(f.views,['workflows']);assert.deepEqual(f.acknowledgments,['tap-a']);assert.equal(f.restores.length,0);
}
for(const view of ['clock','reminders','apps/tasks']){
 // Clock and device reminders live in Calendar.
 const f=fixture();await tick();f.setTap({view,conversationId:undefined,messageId:undefined});await f.shell.alphaCanonicalTap();await tick();assert.deepEqual(f.views,['calendar']);assert.deepEqual(f.acknowledgments,['tap-a']);assert.equal(f.state.chat,false);
}
{
 // A route whose view this install does not admit falls back to the current chat.
 const f=fixture({admitted:new Set()});await tick();f.setTap({view:'clock',conversationId:undefined,messageId:undefined});await f.shell.alphaCanonicalTap();await tick();assert.equal(f.views.length,0);assert.equal(f.state.chat,'full');assert.deepEqual(f.acknowledgments,['tap-a']);
}
{
 const f=fixture();await tick();f.setTap({view:'clock'});f.state.typing=true;await f.shell.alphaCanonicalTap();await tick();assert.equal(f.views.length,0);assert.equal(f.acknowledgments.length,0);
}
{
 const f=fixture();await tick();f.setTap();const {promise,resolve:release}=Promise.withResolvers<void>();f.hook(()=>promise);const opening=f.shell.alphaCanonicalTap();await tick();f.state.draft='Typed while loading';release();await opening;assert.equal(f.state.draft,'Typed while loading');assert.equal(f.connection.history,undefined);assert.equal(f.acknowledgments.length,0);
}
{
 const f=fixture();await tick();f.setTap();const {promise,resolve:release}=Promise.withResolvers<void>();f.hook(()=>promise);const opening=f.shell.alphaCanonicalTap();await tick();f.setTap({token:'tap-b'});f.shell.alphaCanonicalWake();f.hook(undefined);release();await opening;await tick();assert.deepEqual(f.acknowledgments,['tap-b']);
}
for(const change of ['view','conversation','dialog']){
 const f=fixture();await tick();f.setTap();const {promise,resolve:release}=Promise.withResolvers<void>();f.hook(()=>promise);const opening=f.shell.alphaCanonicalTap();await tick();
 if(change==='view'){f.state.view='calendar';f.navigation.revision++;}
 if(change==='conversation'){f.select('manual-conversation');f.connection.history={conversationId:'manual-conversation',messages:[]};}
 if(change==='dialog')f.connection.open=true;
 release();await opening;assert.equal(f.acknowledgments.length,0);assert.notEqual(f.connection.history?.conversationId,'conversation');
}
{
 const f=fixture();await tick();f.setTap();f.commit(()=>{f.select('manual-conversation');f.connection.history={conversationId:'manual-conversation',messages:[]};});await f.shell.alphaCanonicalTap();assert.equal(f.acknowledgments.length,0);
}
{
 // The notice adapter is not installed (Android's own shade): a pending tap still opens and acknowledges.
 const f=fixture();await tick();f.setTap({view:'notes'});await f.shell.alphaCanonicalTap();await tick();assert.equal(f.shell.alphaNoticesLive,undefined);assert.deepEqual(f.views,['notes']);assert.deepEqual(f.acknowledgments,['tap-a']);
}
{
 const f=fixture();await tick();f.shell.componentWillUnmount();f.setTap();await f.shell.alphaCanonicalTap();assert.equal(f.restores.length,0);assert.equal(f.acknowledgments.length,0);
}
{
 const f=fixture();await tick();f.setTap({view:'notes'});const {promise,resolve:release}=Promise.withResolvers<void>();
 f.holdRead(()=>promise);
 const opening=f.shell.alphaCanonicalTap();await tick();f.connection.busy=true;release();await opening;
 assert.deepEqual(f.views,[],'a connection operation started during readback owns navigation');
 assert.deepEqual(f.acknowledgments,[]);
}
{
 const f=fixture();await tick();f.setTap({view:'notes'});const callbacks: Callback[]=[];
 f.delayCommit(callback=>{assert.ok(callback);callbacks.push(callback);});
 const opening=f.shell.alphaCanonicalTap();await tick();f.shell.alphaCanonicalWake();await tick();
 const observed=[...f.views];f.delayCommit(undefined);callbacks.forEach(callback=>callback());await opening;await tick();
 assert.deepEqual(observed,['notes'],'a new wake cannot reopen a tap before its renderer commit');
 assert.deepEqual(f.acknowledgments,['tap-a']);
}
{
 const f=fixture();await tick();f.setTap({view:'notes'});const {promise,resolve:release}=Promise.withResolvers<void>();
 f.holdRead(()=>promise);
 const old=f.shell.alphaCanonicalTap();await tick();f.shell.componentWillUnmount();
 f.holdRead(undefined);f.setTap({token:'tap-b',view:'clock'});
 f.shell.componentDidMount();await tick();release();await old;
 assert.deepEqual(f.views,['calendar'],'a retired mount cannot publish into the reused component');
 assert.deepEqual(f.acknowledgments,['tap-b']);
}
console.log('PASS canonical notification navigation: installed on every Android build, current owner, restored message, no draft/voice interruption, every admitted route opens and acknowledges, atomic token and next tap drain');
