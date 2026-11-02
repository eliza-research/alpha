import {test,expect} from '@playwright/test';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';

// Production renderer and connection controller; native IPC and storage are controlled.
// No model, provider, real notification, or workflow execution is involved.
for(const scenario of ['ready','rejected','late','mock-ready','mock-retire-rejected'] as const){
 test(`resident background result binding: ${scenario}`,async({page},info)=>{
  await installResidentAgentPlugin(page);
  await page.addInitScript(scenario=>{
   const w=window as any;w.androidBridge={};
   localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
   const store=new Map();
   const f=w.deliveryFixture={configured:0,cancelled:0,disabled:[] as string[],nativeSync:0,foregroundSync:0,polling:true,enabled:false,notifications:false,events:[] as string[],input:null as any,release:null as any,holdRetire:false,retireRelease:null as any,mockHold:false,mockReleases:{} as Record<string,()=>void>,removed:[] as string[]};
   const agent=w.residentAgent=w.createResidentAgentPlugin({owner:()=>f.owner||'fixture-owner',agentId:'fixture-agent', providerStatus: {provider: 'elizacloud', configured: false}});
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'Agent',methods:agent.methods(['getStatus','start','request'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','cancel','addListener','removeListener','pauseNotificationCollection'])},
    {name:'AlphaActionJournal',methods:methods(['list'])},
    {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
    {name:'AlphaHostedResults',methods:methods(['beginBackground','cancelBackground','configureBackground','disableBackground','inboxHistory','syncInbox','status','setBackgroundPolling','enable','pendingResult','pendingSourceRenewal','addListener','removeListener'])},
   ],nativeCallback:agent.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='Agent'){
     const owned=agent.answer(method,input);if(owned)return owned;
     if(method==='getStatus')return {packaged:true,state:'ready'};
     if(method==='start')return {state:'ready'};
     if(method==='request'){
      const path=input.path;let body:any;
      if(path==='/api/auth/me')body={identity:{kind:'owner',id:'fixture-owner'},access:{role:'OWNER',mode:'session'}};
      else if(path==='/api/agents')body={agents:[{id:'fixture-agent',name:'Resident fixture',status:'running'}]};
      else if(path==='/api/client-devices/register')body={installationId:input.headers['X-Eliza-Device-Id'],enrollmentId:'fixture-enrollment',capabilities:[]};
      else if(path==='/api/conversations')body={conversations:[]};
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
     return {};
    }
    return {};
   }};
  },scenario);
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:/Agent connection/}).click();
  await page.getByRole('button',{name:'Start local agent',exact:true}).click();
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.configured)).toBe(1);
  const input=await page.evaluate(()=>(window as any).deliveryFixture.input);
  expect(input).toMatchObject({mode:'resident',origin:'https://device.alpha.invalid',ownerId:'fixture-owner',agentId:'fixture-agent'});
  expect(input).not.toHaveProperty('token');
  if(scenario==='mock-ready'||scenario==='mock-retire-rejected'){
   const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   await page.evaluate(()=>(window as any).deliveryFixture.mockHold=true);
   await page.getByRole('button',{name:/Agent connection/}).click();
   await page.locator('.alpha-connection-scrim summary').filter({hasText:/^Mock mode$/}).click();
   await page.getByRole('button',{name:'Enter mock mode',exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>Object.keys((window as any).deliveryFixture.mockReleases).sort())).toEqual(['notifications','scoped','unscoped']);
   const unentered=async()=>{
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!).kind)).toBe('resident');
    await expect(page).not.toHaveURL(/mode=mock/);
    await expect(page.getByText('Mock mode · simulated data and actions')).toHaveCount(0);
   };
   await unentered();
   await page.evaluate(()=>(window as any).deliveryFixture.mockReleases.unscoped());await unentered();
   await page.evaluate(()=>(window as any).deliveryFixture.mockReleases.notifications());await unentered();
   // Only the original active session retirement is still held here.
   expect(await page.evaluate(()=>(window as any).deliveryFixture.removed)).toEqual([]);
   await page.evaluate(()=>(window as any).deliveryFixture.mockReleases.scoped());
   if(scenario==='mock-retire-rejected'){
    await expect(page.getByText('Live background activity could not be paused. Retry before opening mock mode.',{exact:true})).toBeVisible();await unentered();
   }else{
    await expect(page).toHaveURL(/mode=mock/);
    await expect(page.getByText('Mock mode · simulated data and actions')).toBeVisible();
   }
   expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);expect(errors).toEqual([]);return;
  }
  if(scenario==='late'){
   await page.getByRole('button',{name:/Agent connection/}).click();
   await page.getByRole('button',{name:'Disconnect agent',exact:true}).click();
   await expect(page.getByText('Agent disconnected. Cloud services keep their separate sign-in.',{exact:true})).toBeVisible();
   await page.evaluate(()=>(window as any).deliveryFixture.release());
   await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.enabled)).toBe(false);
   expect(await page.evaluate(()=>(window as any).deliveryFixture.nativeSync)).toBe(0);
   return;
  }
  // Use the same shell command event as the scheduled-digest launcher.
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));
  const dialog=page.getByRole('dialog',{name:'Scheduled digests',exact:true});
  await expect(dialog).toContainText('It cannot run while the phone is off.');
  await expect(dialog.getByText('Synced with this agent.',{exact:true})).toBeVisible();
  if(scenario==='ready'){
   await expect(dialog.getByRole('button',{name:'Pause background checks',exact:true})).toBeVisible();
   await dialog.getByRole('button',{name:'Pause background checks',exact:true}).click();
   await expect(dialog.getByRole('button',{name:'Enable background checks',exact:true})).toBeVisible();
   await dialog.getByRole('button',{name:'Notification settings',exact:true}).click();
   await expect(dialog.getByText('Result notifications are enabled.',{exact:true})).toBeVisible();
   const counts=await page.evaluate(()=>(window as any).deliveryFixture);
   expect(counts.nativeSync).toBeGreaterThan(0);expect(counts.foregroundSync).toBe(0);
  }else{
   await expect(dialog.getByText(/Background delivery could not be verified/)).toBeVisible();
   await expect(dialog.getByRole('button',{name:'Notification settings',exact:true})).toHaveCount(0);
   const counts=await page.evaluate(()=>(window as any).deliveryFixture);
   expect(counts.nativeSync).toBe(0);expect(counts.foregroundSync).toBeGreaterThan(0);
   expect(counts.events.indexOf('cancel')).toBeLessThan(counts.events.indexOf('foreground'));
  }
  await page.screenshot({path:info.outputPath('digest-binding.png')});
  if(scenario==='ready'){
   await dialog.getByRole('button',{name:'Close scheduled digests',exact:true}).click();
   await page.evaluate(()=>{(window as any).deliveryFixture.holdRetire=true;});
   await page.getByRole('button',{name:/Agent connection/}).click();
   await page.getByRole('button',{name:'Disconnect agent',exact:true}).click();
   await expect(page.getByText('Disconnecting…',{exact:true})).toBeVisible();
   await expect(page.getByText('Agent disconnected. Cloud services keep their separate sign-in.',{exact:true})).toHaveCount(0);
   await expect.poll(()=>page.evaluate(()=>typeof (window as any).deliveryFixture.retireRelease)).toBe('function');
   await page.evaluate(()=>(window as any).deliveryFixture.retireRelease());
   await expect(page.getByText('Agent disconnected. Cloud services keep their separate sign-in.',{exact:true})).toBeVisible();
  }
 });
}
