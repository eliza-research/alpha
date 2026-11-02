import {newWorkflow} from './workflow-navigation';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';
import {test,expect} from '@playwright/test';
const ownerFence=(ownerId:string)=>({owner:{origin:'https://device.alpha.invalid',ownerId,agentId:'fixture-agent'}});
// Production renderer and authenticated connection; controlled transport/native queue, no real notification.
for(const scenario of ['lookup-unavailable','lookup-unavailable-navigation','ask','ask-cancel','ask-changed','ask-owner','ask-sensitive','two','other-owner','wrong-version','unconfirmed','navigation-race','owner-race','reconnect','owner-change','queue-changed','builder-race','new-tap-during-read'] as const){
 test('scoped native workflow tap '+scenario,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await installResidentAgentPlugin(page);
  await page.addInitScript(scenario=>{
   const w=window as any;w.androidBridge={};
   localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
   const store=new Map();
   const f=w.deliveryFixture={configured:0,cancelled:0,disabled:[] as string[],nativeSync:0,foregroundSync:0,polling:true,enabled:false,notifications:false,events:[] as string[],input:null as any,release:null as any,holdRetire:false,retireRelease:null as any,mockHold:false,mockReleases:{} as Record<string,()=>void>,removed:[] as string[]};
   const agent=w.residentAgent=w.createResidentAgentPlugin({owner:()=>f.owner||'fixture-owner',agentId:'fixture-agent', providerStatus: {provider: 'elizacloud', configured: false}});
   if(scenario.startsWith('lookup-unavailable')){
    f.lookupUnavailable=true;f.lookupFailures=0;f.noticeToasts=[];
    new MutationObserver(()=>{const shown=document.body?.innerText.match(/Workflow notifications? (?:retained|could not be checked)[^\n]*/)?.[0];if(shown&&!f.noticeToasts.includes(shown))f.noticeToasts.push(shown);}).observe(document,{subtree:true,childList:true,characterData:true});
   }
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','pendingWorkflowTap','consumeWorkflowTap','addListener','removeListener'])},
    {name:'Agent',methods:agent.methods(['getStatus','start','request'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','cancel','addListener','removeListener','pauseNotificationCollection'])},
    {name:'AlphaActionJournal',methods:methods(['list'])},
    {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
    {name:'AlphaHostedResults',methods:methods(['beginBackground','cancelBackground','configureBackground','disableBackground','inboxHistory','syncInbox','status','setBackgroundPolling','enable','pendingResult','withdrawOtherOwnerApprovalNotices','addListener','removeListener'])},
   ],nativeCallback:agent.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='AlphaNotifications'){
     if(method==='status'||method==='crossAppStatus')return {permissionGranted:true,appEnabled:true};
     if(method==='pendingWorkflowTap'){f.pendingReads=(f.pendingReads||0)+1;if(f.holdLookup)await new Promise<void>(resolve=>f.lookupRelease=resolve);if(f.lookupUnavailable){f.lookupFailures++;throw Error('Activity inactive');}return f.taps?.[0]||{};}
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
      else if(path==='/api/workflow/status'){f.workflowStatusReads=(f.workflowStatusReads||0)+1;body={hostedDigestProtocol:1};}
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
  },scenario);
 // One scenario fails the first owner-change withdrawal, which the next connection change repeats.
 await page.addInitScript(fault=>{(window as any).__ownerWithdrawalFault=fault;},scenario==='reconnect');

 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/Agent connection/}).click();await page.getByRole('button',{name:'Start local agent',exact:true}).click();await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 if(scenario==='builder-race'){await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await page.getByRole('button',{name:'Workflows',exact:true}).click();}
 await page.evaluate(async(scenario)=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const s=c.getSnapshot().session!,b=c.getWorkflowClient()!,f=(window as any).deliveryFixture;
  const tap=(id:string)=>({scope:b.scope,origin:s.origin,ownerId:s.ownerId,agentId:s.agentId,workflowId:'flow',runId:id,versionId:'v1',token:id,operationId:'operation-'+id,bindingHash:'b'.repeat(64),retained:true});
  f.pendingReads=0;f.taps=scenario==='two'?[tap('run1')]:[tap('run1'),tap('run2')];f.second=tap('run2');if(scenario==='other-owner')f.taps[0].ownerId='another-owner';if(scenario==='wrong-version')f.wrongVersion=true;if(scenario==='queue-changed')f.queueChanged=true;if(scenario==='unconfirmed')f.taps[0].retained=false;if(['navigation-race','owner-race','reconnect','owner-change','builder-race','new-tap-during-read'].includes(scenario))f.hold=true;
  if(scenario.startsWith('ask')){f.taps=[{...tap('run1'),question:true,notice:{id:'notice1',revision:'revision1',source:'own',appLabel:'Alpha Phone',title:'Completed task',text:'Public result text'}}];}
  document.dispatchEvent(new Event('visibilitychange'));
 },scenario);
 if(scenario.startsWith('lookup-unavailable')){
  await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.lookupFailures)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).deliveryFixture.noticeToasts)).toEqual([]);
  expect(await page.evaluate(()=>({reads:(window as any).deliveryFixture.reads||0,consumed:(window as any).deliveryFixture.consumed||[]}))).toEqual({reads:0,consumed:[]});
  await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await page.getByRole('button',{name:'Workflows',exact:true}).click();
  // A user retry queued during a resume lookup keeps its feedback, even if another resume arrives.
  await page.evaluate(()=>{const f=(window as any).deliveryFixture;f.holdLookup=true;document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).deliveryFixture.lookupRelease))).toBe(true);
  await page.getByRole('button',{name:/^Saved workflow notification/}).click();
  if(scenario==='lookup-unavailable-navigation'){
   const statusReads=await page.evaluate(()=>{const before=(window as any).deliveryFixture.workflowStatusReads||0;window.dispatchEvent(new Event('launcher-home'));return before;});
   await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.workflowStatusReads||0)).toBeGreaterThan(statusReads);
   await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
   const failures=await page.evaluate(()=>{const f=(window as any).deliveryFixture,before=f.lookupFailures;f.holdLookup=false;f.lookupRelease();return before;});
   await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.lookupFailures)).toBeGreaterThanOrEqual(failures+2);
   expect(await page.evaluate(()=>(window as any).deliveryFixture.noticeToasts)).toEqual([]);
   expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||[])).toEqual([]);
   await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
   await page.getByRole('button',{name:'Workflows',exact:true}).click();
   await page.getByRole('button',{name:/^Saved workflow notification/}).click();
  }else await page.evaluate(()=>{const f=(window as any).deliveryFixture;document.dispatchEvent(new Event('visibilitychange'));f.holdLookup=false;f.lookupRelease();});
  const message='Workflow notifications could not be checked. Try again when Alpha is active.';
  await expect(page.getByText(message,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).deliveryFixture.noticeToasts)).toEqual([message]);
  expect(await page.evaluate(()=>(window as any).deliveryFixture.taps.map((tap:any)=>tap.runId))).toEqual(['run1','run2']);
  await page.evaluate(()=>{(window as any).deliveryFixture.lookupUnavailable=false;document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByText('Verified retained result run1',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.consumed||[])).toEqual(['run1']);
 }else if(scenario.startsWith('ask')){
  const review=page.getByRole('dialog',{name:'Ask about selected content'});
  await expect(review.getByRole('textbox',{name:'Content excerpt'})).toHaveValue('Completed task\nPublic result text');
  expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||[])).toEqual([]);
  if(scenario==='ask-cancel'){
   await review.getByRole('button',{name:'Cancel',exact:true}).click();await expect(review).toHaveCount(0);
   // Cancel is the user's decision: the tap is settled natively and the review does not reopen on return.
   await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.discarded||[])).toEqual(['run1']);
   const reads=await page.evaluate(()=>{const f=(window as any).deliveryFixture,before=f.pendingReads;document.dispatchEvent(new Event('visibilitychange'));return before;});
   await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.pendingReads)).toBeGreaterThan(reads);
   await expect(review).toHaveCount(0);
  }
  else if(scenario==='ask-owner'){await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.offline();});await expect(review).toHaveCount(0);}
  else {
   if(scenario==='ask-sensitive'){await review.getByRole('textbox',{name:'Content excerpt'}).fill('Your verification code is 123456');await review.getByRole('button',{name:'Use in conversation',exact:true}).click();await expect(review.getByRole('status')).toContainText('credentials or verification codes');await review.getByRole('button',{name:'Cancel',exact:true}).click();}
   else {
    await review.getByRole('textbox',{name:'Content excerpt'}).fill('Reviewed public text');
    if(scenario==='ask-changed')await page.evaluate(()=>{(window as any).deliveryFixture.taps[0].notice.text='Replaced text';});
    await review.getByRole('button',{name:'Use in conversation',exact:true}).click();
    if(scenario==='ask'){await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Help me with this notification.\n\nSource: Alpha Phone notification\n\nReviewed public text');await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.consumed||[])).toEqual(['run1']);}
    else await expect(page.getByText('This notification or account changed. Nothing was added to your conversation.',{exact:true})).toBeVisible();
   }
  }
  if(scenario!=='ask')expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||[])).toEqual([]);
  if(scenario==='ask-sensitive')await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.discarded||[])).toEqual(['run1']);
  if(scenario==='ask-owner')expect(await page.evaluate(()=>(window as any).deliveryFixture.discarded||[])).toEqual([]);
 }else if(scenario==='two'){
  await expect(page.getByText('Verified retained result run1',{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.consumed?.length)).toBe(1);
  await page.evaluate(()=>{const f=(window as any).deliveryFixture;f.taps.push(f.second);document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByText('Verified retained result run2',{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.consumed?.length)).toBe(2);
 }else if(scenario==='new-tap-during-read'){
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).deliveryFixture.release))).toBe(true);
  await page.evaluate(()=>{const f=(window as any).deliveryFixture;f.taps.reverse();f.hold=false;document.dispatchEvent(new Event('visibilitychange'));f.release();});
  await expect(page.getByText('Verified retained result run2',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>({ids:(window as any).deliveryFixture.taps.map((t:any)=>t.runId),consumed:(window as any).deliveryFixture.consumed||[]}))).toEqual({ids:['run1'],consumed:['run2']});
 }else if(scenario==='queue-changed'){
  await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.pendingReads)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(()=>({ids:(window as any).deliveryFixture.taps.map((t:any)=>t.runId),consumed:(window as any).deliveryFixture.consumed||[]}))).toEqual({ids:['run2','run1'],consumed:[]});
  await expect(page.getByText('Verified retained result run1',{exact:true})).toHaveCount(0);
 }else if(scenario==='builder-race'){
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).deliveryFixture.release))).toBe(true);
  await newWorkflow(page);
  await page.evaluate(()=>(window as any).deliveryFixture.release());
  await expect(page.getByText('Verified retained result run1',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed?.length||0)).toBe(0);
  await expect(page.getByRole('button',{name:'Back to workflows',exact:true})).toBeVisible();
 }else if(scenario==='owner-race'||scenario==='reconnect'){
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).deliveryFixture.release))).toBe(true);
  await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.offline();(window as any).deliveryFixture.release();(window as any).deliveryFixture.hold=false;});
  await expect(page.getByText('Verified retained result run1',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed?.length||0)).toBe(0);
  if(scenario==='reconnect'){
   await page.getByRole('button',{name:/Agent connection/}).click();await page.getByRole('button',{name:'Start local agent',exact:true}).click();await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
   await expect(page.getByText('Verified retained result run1',{exact:true})).toBeVisible();
  }
 }else if(scenario==='owner-change'){
  // The first owner's read is still in flight when the session ends; a different owner then connects.
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).deliveryFixture.release))).toBe(true);
  await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.offline();const w=window as any,f=w.deliveryFixture;f.release();f.hold=false;f.owner='next-owner';
   // The toast is transient; record every notice text shown from here on.
   w.__noticeToasts=[];new MutationObserver(()=>{const shown=document.body.innerText.match(/Workflow notification saved\.[^\n]*/)?.[0];if(shown&&!w.__noticeToasts.includes(shown))w.__noticeToasts.push(shown);}).observe(document.body,{subtree:true,childList:true,characterData:true});});
  // Going offline suspends prior-owner notices before another owner may connect.
  await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.ownerWithdrawals)).toEqual([{owner:null},ownerFence('fixture-owner'),{owner:null}]);
  await page.getByRole('button',{name:/Agent connection/}).click();await page.getByRole('button',{name:'Start local agent',exact:true}).click();await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  expect(await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().session?.ownerId)).toBe('next-owner');
  // The first owner's retained tap never opens under the next owner, and nothing is consumed.
  await expect.poll(()=>page.evaluate(()=>(window as any).__noticeToasts)).toEqual(['Workflow notification saved. Connect its original agent to open it.']);
  await expect(page.getByText('Verified retained result run1',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>({taps:(window as any).deliveryFixture.taps.length,consumed:(window as any).deliveryFixture.consumed?.length||0}))).toEqual({taps:2,consumed:0});
 }else if(scenario==='navigation-race'){
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).deliveryFixture.release))).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
  await page.evaluate(()=>(window as any).deliveryFixture.release());
  await expect(page.getByText('Verified retained result run1',{exact:true})).toHaveCount(0);
 }else{
  await expect(page.getByText(/Workflow notification saved\./)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).deliveryFixture.taps.length)).toBe(2);
  expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed?.length||0)).toBe(0);
 }
 // Every transition carries origin, owner and agent; offline explicitly suspends notices.
 const transitions:Array<{owner:null|{origin:string;ownerId:string;agentId:string}}>=[{owner:null},...(scenario==='reconnect'?[{owner:null}]:[]),ownerFence('fixture-owner')];
 if(['owner-race','reconnect','owner-change','ask-owner'].includes(scenario))transitions.push({owner:null});
 if(scenario==='reconnect')transitions.push(ownerFence('fixture-owner'));
 if(scenario==='owner-change')transitions.push(ownerFence('next-owner'));
 await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.ownerWithdrawals||[])).toEqual(transitions);
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);expect(errors).toEqual([]);
 });
}
