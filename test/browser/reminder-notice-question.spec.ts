import {test,expect} from '@playwright/test';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';
for(const mode of ['compose','cancel','source-changed','owner-changed'] as const)test('reminder Ask review '+mode,async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await installResidentAgentPlugin(page);
  await page.addInitScript(scenario=>{
   const w=window as any;w.androidBridge={};
   localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
   const store=new Map();
   const f=w.deliveryFixture={configured:0,cancelled:0,disabled:[] as string[],nativeSync:0,foregroundSync:0,polling:true,enabled:false,notifications:false,events:[] as string[],input:null as any,release:null as any,holdRetire:false,retireRelease:null as any,mockHold:false,mockReleases:{} as Record<string,()=>void>,removed:[] as string[]};
   const agent=w.residentAgent=w.createResidentAgentPlugin({owner:()=>f.owner||'fixture-owner',agentId:'fixture-agent', providerStatus: {provider: 'elizacloud', configured: false}});
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[
    {name:'DailyApps',methods:methods(['surfaceInfo','listReminders','pendingReminderTap','consumeReminderTap','releaseReminderQuestion','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','pendingWorkflowTap','consumeWorkflowTap','addListener','removeListener'])},
    {name:'Agent',methods:agent.methods(['getStatus','start','request'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','cancel','addListener','removeListener','pauseNotificationCollection'])},
    {name:'AlphaActionJournal',methods:methods(['list'])},
    {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
    {name:'AlphaHostedResults',methods:methods(['beginBackground','cancelBackground','configureBackground','disableBackground','inboxHistory','syncInbox','status','setBackgroundPolling','enable','pendingResult','withdrawOtherOwnerApprovalNotices','addListener','removeListener'])},
   ],nativeCallback:agent.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
    if(plugin==='DailyApps'){
     if(method==='surfaceInfo')return {developmentBuild:true,reminderTapVersion:1};
     if(method==='pendingReminderTap')return f.reminderTap||{};
     if(method==='listReminders')return {reminders:f.reminder?[f.reminder]:[]};
     if(method==='consumeReminderTap'){if(input.token!==f.reminderTap?.token)throw Error('changed');f.consumed=(f.consumed||0)+1;f.reminderTap={};return {};}
     if(method==='releaseReminderQuestion'){f.released=(f.released||0)+1;f.savedTap=f.reminderTap;f.reminderTap={};return {};}
     return {};
    }
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='AlphaNotifications'){
     if(method==='status'||method==='crossAppStatus')return {permissionGranted:true,appEnabled:true};
     if(method==='pendingWorkflowTap'){f.pendingReads=(f.pendingReads||0)+1;return f.taps?.[0]||{};}
     if(method==='consumeWorkflowTap'&&input.discard){f.discarded=(f.discarded||[]);if(f.taps[0]?.token!==input.token||!f.taps[0]?.question)throw Error('Changed');f.discarded.push(input.token);f.taps.shift();return {};}
     if(method==='consumeWorkflowTap'){f.consumed=(f.consumed||[]);if(f.taps[0]?.token!==input.token)throw Error('Changed');f.consumed.push(input.token);f.taps.shift();return {};}
     return {};
    }
    if(plugin==='Agent'){
     const owned=agent.answer(method,input);if(owned)return owned;
     if(method==='getStatus')return {packaged:true,state:'ready'};
     if(method==='start')return {state:'ready'};
     if(method==='request'){
      const path=input.path;let body:any;
      if(input.method==='POST'&&path.startsWith('/api/workflow/'))throw Error('Unexpected effect');
      if(path.startsWith('/api/workflow/executions/')){f.reads=(f.reads||0)+1;if(f.queueChanged){f.taps.reverse();f.queueChanged=false;}if(f.hold)await new Promise(r=>f.release=r);body={execution:{id:path.split('/').at(-1),workflowId:'flow',workflowVersionId:f.wrongVersion?'v2':'v1',status:'completed',finished:true,startedAt:'2026-10-01T12:00:00Z',output:'Verified retained result '+path.split('/').at(-1),events:[]}};return {status:200,body:JSON.stringify(body)};}
      if(path==='/api/workflow/workflows/flow')return {status:200,body:JSON.stringify({id:'flow',name:'Notice workflow',versionId:'v1',active:false,steps:[]})};

      if(path==='/api/auth/me')body={identity:{kind:'owner',id:f.owner||'fixture-owner'},access:{role:'OWNER',mode:'session'}};
      else if(path==='/api/agents')body={agents:[{id:'fixture-agent',name:'Resident fixture',status:'running'}]};
      else if(path==='/api/client-devices/register')body={installationId:input.headers['X-Eliza-Device-Id'],enrollmentId:'fixture-enrollment',capabilities:[]};
      else if(path==='/api/conversations')body={conversations:[]};
      else if(path==='/api/automations')body={automations:[]};
      else if(path==='/api/lifeops/reminders')body={reminders:[]};
      else if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')body={tasks:[]};
      else if(path==='/api/workflow/status')body={hostedDigestProtocol:1};
      else if(path==='/api/workflow/hosted/sources')body={sources:[]};
      else if(path==='/api/workflow/hosted/loops')body={loops:[]};
      else if(path==='/api/workflow/hosted/live-accounts')body={accounts:[]};
      else if(path.startsWith('/api/workflow/hosted/results?')){f.foregroundSync++;f.events.push('foreground');body={entries:[]};}
      else return {status:404,body:'{}'};
      return {status:200,body:JSON.stringify(body)};
     }
    }
    if(plugin==='AlphaConnection'){
     if(method==='secureRead')return {value:store.get(input.slot)??null};
     if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
     if(method==='secureWrite'){store.set(input.slot,input.value);return {};}
     if(method==='secureRemove'){f.removed.push(input.slot);store.delete(input.slot);return {};}
     if(method==='pauseNotificationCollection'&&f.mockHold){await new Promise<void>(resolve=>{f.mockReleases.notifications=resolve;});return {};}
     return {};
    }
    if(plugin==='AlphaActionJournal')return {entries:[]};
    if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher:false,version:'fixture'};
    if(plugin==='AlphaHostedResults'){
     if(method==='configureBackground'){
      f.configured++;f.input=input;
      if(scenario==='rejected')throw Error('Synthetic verification failure');
      if(scenario==='late')await new Promise(resolve=>{f.release=resolve;});
      f.enabled=true;return {generation:'fixture-generation',scope:'a'.repeat(64)};
     }
     if(method==='cancelBackground'){f.cancelled++;f.enabled=false;f.events.push('cancel');return {};}
     if(method==='disableBackground'){f.disabled.push(input?.sessionId);if(f.mockHold){const kind=input?.sessionId?'scoped':'unscoped';await new Promise<void>(resolve=>{f.mockReleases[kind]=resolve;});if(kind==='scoped'&&scenario==='mock-retire-rejected')throw Error('Synthetic session retirement rejection');}if(f.holdRetire)await new Promise(resolve=>{f.retireRelease=resolve;});f.enabled=false;return {};}
     if(method==='inboxHistory'||method==='syncInbox'){if(method==='syncInbox')f.nativeSync++;return {entries:[]};}
     if(method==='status')return {enabled:f.notifications,backgroundEnabled:f.enabled&&f.polling};
     if(method==='setBackgroundPolling'){f.polling=input.enabled;return {backgroundEnabled:f.enabled&&f.polling};}
     if(method==='enable'){f.notifications=true;return {enabled:true};}
     // The native notice ledger receives the complete owner fence, or null while offline.
     if(method==='withdrawOtherOwnerApprovalNotices'){f.ownerWithdrawals=(f.ownerWithdrawals||[]);f.ownerWithdrawals.push(input);if(w.__ownerWithdrawalFault&&f.ownerWithdrawals.length===1)throw Error('Synthetic withdrawal failure');return {withdrawn:0};}
     return {};
    }
    return {};
   }};
  },'ready');
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/Agent connection/}).click();await page.getByRole('button',{name:'Start local agent',exact:true}).click();await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await page.evaluate(()=>{const f=(window as any).deliveryFixture,target={sourceId:'local-source',sourceRevision:'a'.repeat(64),reminderId:'reminder',occurrenceId:'one',revision:'b'.repeat(64),timingVersion:2};f.reminder={id:'reminder',title:'Reviewable reminder',body:'Public meeting plan',at:Date.now(),dueAt:Date.now(),alertMinutes:0,status:'posted',occurrenceId:'one',target};f.reminderTap={token:'ask-token',target,retained:true,question:true};document.dispatchEvent(new Event('visibilitychange'));});
 const review=page.getByRole('dialog',{name:'Ask about selected content'});await expect(review).toBeVisible();await expect(review.getByRole('textbox',{name:'Content excerpt'})).toHaveValue('Reviewable reminder\nPublic meeting plan');
 if(mode==='compose')await page.screenshot({path:testInfo.outputPath('question-review.png')});
 if(mode==='cancel'){await review.getByRole('button',{name:'Cancel',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.released)).toBe(1);expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||0)).toBe(0);await page.evaluate(()=>{const f=(window as any).deliveryFixture;f.reminderTap=f.savedTap;document.dispatchEvent(new Event('visibilitychange'));});await expect(review).toBeVisible();}
 else{
  if(mode==='source-changed')await page.evaluate(()=>{(window as any).deliveryFixture.reminderTap.retained=false;});
  if(mode==='owner-changed')await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;await c.disconnect();});
  if(mode!=='owner-changed')await review.getByRole('button',{name:'Use in conversation',exact:true}).click();
  if(mode==='compose'){await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue(/Reviewable reminder/);expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed)).toBe(1);}
  else expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||0)).toBe(0);
 }
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);expect(errors).toEqual([]);
});
