import {validateUuid} from '../vendor/eliza/packages/core/src/utils/uuid.ts';
import {isCalendarReadFailureCode} from '../.eliza/client-features/packages/contracts/src/calendar.ts';
import * as residentRecovery from '../apps/app/src/runtime/resident-recovery.ts';
import {resolveCloudEnvironment} from '../apps/app/src/runtime/cloud-environment-selection.ts';
// Non-product development controller + shared Cloud protocol over synthetic loopback HTTP. No live account.
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { installWorkflowDeviceBindings } from '../test/fixtures/workflow-device-bindings.mjs';
const cloudSignInModule = await import('../apps/app/src/runtime/cloud-sign-in.ts');
if (!process.execArgv.includes('--experimental-transform-types')) {
  process.exit(spawnSync(process.execPath, ['--import','tsx','--experimental-transform-types', process.argv[1]], { stdio: 'inherit' }).status ?? 1);
}
const {clockHandoffCapabilities}=await import('../apps/app/src/runtime/clock-contract.ts');
const {PHONE_DIAL_CAPABILITY,telephonyDeviceCapabilities}=await import('../apps/app/src/runtime/phone-dial-contract.ts');
const {appRecordInvalidations}=await import('../apps/app/src/runtime/app-record-completion.ts');
const {AUTOMATIONS_COMMITTED_EVENT,automationsCommitted}=await import('../apps/app/src/runtime/automation-completion.ts');
const { cloudServiceName, CloudProtocol, CloudProtocolError, CloudProvisionAcceptedError } = await import('../apps/app/src/runtime/cloud-protocol.ts');
const { PersonalProtocolError } = await import('../apps/app/src/runtime/cloud-personal-protocol.ts');
const { DevelopmentCloudAgentProtocol } = await import('../apps/app/src/runtime/development-cloud-agents.ts');
const { phoneContextMessage } = await import('../apps/app/src/runtime/phone-context.ts');
const { findStoppedUserTurn } = await import('../.eliza/client-features/packages/ui/src/api/conversation-turn-controller.ts');
const { RemoteProtocol } = await import('../apps/app/src/runtime/remote-protocol.ts');
const { presentDeviceRecordOperation } = await import('../apps/app/src/runtime/device-record-presentation.ts');
const subscriptionEntitlement = await import('../apps/app/src/runtime/subscription-entitlement.ts');
const { AlphaClient, AlphaClientError } = await import('../apps/app/src/runtime/alpha-client.ts');
const {loadBrowserModule}=await import('../test/fixtures/browser-source.mjs');
const [{LocalAgentProtocol},{withResidentMapsNavigation}]=await loadBrowserModule(['apps/app/src/runtime/local-agent.ts','apps/app/src/maps/resident-relay.ts']);
const { ClientObservationSupportSession } = await import('../apps/app/src/runtime/client-observation-support.ts');
const user = '11111111-1111-4111-8111-111111111111', agent = '22222222-2222-4222-8222-222222222222', organization = '99999999-9999-4999-8999-999999999999';
const personal = 'personal:12345678-1234-5234-8234-123456789abc', agentHost = `https://${agent}.cloud.eliza.app`;
const conversation = '33333333-3333-4333-8333-333333333333';
const sentBodies=[];
let registrationVersion = "unavailable";
let credential = { token: 'synthetic-token', credentialId: 'synthetic-generation' }, historyReads = 0, sends = 0;
const observed = phoneContextMessage('Earlier user text', { view: 'inbox', revision: 2, sensitive: false }).text;
const server = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer synthetic-token');
  let data, status = 200;
  // The personal identity is already on a running Dedicated agent; the chooser connects to it.
  if (registrationVersion !== 'unavailable' && req.url === '/api/client-devices/capabilities') data = {protocol:1,agentId:agent,identityId:user,externalIdentity:{subject:user,organizationId:organization,issuer:'https://login.example'},deviceActions:{protocol:1,capabilities:['calendar.local-event.v1']}};
  else if (registrationVersion !== 'unavailable' && req.url === '/api/client-devices/register') data = {installationId:req.headers['x-eliza-device-id'],enrollmentId:'cloud-enrollment',capabilities:['calendar.local-event.v1'],viewProfileVersion:1,...(registrationVersion===undefined?{}:{userTextFormatVersion:registrationVersion})};
  else if (registrationVersion !== 'unavailable' && req.url === '/api/client-devices/revoke') data = {revoked:true};
  else if (req.url === '/api/v1/billing/limits') data = {success:true,data:{schemaVersion:2,v2:{balance:{status:'available',source:'organizations',observedAt:new Date().toISOString(),value:{revision:'1',balance:{unit:'usd',currency:'USD',value:'10'}}}}}};
  else if (req.url === '/api/v1/user') data = { success: true, data: { id: user, organization_id: organization } };
  else if (req.url === '/api/v1/eliza/personal') data = { success: true, data: { identity: { id: personal, displayName: 'Fixture', runtime: 'dedicated', activeAgentId: agent, apiBase: agentHost } } };
  else if (req.url === `/api/v1/eliza/agents/${agent}`) data = { success: true, data: { id: agent, agentName: 'Fixture', status: 'running', executionTier: 'dedicated-always', webUiUrl: agentHost } };
  else if (req.url.endsWith('/api/conversations')) data = { conversations: [{ id: conversation, title: 'Saved conversation' }] };
  else if (req.url.endsWith(`/api/conversations/${conversation}/messages`)) {
    if (req.method === 'GET') { historyReads++; data = { messages: [{ id: 'u1', role: 'user', text: observed }, { id: 'a1', role: 'assistant', text: 'Earlier answer', actions: [{ type: 'unsafe' }] }] }; }
    else { const chunks=[];for await(const chunk of req)chunks.push(chunk);sentBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));sends++; data = { text: 'New answer', agentName: 'Fixture' }; }
  } else { status = 404; data = {}; }
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// Synthetic paired remote agent: 260 persisted messages (more than one 200-message window),
// keyset paging, device/session revocation, and a held send for Stop reconciliation.
const remoteOwner='44444444-4444-4444-8444-444444444444',remoteAgent='55555555-5555-4555-8555-555555555555',remoteConversation='66666666-6666-4666-8666-666666666666';
const remoteMessages=Array.from({length:260},(_,index)=>({id:`77777777-7777-4777-8777-${String(index).padStart(12,'0')}`,role:index%2?'assistant':'user',text:`Synthetic message ${index}`,timestamp:1_000+index}));
const remoteRoom='99999999-8888-4777-8666-555555555555';
const remote={tokens:new Set(),revoked:new Set(),pairs:0,pages:[],deviceRevokes:0,logouts:0,held:null,abortRoute:false,aborts:[]};
const remoteServer=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
  const url=new URL(req.url,'https://agent.example'),token=(req.headers.authorization||'').replace(/^Bearer /,'');
  const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/api/auth/status')return reply(200,{required:true,authenticated:false,pairingEnabled:true,instanceId:'remote-instance',bootstrapRequired:false,expiresAt:null});
  if(url.pathname==='/api/auth/pair'){remote.pairs++;const issued=`remote-token-${remote.pairs}`;remote.tokens.add(issued);return reply(200,{token:issued,identityId:remoteOwner,instanceId:'remote-instance',access:'owner'});}
  if(!remote.tokens.has(token)||remote.revoked.has(token))return reply(401,{});
  if(url.pathname==='/api/auth/me')return reply(200,{identity:{id:remoteOwner,kind:'owner',displayName:'Remote owner'},session:{id:token,kind:'machine',expiresAt:Date.now()+3_600_000},access:{role:'OWNER',mode:'session'}});
  if(url.pathname==='/api/agents')return reply(200,{agents:[{id:remoteAgent,name:'Remote fixture',status:'running'}]});
  if(url.pathname==='/api/client-devices/register')return reply(200,{installationId:req.headers['x-eliza-device-id'],enrollmentId:'remote-enrollment',capabilities:[]});
  if(url.pathname==='/api/client-devices/revoke'){assert.ok(req.headers['x-eliza-device-key'],'device revocation proves the installation key');remote.deviceRevokes++;return reply(200,{revoked:true});}
  if(url.pathname==='/api/auth/logout'){remote.logouts++;remote.revoked.add(token);return reply(200,{ok:true});}
  if(url.pathname==='/api/conversations')return reply(200,{conversations:[{id:remoteConversation,title:'Long conversation',...(remote.abortRoute?{roomId:remoteRoom}:{})}]});
  // Upstream plugin-assistant turn abort; disabled for the first Stop to model agents without it.
  if(remote.abortRoute&&url.pathname===`/api/turns/${remoteRoom}/abort`&&req.method==='POST'){remote.aborts.push(body);const active=Boolean(remote.held);remote.held?.cancel();remote.held=null;return reply(200,{aborted:active,roomId:remoteRoom,reason:body?.reason});}
  if(url.pathname===`/api/conversations/${remoteConversation}/messages`&&req.method==='GET'){
    if(!url.searchParams.has('before'))return reply(200,{messages:remoteMessages.slice(-200)});
    const before=Number(url.searchParams.get('before')),beforeId=url.searchParams.get('beforeId'),limit=Number(url.searchParams.get('limit')||50);
    remote.pages.push({before,beforeId,limit});
    const older=remoteMessages.filter(item=>item.timestamp<before||(item.timestamp===before&&item.id<beforeId)).sort((a,b)=>b.timestamp-a.timestamp);
    return reply(200,{messages:older.slice(0,limit).reverse(),hasMore:older.length>limit});
  }
  if(url.pathname===`/api/conversations/${remoteConversation}/messages`&&req.method==='POST'){
    remote.lastBody=body;
    if(remote.failPost){remote.failPost=false;remote.failedPosts=(remote.failedPosts||0)+1;return reply(500,{});}
    // Upstream reply shape for a refused turn: ChatTerminalFailure carries only kind/message/transient/code.
    if(remote.failureReply){const failure=remote.failureReply;remote.failureReply=null;remote.failureReplies=(remote.failureReplies||0)+1;return reply(200,{text:remote.failureText??'',agentName:'Remote fixture',messageId:remote.failureMessageId,userMessageId:remote.failureUserMessageId,failureKind:failure.kind,terminalFailure:failure});}
    // Held: the phone stops waiting; the agent still finishes and persists the reply.
    remote.sends=(remote.sends||0)+1;const user={id:`88888888-8888-4888-8888-${String(remote.sends*2-1).padStart(12,'0')}`,role:'user',text:body.text,timestamp:Date.now()};
    remoteMessages.push(user);
    remote.held=()=>{remote.held=null;remoteMessages.push({id:`88888888-8888-4888-8888-${String(remote.sends*2).padStart(12,'0')}`,role:'assistant',text:'Finished after Stop',timestamp:Date.now()+1,replyToMessageId:user.id});reply(200,{text:'Finished after Stop',agentName:'Remote fixture'});};
    remote.held.cancel=()=>reply(200,{text:'',agentName:'Remote fixture',interrupted:true});
    return;
  }
  reply(404,{});
});
await new Promise(resolve => remoteServer.listen(0, '127.0.0.1', resolve));
const nativeRemoteRequest=async input=>{
  const url=new URL(input.url);assert.equal(url.origin,'https://agent.example');
  const response=await fetch(`http://127.0.0.1:${remoteServer.address().port}${url.pathname}${url.search}`,{method:input.method,headers:input.headers,body:input.body,signal:input.signal});
  return {status:response.status,body:await response.json()};
};
const remoteSaved=new Map(),deviceSlots=new Map();
const remoteCredentialStore={read:async origin=>remoteSaved.get(origin)??null,write:async record=>{remoteSaved.set(record.origin,record);},remove:async origin=>{remoteSaved.delete(origin);}};
let actionEntries=[];const reconciled=[];
class DeviceActions{constructor(_session,credential,scope){this.credential=credential;this.scope=scope;}async pending(){return [];}async pendingReview(){return [];}async history(){return actionEntries;}async reject(id){actionEntries=actionEntries.map(entry=>entry.id===id?{...entry,state:'rejected'}:entry);}async reconcile(id,outcome){reconciled.push([id,outcome]);actionEntries=actionEntries.filter(entry=>entry.id!==id);}async syncReceipts(){}}
const memory = new Map();
const nativeCloudRequest = async input => {
  const url = new URL(input.url);
  assert.ok(url.origin === 'https://api.eliza.app' || url.origin === agentHost, 'only the Cloud API and the verified Dedicated host are contacted');
  const response = await fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`, { method: input.method, headers: input.headers, signal: input.signal, body: input.body ? JSON.stringify(input.body) : undefined });
  return { status: response.status, data: await response.json() };
};
let clockRetirements=0,heldClockRetirement=null,clockRetirementStarted=null;
const retireClockReviews=async()=>{clockRetirements++;clockRetirementStarted?.();if(heldClockRetirement)await heldClockRetirement;};
// This controller fixture models a host whose transport reaches Eliza Cloud. The flag-off web page
// has none and starts no Cloud route; test/browser/connection-boundaries.production.spec.ts covers it.
const sandbox = { validateUuid, isCalendarReadFailureCode, appRecordInvalidations,AUTOMATIONS_COMMITTED_EVENT,automationsCommitted, browserCloudResidentEnabled:false,browserCloudResidentEnvironment:'production',...residentRecovery,CAMERA_CAPTURE_CAPABILITY:'camera.capture-photo.v1',clockHandoffCapabilities,PHONE_DIAL_CAPABILITY,telephonyDeviceCapabilities,readDevicePreferences:async()=>({askBeforeAgentActions:true}),  resolveCloudEnvironment,fixtureViteEnv:{DEV:true},...subscriptionEntitlement, ...cloudSignInModule, cloudSignIn:undefined, cloudSignInGoogle:false, AlphaClientError, browserLocalAgentEnabled:true, retireClockReviews, workflowPresentationProtocol:async()=>2, browserDevProfile:false,privateLocalPreviewEnabled:false, devProfileQuery:false, testMocksEnabled:true, devSurfacesEnabled:true, secureConnectionStore:{read:async slot=>deviceSlots.get(slot)??null,write:async(slot,value)=>{deviceSlots.set(slot,value);},remove:async slot=>{deviceSlots.delete(slot);}},
  PersonalProtocolError, ClientObservationSupportSession, personalIntent:async()=>null, savePersonalIntent:async(_owner,intent)=>intent, clearPersonalIntent:async()=>{},
  withResidentMapsNavigation, RemoteProtocol, remoteCredentialStore, nativeRemoteRequest, DeviceActions, presentDeviceRecordOperation, actionScope:async value=>Buffer.from(value).toString('base64url').slice(0,32), negotiateEnabledViews:async()=>'',
  Capacitor:{getPlatform:()=>'web',isNativePlatform:()=>false},aospImage:false,SMS_SEND_CAPABILITY:'sms.send.v1', setTimeout:(callback,ms)=>setTimeout(callback,ms===15000?20:ms), clearTimeout, Intl, Date, Buffer, pauseHostedBackground:async()=>{}, configureHostedBackground:async()=>{}, registerPlugin: () => ({}), cloudServiceName, CloudProtocol, CloudProtocolError, DevelopmentCloudAgentProtocol, CloudProvisionAcceptedError, phoneContextMessage, findStoppedUserTurn, nativeCloudRequest,
  cloudCredentialStore: { read: async () => credential, write: async (_environment, value) => { credential = value; }, clear: async () => { credential = null; } },
  openConnectionBrowser: async () => { throw new Error('Unexpected browser effect'); },
  cloudSelfRevocationSupported:false, isAndroid: false, localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) },
  URL, URLSearchParams, AbortController, DOMException, crypto: globalThis.crypto, console,
};
// Exercise the real installed string-map adapter alongside the controller fixture.
const selectionSandbox = { ...sandbox, Capacitor: { getPlatform: () => 'android' } };
const selectionSource = stripTypeScriptTypes(await readFile(new URL('../apps/app/src/runtime/conversation-selection.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\n/gm, '').replace(/export /g, '');
vm.runInNewContext(selectionSource + '\nglobalThis.selectionApi = { captureConversationChoice, selectConversation };', selectionSandbox);
Object.assign(sandbox, selectionSandbox.selectionApi);
let source = (await readFile(new URL('../apps/app/src/runtime/connection-ui.tsx', import.meta.url), 'utf8')).split('export function ConnectionChooser()')[0].replace(/\nfunction ResidentRecoveryPanel\([\s\S]*?\n}\n(?=export function productionCloudSignInRequired)/, '\n');
source = source.replace(/^import .*;\n/gm, '').replace(/export /g, '').replaceAll('import.meta.env','fixtureViteEnv');
source += '\nglobalThis.controller = connectionController;';
source += '\nglobalThis.observationFixture={activate:(client,format)=>activate({kind:"resident",remote:client,origin:client.origin,userTextFormatVersion:format},client.session,"Observation fixture"),retire:()=>retire()};';
vm.createContext(sandbox);
installWorkflowDeviceBindings(sandbox);
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), sandbox);
const controller = sandbox.controller;
try {
  await controller.cloudList('production');
  assert.ok(controller.getSnapshot().cloudAccount);
  assert.equal(controller.getSnapshot().cloudPersonal?.view?.kind,'ready','the personal Dedicated agent is reported ready');
  assert.equal('cloudChoose' in controller,false,'no unreachable generic agent chooser remains');
  await controller.cloudPersonalConnect();
  assert.equal(controller.getSnapshot().error,'','Cloud activation must succeed before history assertions');
  assert.ok(controller.getSnapshot().session,'Cloud agent session is active');
  await controller.listHistory();
  assert.equal(controller.getSnapshot().conversations[0].id, conversation);
  await controller.restoreHistory('not-authorized');
  assert.equal(historyReads, 0, 'membership check blocks unlisted history requests');
  assert.equal(controller.getSnapshot().history, null);
  await controller.restoreHistory(conversation);
  assert.equal(controller.getSnapshot().error, '', 'History restoration must succeed');
  const restored = controller.getSnapshot().history;
  assert.equal(restored.messages[0].text, 'Earlier user text');
  assert.equal(restored.messages[1].text, 'Earlier answer');
  assert.deepEqual(Object.keys(restored.messages[1]).sort(), ['from', 'id', 'text']);
  assert.equal(sends, 0, 'restoring history never sends or executes actions');
  await controller.send('New question', { view: 'home', revision: 1, sensitive: false }, 'synthetic-id', new AbortController().signal);
  assert.equal(sends, 1, 'next send uses the explicitly restored conversation');
  assert.equal(Object.hasOwn(sentBodies[0].metadata,'uiTimeZone'),false,'Unknown current device zone is omitted');
  assert.equal(sentBodies[0].text,phoneContextMessage('New question',{view:'home',revision:1,sensitive:false}).text,'Unverified Cloud/browser path retains its legacy text envelope');
  assert.deepEqual(sentBodies[0].metadata.alphaPhone,sentBodies[0].metadata.clientDevice);assert.equal(Object.hasOwn(sentBodies[0].metadata,'userTextFormat'),false);
  for(const timeZone of ['America/Los_Angeles','Asia/Kolkata']){
    await controller.send('Current device zone question',{view:'home',revision:2,sensitive:false,timeZone},'zone-'+timeZone,new AbortController().signal);
    const wire=sentBodies.at(-1).metadata;
    assert.equal(wire.uiTimeZone,timeZone,'CURRENT_TIME receives the current validated device zone on the actual HTTP request');
    assert.equal(wire.clientDevice.context.timeZone,timeZone);assert.equal(wire.alphaPhone.context.timeZone,timeZone);
  }
  assert.equal(sends,3);
  await assert.rejects(controller.send('Invalid zone',{view:'home',revision:3,sensitive:false,timeZone:'Not/A_Zone'},'invalid-zone',new AbortController().signal));
  assert.equal(sends,3,'An invalid timezone cannot reach the transport');

  for (const version of [1, undefined, 2, '1']) {
    await controller.disconnect();
    registrationVersion=version;
    await controller.cloudPersonalConnect();
    assert.ok(controller.getSnapshot().session,'registered Cloud connection succeeds');
    assert.equal(controller.getSnapshot().error,'');
    // A device-registration fault is swallowed into the legacy text path; prove the
    // registration (and its negotiated text format) actually completed.
    assert.equal(controller.getSnapshot().phoneCapabilityReason,'','Cloud device registration completes');
    assert.equal(controller.getSnapshot().phoneActionsAvailable,true,'Cloud device actions are enrolled');
    const literal=phoneContextMessage('literal authored envelope',{view:'notes',revision:9,sensitive:false}).text;
    await controller.send(literal,{view:'notes',revision:10,sensitive:false},'format-'+String(version),new AbortController().signal);
    const sent=sentBodies.at(-1);
    assert.equal(sent.text,version===1?literal:phoneContextMessage(literal,{view:'notes',revision:10,sensitive:false}).text);
    assert.equal(sent.metadata.userTextFormat,version===1?'plain-v1':undefined);
    assert.equal(Object.hasOwn(sent.metadata,'alphaPhone'),version!==1);
    assert.equal(sent.metadata.clientDevice.context.view,'notes');
    await controller.send('No compatible Cloud day carrier',{view:'calendar',revision:11,sensitive:false,timeZone:'America/Los_Angeles',calendarDay:{date:'2026-10-29',timeZone:'America/Los_Angeles'}},'cloud-day-'+String(version),new AbortController().signal);
    assert.equal(JSON.stringify(sentBodies.at(-1)).includes('calendarDay'),false,'Cloud/legacy paths omit the unsupported day in every metadata/text projection');
    if(version===undefined){
      // A product build never sends the legacy envelope: an unnegotiated peer receives the
      // authored text, with the observation only in metadata.
      sandbox.testMocksEnabled=false;
      try{await controller.send('Plain authored question',{view:'notes',revision:11,sensitive:false},'format-flag-off',new AbortController().signal);}
      finally{sandbox.testMocksEnabled=true;}
      const plain=sentBodies.at(-1);
      assert.equal(plain.text,'Plain authored question','flag-off builds send no legacy envelope to an unnegotiated peer');
      assert.equal(plain.metadata.clientDevice.context.view,'notes');
    }
  }
  const beforeRetirements=clockRetirements;
  let releaseClockRetirement;heldClockRetirement=new Promise(resolve=>{releaseClockRetirement=resolve;});
  const retirementStarted=new Promise(resolve=>{clockRetirementStarted=resolve;});
  let disconnected=false;const disconnect=controller.disconnect().then(()=>{disconnected=true;});
  await retirementStarted;
  assert.equal(clockRetirements,beforeRetirements+1,'disconnect retires the native Clock owner once');
  assert.equal(disconnected,false,'connection retirement must await the native Clock acknowledgement');
  releaseClockRetirement();await disconnect;heldClockRetirement=null;

  assert.equal(controller.getSnapshot().session, null);
  assert.ok(controller.getCloudClient(), 'agent disconnect retains Cloud services');
  const bound = controller.getCloudClient();
  assert.equal(controller.rejectCloudSession('stale-session', { status: 401 }), false);
  assert.equal(controller.rejectCloudSession(bound.sessionId, { status: 401 }), true);
  assert.equal(controller.getCloudClient(), null);

  // Paired remote agent: connect, page more than one window, restore on reconnect, revoke.
  await controller.pair('remote','https://agent.example','REMOTE-CODE');
  assert.equal(controller.getSnapshot().error,'','remote pairing succeeds');
  assert.equal(controller.getSnapshot().kind,'remote');
  assert.equal(controller.getSnapshot().history,null,'nothing is restored before a conversation is chosen');
  await controller.listHistory();
  await controller.restoreHistory(remoteConversation);
  let history=controller.getSnapshot().history;
  assert.equal(history.messages.length,260,'older pages are read until hasMore is false');
  assert.equal(JSON.stringify(history.messages.map(item=>item.text)),JSON.stringify(remoteMessages.map(item=>item.text)),'pages join oldest first without duplicates');
  assert.equal(controller.getSnapshot().historyPartial,false);
  assert.deepEqual(remote.pages.map(page=>[page.before,page.beforeId,page.limit]),[[1060,remoteMessages[60].id,200]],'one keyset page covers the remaining 60 messages');
  const firstToken=remoteSaved.get('https://agent.example').token;
  // Reconnect (a fresh pairing on the same agent) restores the saved conversation automatically.
  await controller.disconnect();
  assert.equal(remote.deviceRevokes,1,'disconnect revokes the device enrollment');
  assert.equal(remote.logouts,1,'disconnect revokes the owner session');
  assert.match(controller.getSnapshot().message,/revoked on the agent/);
  assert.equal(remoteSaved.size,0,'local remote credential removed after revocation');
  assert.equal([...deviceSlots.keys()].filter(key=>key.startsWith('device:')).length,0,'device installation key deleted');
  const replay=await nativeRemoteRequest({url:'https://agent.example/api/auth/me',method:'GET',headers:{Authorization:`Bearer ${firstToken}`}});
  assert.equal(replay.status,401,'the old bearer is rejected after disconnect');
  remote.pages.length=0;
  await controller.pair('remote','https://agent.example','REMOTE-CODE');
  history=controller.getSnapshot().history;
  assert.equal(history?.automatic,true,'remote connect restores the saved conversation');
  assert.equal(history.messages.length,260);
  assert.equal(remote.pages.length,1);

  // Activity uses plain-language presentation, never operation JSON.
  actionEntries=[{id:'proposal-1',state:'reconciliation_required',operation:{type:'create_note',title:'Groceries',body:'Milk'},local:{status:'unknown',phase:'applying',applyingAt:Date.UTC(2026,9,8,15,30)}},{id:'proposal-2',state:'pending',operation:{type:'post_notification',title:'Digest',body:'Ready'}}];
  await controller.actionHistory();
  const presented=controller.getSnapshot().actionHistory;
  assert.equal(presented[0].title,'Create note');assert.match(presented[0].detail,/Groceries/);assert.ok(presented[0].timestamp,'local-time timestamp');
  assert.equal(presented[1].title,'Post notification');
  for(const entry of presented)assert.equal(entry.description.includes('{"type"'),false,'no operation JSON in Activity');
  await controller.rejectProposal('proposal-2');
  assert.equal(controller.getSnapshot().actionHistory.find(entry=>entry.id==='proposal-2').state,'rejected');
  await controller.reconcile('proposal-1',true);
  assert.deepEqual(reconciled,[['proposal-1','applied']]);

  // Stop on an agent without the turn-abort route: one later read shows the reply if it finished.
  const stop=new AbortController();
  const stopped=controller.send('Please finish anyway',{view:'home',revision:9,sensitive:false},'stop-request',stop.signal);
  const until=(check,label)=>new Promise((resolve,reject)=>{const deadline=Date.now()+10_000;const wait=()=>check()?resolve():Date.now()>deadline?reject(Error('Timed out: '+label)):setTimeout(wait,10);wait();});
  await until(()=>remote.held,'held send');
  stop.abort();await assert.rejects(stopped);
  assert.match(controller.getSnapshot().replyNotice,/may still finish/);
  remote.held();
  await until(()=>!/may still finish/.test(controller.getSnapshot().replyNotice),'stopped reply check');
  assert.equal(controller.getSnapshot().replyNotice,'','the single check found the finished reply');
  history=controller.getSnapshot().history;
  assert.equal(history.messages.at(-1).text,'Finished after Stop','the finished reply appears once');
  assert.equal(history.messages.filter(item=>item.text==='Finished after Stop').length,1);
  // Stop on an agent with upstream's turn-abort route: an explicit cancel, then one read.
  remote.abortRoute=true;
  const cancelStop=new AbortController();
  const cancelledSend=controller.send('Please stop this one',{view:'home',revision:10,sensitive:false},'stop-request-2',cancelStop.signal);
  await until(()=>remote.held,'second held send');
  cancelStop.abort();await assert.rejects(cancelledSend);
  await until(()=>remote.aborts.length===1,'explicit turn abort');
  assert.deepEqual(remote.aborts,[{reason:'client-stop'}]);
  await until(()=>controller.getSnapshot().message==='The agent stopped this reply.','cancelled reply check');
  assert.equal(controller.getSnapshot().replyNotice,'');
  assert.equal(remote.aborts.length,1,'Stop cancels exactly once and never repeats the turn');
  assert.equal(remoteMessages.filter(item=>item.text==='Finished after Stop').length,1,'no second turn ran');
  // A Stop before the message is posted is marked as never dispatched: no post, no cancel, no check.
  const sendsBefore=remote.sends,early=new AbortController();early.abort();
  const notSent=await controller.send('Never posted',{view:'home',revision:11,sensitive:false},'stop-request-3',early.signal).then(()=>null,error=>error);
  assert.equal(notSent?.notDispatched,true,'a failure before the post is marked so the composer keeps the text');
  assert.equal(remote.sends,sendsBefore,'nothing was posted');assert.equal(remote.aborts.length,1,'no cancel is sent for an unsent message');
  assert.equal(controller.getSnapshot().replyNotice,'','an unsent message schedules no reconciliation');
  // A refusal of the post itself is an unknown outcome: never marked as unsent, never repeated.
  remote.failPost=true;
  const unknown=await controller.send('Outcome unknown',{view:'home',revision:12,sensitive:false},'unknown-request',new AbortController().signal).then(()=>null,error=>error);
  assert.ok(unknown,'the refused post rejects');assert.equal(unknown.notDispatched,undefined,'a failure after dispatch is never reported as unsent');
  assert.equal(remote.failedPosts,1,'the refused post is not repeated');assert.equal(remote.sends,sendsBefore);
  // Cloud refusals in the pinned upstream reply shape reach the owner as specific, non-retrying copy.
  for(const [failure,expected] of [
    [{kind:'insufficient_credits',message:'Synthetic upstream text',transient:false},/^Eliza Cloud declined this AI request for your account's billing\. Check your account in Settings\. Alpha Phone did not retry your message, and nothing is purchased automatically\./],
    [{kind:'rate_limited',message:'Synthetic upstream text',transient:true},/^The AI request rate limit was reached\. Wait a moment before sending again\. Alpha Phone did not retry your message\.$/],
    [{kind:'rate_limited',message:'Synthetic upstream text',transient:true,rateLimit:{kind:'rate_limited',retryAfterMs:2400,planId:'synthetic',scope:'burst'}},/^The AI request rate limit was reached\. Try again in about 3 seconds\. Alpha Phone did not retry your message\.$/],
    [{kind:'provider_issue',message:'Synthetic upstream text',transient:true},/^Alpha’s AI service could not complete this reply\. Nothing was resent\.$/],
  ]){
    const before=remote.failureReplies||0;remote.failureReply=failure;
    const refused=await controller.send('Refused turn',{view:'home',revision:13,sensitive:false},'refused-'+failure.kind+(failure.rateLimit?'-live-wait':''),new AbortController().signal).then(()=>null,error=>error);
    assert.ok(refused,'a refused turn rejects: '+failure.kind);assert.match(refused.message,expected,failure.kind);
    assert.equal(remote.failureReplies,before+1,'the refused turn is posted once and never retried');
  }
  // Only a recognized, non-transient Calendar coverage refusal keeps its
  // one existing human reply. Unknown diagnostics and empty replies still fail.
  const calendarText="I couldn't confirm that Calendar request.";
  const calendarFailure={kind:'reply_generation_error',transient:false,code:'CALENDAR_READ_RECEIPT_MISMATCH',message:calendarText};
  const beforeCalendar=remote.failureReplies||0;
  remote.failureReply=calendarFailure;remote.failureText=calendarText;
  remote.failureMessageId='11111111-1111-4111-8111-111111111112';remote.failureUserMessageId='11111111-1111-4111-8111-111111111113';
  const kept=await controller.send('Calendar availability',{view:'calendar',revision:14,sensitive:false,timeZone:'America/Los_Angeles',calendarDay:{date:'2026-10-29',timeZone:'America/Los_Angeles'}},'calendar-failure',new AbortController().signal);
  assert.equal(JSON.stringify(remote.lastBody).includes('calendarDay'),false,'an unqualified remote peer receives no day in either wire projection');
  assert.equal(kept.text,calendarText);assert.equal(kept.messageId,remote.failureMessageId);
  assert.equal(kept.userMessageId,remote.failureUserMessageId);assert.equal(kept.messageBinding.conversationId,remoteConversation);
  assert.equal(kept.planAction,undefined);assert.deepEqual(Array.from(kept.proposals||[]),[]);
  assert.equal(remote.failureReplies,beforeCalendar+1,'semantic failure does not retry');
  remoteMessages.push({id:remote.failureMessageId,role:'assistant',text:calendarText,timestamp:2000,failureKind:calendarFailure.kind,terminalFailure:calendarFailure});
  await controller.restoreHistory(remoteConversation);
  const savedCalendar=controller.getSnapshot().history.messages.filter(row=>row.id===remote.failureMessageId);
  assert.equal(savedCalendar.length,1);assert.equal(savedCalendar[0].text,calendarText);
  assert.equal(remote.failureReplies,beforeCalendar+1,'restoring the saved refusal never resends it');
  for(const [code,transient,text] of [['UNKNOWN_CODE',false,calendarText],['CALENDAR_READ_RECEIPT_MISMATCH',true,calendarText],['CALENDAR_READ_RECEIPT_MISMATCH',false,'']]){
    remote.failureReply={...calendarFailure,code,transient};remote.failureText=text;
    await assert.rejects(controller.send('Refused Calendar',{view:'home',revision:15,sensitive:false},'refused-calendar-'+code+transient+text,new AbortController().signal),/could not complete/);
  }
  delete remote.failureText;delete remote.failureMessageId;delete remote.failureUserMessageId;
  await controller.disconnect();
  // Actual AlphaClient -> production controller -> LocalAgentProtocol JSON serialization.
  // Only the bridge is synthetic: no native operation, model or real host is started.
  const day={date:'2026-10-29',timeZone:'America/Los_Angeles'},calendar={view:'calendar',sensitive:false,timeZone:day.timeZone,calendarDay:day};
  const processA='11111111-1111-4111-8111-111111111111',processB='22222222-2222-8222-8222-222222222222';
  let processId=processA,statusReads=0,holdStatus=false,statusStarted,releaseStatus;const actualWires=[];
  const bridge={start:async()=>({}),request:async input=>{
    let value;
    if(input.path==='/api/auth/me')value={identity:{kind:'owner',id:user},access:{role:'OWNER',mode:'local'}};
    else if(input.path==='/api/agents')value={agents:[{id:agent,name:'Observation fixture',status:'running'}]};
    else if(input.path==='/api/status'){
      statusReads++;
      value={serverInstanceId:processId,clientTurnObservationSupport:{version:1,optionalFields:['calendarDay']}};
      if(holdStatus){statusStarted?.();value=await new Promise(resolve=>{releaseStatus=()=>resolve(value);});}
    }else if(input.path==='/api/conversations'&&input.method==='POST'){assert.deepEqual(JSON.parse(input.body),{title:'Alpha Phone'});value={conversation:{id:conversation,title:'Observation fixture'}};}
    else if(input.path==='/api/conversations')value={conversations:[{id:conversation,title:'Observation fixture'}]};
    else if(input.path.endsWith('/messages')&&input.method==='GET')value={messages:[]};
    else if(input.path.endsWith('/messages')&&input.method==='POST'){actualWires.push(JSON.parse(input.body));value={text:'Synthetic answer',agentName:'Observation fixture'};}
    else throw Error('Unexpected observation fixture route: '+input.path);
    return {status:200,body:JSON.stringify(value)};
  }};
  const local=new LocalAgentProtocol(bridge),alpha=new AlphaClient();
  const bind=async()=>{
    await local.connect(new AbortController().signal);sandbox.observationFixture.activate(local,1);
    alpha.attachVerifiedTransport({session:local.session,send:input=>controller.send(input.text,input.context,input.requestId,input.signal,input.onText,input.replyTo,input.onReplyReady,input.channelType??'DM',input.expectedConversationId,input.voiceTurnSignal).catch(error=>{console.error('Observation fixture controller rejection:',{name:error?.name,message:error?.message});throw error;}),execute:async()=>{throw Error('No effects in the observation fixture');}});
  };
  await bind();alpha.setViewContext(calendar);await alpha.send('Move my 3pm to 4');
  assert.equal(actualWires.at(-1).text,'Move my 3pm to 4');assert.equal((JSON.stringify(actualWires.at(-1)).match(/"calendarDay"/g)||[]).length,1);assert.deepEqual(actualWires.at(-1).metadata.clientDevice.context.calendarDay,day);
  assert.equal(Object.hasOwn(actualWires.at(-1).metadata,'alphaPhone'),false);assert.equal(statusReads,2,'one handshake and one fresh status check');
  const oldRevision=alpha.getState().context.revision;alpha.setViewContext({...calendar,calendarDay:{...day,date:'2026-10-30'}});assert.equal(alpha.getState().context.revision,oldRevision+1);
  holdStatus=true;const entered=new Promise(resolve=>{statusStarted=resolve;}),beforeStale=actualWires.length;
  const stale=alpha.send('Do not dispatch this stale day');const rejected=assert.rejects(stale);await entered;
  alpha.setViewContext({...calendar,calendarDay:{...day,date:'2026-10-31'}});holdStatus=false;releaseStatus();await rejected;
  assert.equal(actualWires.length,beforeStale,'date-only revision cancellation wins before message serialization');
  await bind();processId=processB;await alpha.send('Changed server stays ordinary');assert.equal(actualWires.at(-1).metadata.clientDevice.context.calendarDay,undefined);
  const afterMismatch=statusReads;await alpha.send('Never relearn this server under the old session');assert.equal(statusReads,afterMismatch);assert.equal(actualWires.at(-1).metadata.clientDevice.context.calendarDay,undefined);
  await bind();await alpha.send('A new verified binding may admit the new process');assert.deepEqual(actualWires.at(-1).metadata.clientDevice.context.calendarDay,{...day,date:'2026-10-31'});
  alpha.disconnect();await sandbox.observationFixture.retire();
  console.log('PASS: Cloud refusal reply shapes (insufficient_credits, rate_limited, provider_issue) map to owner copy without retry; real Cloud protocol/controller HTTP history membership, context stripping, action exclusion, next-send binding, current device timezone metadata and omission, separate service disconnect and scoped rejection; remote pairing, keyset history paging over 260 messages, restore on reconnect, device/session revocation with old-bearer 401, plain action presentation, reject/reconcile controller API, single Stop reconciliation and explicit turn abort. Synthetic only.');
} finally { server.closeAllConnections(); remoteServer.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => remoteServer.close(resolve)); }
