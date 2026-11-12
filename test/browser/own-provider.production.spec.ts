import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {expect, test, type Page} from '@playwright/test';
import {completeAccessSetup, expectNoDevelopmentSurface, fenceNetwork, flagOffAndroid, residentHome} from './flag-off-android';

// The flag-off bundle and its real connection/controller UI run against the existing native
// fixture. The extra methods model native request leases and return only public provider status.
// No provider keys, account login, microphone, network provider, or Android device are real.
const AI_KEY='synthetic-own-cerebras-ui-key';
const VOICE_KEY='synthetic-own-cartesia-ui-key';
const DATA_KEY='own-provider-ui-existing-data';
async function fixture(page:Page, signedOut=false, freshAccess=false,nativeEmail=false){
 const logs:string[]=[];page.on('console',message=>logs.push(message.text()));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const foreign=await fenceNetwork(page);await flagOffAndroid(page,{freshAccess});
 await page.addInitScript(({signedOut,dataKey,nativeEmail})=>{
  const w=window as any,base=w.Capacitor.nativePromise;
  const leases=new Set<string>();let mode:'cloud'|'own'='cloud',revision=crypto.randomUUID(),unbound=false;const keys:{text?:string;voice?:string}={};
  // reject: true refuses the key; 'echo' refuses it with a message that repeats most of the entered key.
  // holdReply holds the next chat reply until releaseReply(): the turn is dispatched, nothing has streamed yet.
  const f=w.ownProvider={events:[] as string[],saved:0,edited:0,removed:0,revealed:0,selected:0,cancelled:0,cleared:0,checks:0,hold:false,reject:false as boolean|'echo',pending:false,release:null as null|(()=>void),matched:false,holdCloudRead:false,cloudReadPending:false,cloudReadCompletions:0,releaseCloudRead:null as null|(()=>void),emailStarts:0,emailVerifications:0,holdVerify:false,verifyPending:false,releaseVerify:null as null|(()=>void),startFail:false,startHold:false,startRelease:null as null|(()=>void),starting:false,holdReply:false,replyHeld:false,releaseReply:null as null|(()=>void),holdSelect:false,selectPending:false,releaseSelect:null as null|(()=>void)};
  localStorage.setItem(dataKey,'existing local app data');
  if(signedOut){delete w.flagOff.slots['cloud:production'];w.flagOff.persist();}
  const status=async()=>{const cloud=await base('Agent','providerStatus',{});return {
   mode,revision,persistence:'native-secure-store',keys:{text:{configured:!!keys.text},voice:{configured:!!keys.voice}},
   provider:mode==='own'?'cerebras':'elizacloud',configured:!unbound&&(mode==='own'?!!keys.text:cloud.configured===true),selected:!unbound&&(mode==='own'||cloud.configured===true),
   model:mode==='own'?'qwen-3.8-27b':'cerebras/qwen-3.8-27b',voiceConfigured:!unbound&&mode==='own'&&!!keys.voice,
  };};
  const current=(input:any)=>{if(!leases.has(input.requestId)||input.expectedRevision!==revision)throw Error('Provider request changed');};
  const committed=(input:any)=>{leases.delete(input.requestId);revision=crypto.randomUUID();};
  w.Capacitor.PluginHeaders.find((p:any)=>p.name==='AlphaNotifications').methods.push({name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'});
  // The chat-only image confirms its wake listener is off at startup.
  if(!w.Capacitor.PluginHeaders.some((p:any)=>p.name==='ElizaSense'))w.Capacitor.PluginHeaders.push({name:'ElizaSense',methods:[{name:'turnOff',rtype:'promise'},{name:'status',rtype:'promise'}]});
  // A provider change retires the running agent's background delivery before restarting it.
  if(!w.Capacitor.PluginHeaders.some((p:any)=>p.name==='AlphaHostedResults'))w.Capacitor.PluginHeaders.push({name:'AlphaHostedResults',methods:[{name:'disableBackground',rtype:'promise'},{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]});
  w.Capacitor.PluginHeaders.find((p:any)=>p.name==='Agent').methods.push(...['prepareProviderConfiguration','configureProvider','cancelProviderConfiguration','selectProvider','editProviderKeys','removeProviderKey','revealProviderKey'].map(name=>({name,rtype:'promise'})));
  if(nativeEmail)w.Capacitor.PluginHeaders.push({name:'AlphaCloudSignIn',methods:['status','startEmail','verifyEmail','cancel','addListener','removeListener'].map(name=>({name,rtype:'promise'}))});
  w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaConnection'&&method==='secureRead'&&input.slot==='cloud:production'&&f.holdCloudRead){
    f.holdCloudRead=false;const result=await base(plugin,method,input);f.cloudReadPending=true;
    await new Promise<void>(resolve=>f.releaseCloudRead=resolve);f.cloudReadPending=false;f.cloudReadCompletions++;return result;
   }
   if(nativeEmail&&plugin==='AlphaCloudSignIn'){
    w.flagOff.calls.push(plugin+'.'+method);
    if(method==='status')return {active:false,inApp:true,email:true,google:false};
    if(method==='addListener'||method==='removeListener'||method==='cancel')return {};
    if(method==='startEmail'){if(input.email!=='provider-switch@example.invalid')throw Error('Unexpected synthetic email');f.emailStarts++;return {attemptId:'33333333-3333-4333-8333-333333333333',expiresAt:Date.now()+600000,resendAt:Date.now()+60000};}
    if(method==='verifyEmail'){
     if(input.code!=='123456')throw Error('Invalid synthetic code');
     if(f.holdVerify){f.verifyPending=true;await new Promise<void>(resolve=>f.releaseVerify=resolve);f.verifyPending=false;}
     const credential={credentialId:crypto.randomUUID(),token:'synthetic-own-cloud-signin-key',expiresAt:Date.now()+86400000};
     await base('AlphaConnection','secureWrite',{slot:'cloud:production',value:JSON.stringify(credential)});
     revision=crypto.randomUUID();leases.clear();f.emailVerifications++;f.events.push('auth-verified');
     return {status:'authenticated',environment:'production',expiresAt:credential.expiresAt};
    }
    throw Error('Unexpected synthetic sign-in method');
   }
   if(plugin==='AlphaHostedResults'&&method==='disableBackground')return {};
   if(plugin==='ElizaSense')return {available:true,state:'OFF',label:'Listening off',consented:false,listening:false,microphoneOpen:false};
   if(plugin!=='Agent')return base(plugin,method,input);
   // The agent restart after a provider change: held, or refused, when a test asks.
   if(method==='start'&&f.startHold){f.starting=true;await new Promise<void>(resolve=>f.startRelease=resolve);f.starting=false;}
   if(method==='start'&&f.startFail)throw Error('Local agent failed to start.');
   if(method==='requestStream'&&f.holdReply){f.holdReply=false;f.replyHeld=true;await new Promise<void>(resolve=>f.releaseReply=resolve);f.replyHeld=false;}
   if(method==='providerStatus'){f.checks++;return status();}
   if(method==='prepareProviderConfiguration'){const id=crypto.randomUUID();leases.clear();leases.add(id);f.events.push('reserve');return {requestId:id};}
   if(method==='cancelProviderConfiguration'){leases.delete(input.requestId);f.cancelled++;f.events.push('cancel');return {};}
   if(method==='configureProvider'){
    f.events.push('configure');if(!leases.has(input.requestId))throw Error('Provider request cancelled');const admittedRevision=revision;
    f.matched=input.apiKey==='synthetic-own-cerebras-ui-key'&&input.cartesiaKey==='synthetic-own-cartesia-ui-key'&&input.model==='qwen-3.8-27b';
    if(f.hold){f.pending=true;await new Promise<void>(resolve=>f.release=resolve);f.pending=false;}
    if(!leases.has(input.requestId)||revision!==admittedRevision)throw Error('Provider request cancelled');
    if(f.reject)throw Error(f.reject==='echo'?`Cerebras did not accept key ${input.apiKey.slice(1,-1)} for this account.`:'Cerebras did not accept this key. It was not saved.');
    leases.delete(input.requestId);keys.text=input.apiKey;if(input.cartesiaKey!==undefined)keys.voice=input.cartesiaKey;mode='own';unbound=false;revision=crypto.randomUUID();f.saved++;return status();
   }
   if(method==='selectProvider'){
    current(input);if(input.mode!=='cloud'&&input.mode!=='own')throw Error('Invalid provider mode');
    if(input.mode==='own'&&!keys.text)throw Error('Save a Text key first');
    if(input.mode==='cloud'&&!w.flagOff.slots['cloud:production'])throw Error('Sign in to Cloud first');
    if(f.holdSelect){f.selectPending=true;await new Promise<void>(resolve=>f.releaseSelect=resolve);f.selectPending=false;current(input);}
    mode=input.mode;unbound=false;committed(input);f.selected++;f.events.push('select:'+mode);return status();
   }
   if(method==='editProviderKeys'){
    current(input);if(input.textKey===undefined&&input.voiceKey===undefined)throw Error('Choose a key');
    for(const key of ['textKey','voiceKey'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length<8))throw Error('Invalid provider key');
    if(input.textKey!==undefined&&f.hold){f.pending=true;await new Promise<void>(resolve=>f.release=resolve);f.pending=false;}current(input);
    if(f.reject)throw Error('Provider validation refused');if(input.textKey!==undefined)keys.text=input.textKey;if(input.voiceKey!==undefined)keys.voice=input.voiceKey;
    committed(input);f.edited++;f.events.push('edit');return status();
   }
   if(method==='removeProviderKey'){
    current(input);if(input.key!=='text'&&input.key!=='voice')throw Error('Invalid key');delete keys[input.key as 'text'|'voice'];committed(input);f.removed++;f.events.push('remove:'+input.key);return status();
   }
   if(method==='revealProviderKey'){
    current(input);if(input.key!=='text'&&input.key!=='voice'||!keys[input.key as 'text'|'voice'])throw Error('Key unavailable');
    leases.delete(input.requestId);f.revealed++;f.events.push('reveal:'+input.key);return {key:input.key,shown:true,hidesAfterMs:30000,revision};
   }
   if(method==='configureCloudProvider'){if(nativeEmail)f.events.push('services:'+mode);const result=await base(plugin,method,input);if(mode==='cloud')unbound=false;return result;}
   if(method==='clearProvider'){if(input?.requestId&&!leases.has(input.requestId))throw Error('Provider request cancelled');if(input?.requestId)leases.delete(input.requestId);unbound=true;revision=crypto.randomUUID();f.cleared++;await base(plugin,method,input);return status();}
   return base(plugin,method,input);
  };
 },{signedOut,dataKey:DATA_KEY,nativeEmail});
 return {logs,errors,foreign};
}
const dialog=(page:Page)=>page.getByRole('dialog',{name:'AI connection',exact:true});
const welcomePage=(page:Page)=>page.getByRole('main',{name:'Welcome to Alpha.',exact:true});
const toast=(page:Page)=>page.locator('[data-alpha-toast]');
async function openProvider(page:Page,pressed:'Cloud'|'Own API keys'='Cloud'){
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:pressed,exact:true})).toHaveAttribute('aria-pressed','true');
}
/** Settings uses the Cloud / Own API keys choice; the welcome page offers one "Use my own API keys" entry. */
async function enterKeys(page:Page,container=dialog(page),entry='Own API keys'){
 await container.getByRole('button',{name:entry,exact:true}).click();
 await expect(container.getByLabel('Text API key',{exact:true})).toHaveAttribute('type','password');
 await expect(container.getByLabel('Voice API key (optional)',{exact:true})).toHaveAttribute('autocomplete','off');
 await container.getByLabel('Text API key',{exact:true}).fill(AI_KEY);
 await container.getByLabel('Voice API key (optional)',{exact:true}).fill(VOICE_KEY);
}
async function noLeaks(page:Page,observed:Awaited<ReturnType<typeof fixture>>){
 const values=await page.evaluate(()=>({storage:[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'),text:document.body.innerText,data:localStorage.getItem('own-provider-ui-existing-data')}));
 for(const key of [AI_KEY,VOICE_KEY]){expect(values.storage).not.toContain(key);expect(values.text).not.toContain(key);expect(observed.logs.join('\n')).not.toContain(key);}
 expect(values.data).toBe('existing local app data');expect(observed.errors).toEqual([]);expect(observed.foreign).toEqual([]);
 await expectNoDevelopmentSurface(page);
}
/** First-run setup after own keys ends on "You’re all set" without a false AI warning (#772 regression). */
async function ownKeySetupReady(page:Page){
 const setup=page.locator('dialog.alpha-startup-permissions');
 if(await setup.count())await expect(setup).not.toContainText('AI connection isn’t confirmed yet');
 await completeAccessSetup(page);
}

test('pending provider change shows progress instead of a false failure',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await page.evaluate(()=>(window as any).ownProvider.holdSelect=true);
 await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.selectPending)).toBe(true);
 await expect(dialog(page).getByText('Updating connection…',{exact:true})).toBeVisible();
 await expect(dialog(page).getByText('Status unavailable.',{exact:true})).toHaveCount(0);
 await expect(dialog(page).getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).ownProvider.releaseSelect());
 await expect(dialog(page).getByText('Updating connection…',{exact:true})).toHaveCount(0);
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await noLeaks(page,observed);
});

test('Cloud is the default; explicit own-key save and return to Cloud preserve existing app data',async({page},info)=>{
 const observed=await fixture(page);await residentHome(page);
 const account=await page.evaluate(()=>({cloud:(window as any).flagOff.slots['cloud:production'],agent:sessionStorage.getItem('flag-off-agent')}));
 await openProvider(page);await expect(dialog(page).getByLabel('Text API key',{exact:true})).toHaveCount(0);
 // One dialog title, with no duplicated AI provider heading.
 await expect(dialog(page).getByRole('heading',{name:'AI connection',exact:true})).toHaveCount(1);
 const selectedColor=await dialog(page).getByRole('button',{name:'Cloud',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 await enterKeys(page);
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page)).toContainText('Cerebras receives your prompts; Cartesia, if added, receives voice recordings and reply text.');await expect(dialog(page)).not.toContainText(/selected context|Android Keystore|model list|Switching is manual/);
 await page.screenshot({path:info.outputPath('own-provider-form.png'),animations:'disabled'});
 await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).ownProvider.events)).toEqual([]);
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await enterKeys(page);await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 // A provider change from Settings is not onboarding: no access walkthrough, just a receipt.
 await expect(dialog(page)).toHaveCount(0);await expect(toast(page)).toContainText('Own keys saved.');
 await expect(page.locator('dialog.alpha-startup-permissions')).toHaveCount(0);
 await expect((await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/})).toContainText('Own API keys');
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page).getByText('Text and voice connected',{exact:true})).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'View keys',exact:true})).toBeEnabled();
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveCSS('background-color',selectedColor);
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).not.toHaveCSS('background-color',selectedColor);
 await page.screenshot({path:info.outputPath('own-provider-settings.png'),animations:'disabled'});
 expect(await page.evaluate(()=>(window as any).ownProvider.matched)).toBe(true);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 // Viewing the manager shows presence only; revealing requires a separate explicit action.
 await dialog(page).getByRole('button',{name:'View keys',exact:true}).click();
 const text=dialog(page).getByRole('region',{name:'Text key',exact:true}),voice=dialog(page).getByRole('region',{name:'Voice key',exact:true});
 await expect(text.getByText('Added',{exact:true})).toBeVisible();await expect(voice.getByText('Added',{exact:true})).toBeVisible();
 await expect(text.locator('input')).toHaveCount(0);await expect(voice.locator('input')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).ownProvider.revealed)).toBe(0);
 await text.getByRole('button',{name:'View',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.revealed)).toBe(1);
 await expect(text.locator('input'),'native reveal never sends plaintext to the DOM').toHaveCount(0);
 await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
 await expect(dialog(page).getByText('Updating connection…',{exact:true})).toHaveCount(0);
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page)).not.toContainText(/keys will be removed/);
 expect(await page.evaluate(async()=>{const f=(window as any).ownProvider;return {cleared:f.cleared,saved:f.saved,selected:f.selected,status:await (window as any).Capacitor.nativePromise('Agent','providerStatus',{})};})).toMatchObject({cleared:0,saved:1,selected:1,status:{mode:'cloud',voiceConfigured:false,keys:{text:{configured:true},voice:{configured:true}}}});
 await page.screenshot({path:info.outputPath('own-provider-cloud-retained.png'),animations:'disabled'});
 // Select the already saved keys without another entry, validation or save.
 await dialog(page).getByRole('button',{name:'Own API keys',exact:true}).click();
 await expect(dialog(page).getByText('Updating connection…',{exact:true})).toHaveCount(0);
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page).getByText('Text and voice connected',{exact:true})).toBeVisible();
 await expect(dialog(page).getByRole('form',{name:'Own API keys'})).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,selected:f.selected,cleared:f.cleared};})).toEqual({saved:1,selected:2,cleared:0});
 expect(await page.evaluate(()=>({cloud:(window as any).flagOff.slots['cloud:production'],agent:sessionStorage.getItem('flag-off-agent')}))).toEqual(account);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);await noLeaks(page,observed);
});

// A reply in flight does not survive opening AI provider: an open connection dialog is a sensitive
// screen, so the reply stops there with the usual stopped-reply notice (never "The connection
// changed."), before any switch. Its switch lock lifts as that stop settles, and the switch works.
test('opening AI provider during a reply stops it as a sensitive screen; the switch is then usable and works',async({page})=>{
 const observed=await fixture(page);await residentHome(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.evaluate(()=>(window as any).ownProvider.holdReply=true);
 await page.getByRole('button',{name:'Type',exact:true}).click();
 const composer=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
 await composer.fill('Reply while I open AI provider');await composer.press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.replyHeld)).toBe(true);
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toBeVisible();
 // A touch outside the open chat only collapses it, so collapse it before reaching Settings.
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await expect(dialog(page)).toBeVisible();
 const stoppedNotice='This reply may still finish. It will appear here if it does.';
 const retainedNotice=page.locator('[data-alpha-message-id="stopped-reply-notice"]');
 await expect(retainedNotice).toHaveCount(1);await expect(retainedNotice).toHaveText(stoppedNotice);
 // The second text node is the intentional clipped screen-reader announcer, not a duplicate bubble.
 await expect(page.locator('[data-alpha-reply-announcer]')).toHaveCount(1);
 await expect(page.locator('[data-alpha-reply-announcer]')).toHaveText(stoppedNotice);
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
 await expect(page.getByText(/The connection changed/)).toHaveCount(0);
 // The sensitive sheet conceals the chat. Its one retained notice is visible when chat is reopened.
 await dialog(page).getByRole('button',{name:'Close Account',exact:true}).click();
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(retainedNotice).toBeVisible();await expect(retainedNotice).toHaveCount(1);
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();await expect(dialog(page)).toBeVisible();
 await enterKeys(page);
 await expect(dialog(page).getByRole('button',{name:'Save and use own keys',exact:true})).toBeEnabled();
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);await expect(toast(page)).toContainText('Own keys saved.');
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await expect(dialog(page).getByText('Text and voice connected',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;f.releaseReply?.();return {saved:f.saved,matched:f.matched};})).toEqual({saved:1,matched:true});
 await noLeaks(page,observed);
});

test('a rejected own-key check keeps Cloud selected and the entered keys for correction',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await page.evaluate(()=>(window as any).ownProvider.reject=true);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 // The reason sits with the form it refers to.
 const alert=dialog(page).getByRole('form',{name:'Own API keys'}).getByRole('alert');
 await expect(alert).toContainText('Cerebras did not accept this key');await expect(dialog(page).getByRole('alert')).toHaveCount(1);
 // Only the rejected key is retyped: it is focused and selected, and the Cartesia key stays.
 const rejected=dialog(page).getByLabel('Text API key',{exact:true});
 await expect(rejected).toBeFocused();await expect(rejected).toHaveAttribute('aria-invalid','true');
 expect(await rejected.evaluate((el:HTMLInputElement)=>[el.selectionStart,el.selectionEnd,el.value.length])).toEqual([0,AI_KEY.length,AI_KEY.length]);
 await expect(dialog(page).getByLabel('Voice API key (optional)',{exact:true})).toHaveValue(VOICE_KEY);
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(0);
 await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog(page).getByRole('alert')).toHaveCount(0);
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);await noLeaks(page,observed);
});

test('a signed-in Cloud subscription remains accessible with own Cerebras keys selected',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);
 await expect((await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/})).toContainText('Own API keys');
 await openCloudPlanFromSettings(page);
 await page.getByRole('dialog',{name:'Account',exact:true}).getByRole('button',{name:'Use code',exact:true}).click();
 const account=page.getByRole('dialog',{name:'Account',exact:true});
 const subscription=account.getByRole('region',{name:'Balance and membership',exact:true});
 await expect(account).toBeVisible();await expect(subscription).toBeVisible();
 await expect(subscription.getByText('Plus',{exact:true})).toBeVisible();
 await expect(subscription.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
 const code=subscription.getByRole('textbox',{name:'Membership code',exact:true});
 await expect(code).toBeFocused();await code.fill('SYNTHETIC-UNSUBMITTED');
 await expect(subscription.getByRole('button',{name:'Redeem',exact:true})).toBeEnabled();
 await expect(account).not.toContainText(/Available credits|Add credits|\$\d/);
 await expect(account.getByLabel('Text API key',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).ownProvider.cleared)).toBe(0);
 expect(await page.evaluate(async()=>{
  const status=await (window as any).Capacitor.nativePromise('Agent','providerStatus',{});
  return status.provider==='cerebras'&&status.selected===true;
 })).toBe(true);
 await noLeaks(page,observed);
});

test('Back cancels an in-flight native lease before the key can be saved',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await page.evaluate(()=>(window as any).ownProvider.hold=true);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(true);
 // The check shows on its own button; the form's Cancel stays available to abort it.
 await expect(dialog(page).getByRole('button',{name:'Checking key…',exact:true})).toHaveAttribute('aria-busy','true');
 await expect(dialog(page).getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();
 await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.cancelled)).toBe(1);
 await page.evaluate(()=>(window as any).ownProvider.release());
 await expect(dialog(page).getByRole('button',{name:'Save and use own keys',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(0);
 await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await noLeaks(page,observed);
});

test('Settings offers Cancel during a slow key check; it stops the check and a later save still works',async({page})=>{
 const observed=await fixture(page);await residentHome(page);
 const account=await page.evaluate(()=>({cloud:(window as any).flagOff.slots['cloud:production'],agent:sessionStorage.getItem('flag-off-agent')}));
 await openProvider(page);await enterKeys(page);
 await page.evaluate(()=>(window as any).ownProvider.hold=true);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(true);
 const checking=dialog(page).getByRole('button',{name:'Checking key…',exact:true});
 await expect(checking).toHaveAttribute('aria-busy','true');await expect(checking).toBeDisabled();
 const cancel=dialog(page).getByRole('button',{name:'Cancel',exact:true});
 await expect(cancel).toBeVisible();await expect(cancel).toBeEnabled();
 await cancel.click();
 // The check ends while native still holds the request: Cancel revoked its lease.
 await expect(dialog(page).getByRole('button',{name:'Save and use own keys',exact:true})).toBeEnabled();
 await expect(dialog(page).getByRole('status')).toHaveCount(0);await expect(dialog(page).getByRole('alert')).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {pending:f.pending,cancelled:f.cancelled,saved:f.saved,events:f.events};})).toEqual({pending:true,cancelled:1,saved:0,events:['reserve','configure','cancel']});
 await expect(dialog(page).getByText('Text and voice connected',{exact:true})).toHaveCount(0);
 // A late native completion of the cancelled request is refused and selects nothing.
 await page.evaluate(()=>{const f=(window as any).ownProvider;f.hold=false;f.release();});
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(false);
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(0);
 expect(await page.evaluate(()=>({cloud:(window as any).flagOff.slots['cloud:production'],agent:sessionStorage.getItem('flag-off-agent')}))).toEqual(account);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 // The same form saves normally afterwards.
 await dialog(page).getByLabel('Text API key',{exact:true}).fill(AI_KEY);
 await dialog(page).getByLabel('Voice API key (optional)',{exact:true}).fill(VOICE_KEY);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);await expect(toast(page)).toContainText('Own keys saved.');
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await expect(dialog(page).getByText('Text and voice connected',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,matched:f.matched};})).toEqual({saved:1,matched:true});
 await noLeaks(page,observed);
});


test('signed-out onboarding can explicitly select own keys without starting a Cloud sign-in',async({page},info)=>{
 const observed=await fixture(page,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 // The page is the Cloud sign-in first; own keys are one quiet entry below it, not a settings toggle above the brand.
 await expect(welcome.getByRole('region',{name:'AI provider'})).toHaveCount(0);
 const own=welcome.getByRole('button',{name:'Use my own API keys',exact:true});
 const heading=await welcome.getByRole('heading',{name:'Welcome to Alpha.',exact:true}).boundingBox(),entry=await own.boundingBox();
 expect(entry!.y).toBeGreaterThan(heading!.y);
 await enterKeys(page,welcome,'Use my own API keys');
 // The key form replaces the Cloud methods instead of stacking two flows.
 await expect(welcome.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
 await expect(welcome.getByRole('form',{name:'Sign in with email'})).toHaveCount(0);
 await expect(welcome.getByRole('button',{name:'Back',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('welcome-own-keys.png'),animations:'disabled'});
 await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome).toHaveCount(0);await ownKeySetupReady(page);
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(1);
 expect(await page.evaluate(()=>(window as any).flagOff.slots['cloud:production']??null)).toBeNull();
 expect(await page.evaluate(()=>(window as any).flagOff.calls.filter((call:string)=>/AlphaCloudSignIn\.(start|verify)/.test(call)))).toEqual([]);
 await noLeaks(page,observed);
});

test('welcome-page own keys: a rejected key is explained at the form, Back returns to Cloud sign-in',async({page},info)=>{
 const observed=await fixture(page,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await page.evaluate(()=>(window as any).ownProvider.reject=true);
 await enterKeys(page,welcome,'Use my own API keys');
 await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome.getByRole('form',{name:'Own API keys'}).getByRole('alert')).toContainText('Cerebras did not accept this key');
 await expect(welcome.getByLabel('Text API key',{exact:true})).toBeFocused();
 await expect(welcome.getByLabel('Voice API key (optional)',{exact:true})).toHaveValue(VOICE_KEY);
 await page.screenshot({path:info.outputPath('welcome-own-keys-rejected.png'),animations:'disabled'});
 await welcome.getByRole('button',{name:'Back',exact:true}).click();
 // Back leaves the key form for the Cloud sign-in state it replaced (this fixture's Cloud readiness is unavailable).
 await expect(welcome.getByRole('form',{name:'Own API keys'})).toHaveCount(0);
 await expect(welcome).not.toContainText('Cerebras did not accept this key');
 await expect(welcome.getByRole('button',{name:'Use my own API keys',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(0);
 await noLeaks(page,observed);
});

test('signed-out Own selection opens Cloud sign-in without deleting keys; cancelling keeps Own selected',async({page},info)=>{
 const observed=await fixture(page,true,false,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await enterKeys(page,welcome,'Use my own API keys');await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome).toHaveCount(0);await ownKeySetupReady(page);
 await openProvider(page,'Own API keys');
 const before=await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,cleared:f.cleared,selected:f.selected};});
 await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
 const signIn=page.locator('.alpha-cloud-sign-in');await expect(signIn).toBeVisible();
 await expect(signIn).not.toContainText(/keys will be removed/);
 expect(await page.evaluate(async()=>{const f=(window as any).ownProvider;return {saved:f.saved,cleared:f.cleared,selected:f.selected,status:await (window as any).Capacitor.nativePromise('Agent','providerStatus',{})};})).toMatchObject({...before,status:{mode:'own',configured:true,keys:{text:{configured:true},voice:{configured:true}}}});
 await page.screenshot({path:info.outputPath('cloud-sign-in-own-keys-retained.png'),animations:'disabled'});
 await expect(signIn).not.toHaveAttribute('aria-busy','true');await page.keyboard.press('Escape');
 await expect(signIn).toHaveCount(0);
 await (await openCloudPlanFromSettings(page)).getByRole('button',{name:/^AI connection(?: Cloud| Own API keys)?$/}).click();
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page).getByText('Text and voice connected',{exact:true})).toBeVisible();
 await expect(dialog(page).getByRole('form',{name:'Own API keys'})).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,cleared:f.cleared,selected:f.selected};})).toEqual(before);
 expect(await page.evaluate(()=>(window as any).flagOff.slots['cloud:production']??null)).toBeNull();
 expect(await page.evaluate(()=>(window as any).flagOff.calls.filter((call:string)=>/AlphaCloudSignIn\.(start|verify)/.test(call)))).toEqual([]);
 await noLeaks(page,observed);
});

test('a rejected key on the welcome screen is reported inside the own-key form, never echoing the key, without selecting Cloud',async({page})=>{
 const observed=await fixture(page,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await enterKeys(page,welcome,'Use my own API keys');
 // The signed-out agent's startup unbind may already have cleared an absent binding; count from here.
 const before=await page.evaluate(()=>{const f=(window as any).ownProvider;f.hold=true;f.reject=true;return f.cleared;});
 await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 const own=welcome.getByRole('form',{name:'Own API keys'});
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(true);
 await expect(own.getByRole('button',{name:'Checking key…',exact:true})).toHaveAttribute('aria-busy','true');
 await page.evaluate(()=>(window as any).ownProvider.release());
 await expect(own.getByRole('alert')).toHaveText('Cerebras did not accept this key. It was not saved.');
 // A provider message that repeats the entered key, even partly, is replaced before it is shown.
 await page.evaluate(()=>{const f=(window as any).ownProvider;f.hold=false;f.reject='echo';});
 await own.getByLabel('Text API key',{exact:true}).fill(AI_KEY);await own.getByLabel('Voice API key (optional)',{exact:true}).fill(VOICE_KEY);
 await own.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(own.getByRole('alert')).toHaveText('Own API keys could not be set up. Check the keys and try again.');
 expect(await page.evaluate(()=>document.body.innerText)).not.toContain(AI_KEY.slice(1,-1));expect(observed.logs.join('\n')).not.toContain(AI_KEY.slice(1,-1));
 // Still the own-key form on the welcome page: Cloud was neither selected nor started.
 await expect(welcome).toBeVisible();await expect(welcome.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,cleared:f.cleared};})).toEqual({saved:0,cleared:before});
 expect(await page.evaluate(()=>(window as any).flagOff.slots['cloud:production']??null)).toBeNull();
 expect(await page.evaluate(()=>(window as any).flagOff.calls.filter((call:string)=>/AlphaCloudSignIn\.(start|verify)/.test(call)))).toEqual([]);
 await noLeaks(page,observed);
});

test('own keys chosen on a fresh phone continue into first-run access setup',async({page},info)=>{
 const observed=await fixture(page,true,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await enterKeys(page,welcome,'Use my own API keys');await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome).toHaveCount(0);
 // Setup used to require a Cloud account, so an owner who skipped Cloud never saw it.
 await expect(page.locator('dialog.alpha-startup-permissions')).toBeVisible({timeout:15_000});
 await expect(page.locator('dialog.alpha-startup-permissions')).not.toContainText('AI connection isn’t confirmed yet');
 await page.screenshot({path:info.outputPath('own-keys-access-setup.png'),animations:'disabled'});
 expect(observed.errors).toEqual([]);expect(observed.foreign).toEqual([]);
});

test('a failed restart after a Settings key save is shown in the AI provider dialog',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await page.evaluate(()=>{(window as any).ownProvider.startFail=true;});
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 // The key was saved; the restart's failure comes back to the dialog that started it.
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('alert')).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(1);
 expect(observed.errors).toEqual([]);
});

test('first-run setup opens while the agent is still starting on own keys',async({page})=>{
 const observed=await fixture(page,true,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await page.evaluate(()=>{(window as any).ownProvider.startHold=true;});
 await enterKeys(page,welcome,'Use my own API keys');await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.starting)).toBe(true);
 // Setup never waits for the agent's first boot (the same rule as after Cloud sign-in).
 await expect(page.locator('dialog.alpha-startup-permissions')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).ownProvider.starting)).toBe(true);
 await page.evaluate(()=>{const f=(window as any).ownProvider;f.startHold=false;f.startRelease?.();});
 expect(observed.errors).toEqual([]);expect(observed.foreign).toEqual([]);
});

test('the welcome own-key form offers Cancel during a slow key check without selecting or starting Cloud',async({page})=>{
 const observed=await fixture(page,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await enterKeys(page,welcome,'Use my own API keys');
 const before=await page.evaluate(()=>{const f=(window as any).ownProvider;f.hold=true;return f.cleared;});
 await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 const own=welcome.getByRole('form',{name:'Own API keys'});
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(true);
 const checking=own.getByRole('button',{name:'Checking key…',exact:true});
 await expect(checking).toHaveAttribute('aria-busy','true');await expect(checking).toBeDisabled();
 const cancel=own.getByRole('button',{name:'Cancel',exact:true});
 await expect(cancel).toBeVisible();await expect(cancel).toBeEnabled();
 await cancel.click();
 await expect(own.getByRole('button',{name:'Save and use own keys',exact:true})).toBeEnabled();
 await expect(own.getByRole('button',{name:'Cancel',exact:true})).toHaveCount(0);
 await expect(own.getByRole('status')).toHaveCount(0);await expect(own.getByRole('alert')).toHaveCount(0);
 await expect(welcome).not.toHaveAttribute('aria-busy','true');
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {pending:f.pending,cancelled:f.cancelled,saved:f.saved};})).toEqual({pending:true,cancelled:1,saved:0});
 await page.evaluate(()=>{const f=(window as any).ownProvider;f.hold=false;f.release();});
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(false);
 // Still the own-key form on the welcome page: nothing saved or cleared, Cloud neither selected nor started.
 await expect(welcome).toBeVisible();await expect(welcome.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,cleared:f.cleared};})).toEqual({saved:0,cleared:before});
 expect(await page.evaluate(()=>(window as any).flagOff.slots['cloud:production']??null)).toBeNull();
 expect(await page.evaluate(()=>(window as any).flagOff.calls.filter((call:string)=>/AlphaCloudSignIn\.(start|verify)/.test(call)))).toEqual([]);
 // The same form saves normally afterwards.
 await own.getByLabel('Text API key',{exact:true}).fill(AI_KEY);await own.getByLabel('Voice API key (optional)',{exact:true}).fill(VOICE_KEY);
 await own.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome).toHaveCount(0);await ownKeySetupReady(page);
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {saved:f.saved,matched:f.matched};})).toEqual({saved:1,matched:true});
 expect(await page.evaluate(()=>(window as any).flagOff.slots['cloud:production']??null)).toBeNull();
 await noLeaks(page,observed);
});


for(const explicit of [true,false])test(`successful sign-in retains Own keys; explicit Cloud selection ${explicit}`,async({page})=>{
 const observed=await fixture(page,true,false,true);
  await page.goto('/');const welcome=welcomePage(page);await expect(welcome).toBeVisible();
  await enterKeys(page,welcome,'Use my own API keys');await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
  await expect(welcome).toHaveCount(0);await ownKeySetupReady(page);
  await openProvider(page,'Own API keys');
  if(explicit)await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
  else{
   await dialog(page).getByRole('button',{name:'Close Account',exact:true}).click();
   await openCloudPlanFromSettings(page);
   await page.getByRole('dialog',{name:'Account',exact:true}).getByRole('button',{name:'Sign in',exact:true}).click();
  }
  const signIn=page.locator('.alpha-cloud-sign-in');await expect(signIn).toBeVisible();
  await signIn.getByRole('textbox',{name:'Email',exact:true}).fill('provider-switch@example.invalid');
  await signIn.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(signIn.getByLabel('Six-digit code')).toBeVisible();
  await page.evaluate(()=>{(window as any).ownProvider.holdVerify=true;});
  await signIn.getByLabel('Six-digit code').fill('123456');await signIn.getByRole('button',{name:'Verify',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.verifyPending)).toBe(true);
  expect(await page.evaluate(async()=>{const f=(window as any).ownProvider;return {selected:f.selected,verified:f.emailVerifications,status:await (window as any).Capacitor.nativePromise('Agent','providerStatus',{})};})).toMatchObject({selected:0,verified:0,status:{mode:'own',keys:{text:{configured:true},voice:{configured:true}}}});
  await page.evaluate(()=>{const f=(window as any).ownProvider;f.holdVerify=false;f.releaseVerify();});
  await expect(signIn).toHaveCount(0);await completeAccessSetup(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.emailVerifications)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.selected)).toBe(explicit?1:0);
  const result=await page.evaluate(async()=>{const f=(window as any).ownProvider;return {saved:f.saved,removed:f.removed,events:f.events,status:await (window as any).Capacitor.nativePromise('Agent','providerStatus',{}),credentialId:JSON.parse((window as any).flagOff.slots['cloud:production']).credentialId};});
  expect(result).toMatchObject({saved:1,removed:0,status:{mode:explicit?'cloud':'own',configured:true,keys:{text:{configured:true},voice:{configured:true}}}});
  expect(result.credentialId).toMatch(/^[0-9a-f-]{36}$/);
  expect(result.events).toContain('services:own');
  if(explicit)expect(result.events.indexOf('select:cloud')).toBeGreaterThan(result.events.indexOf('auth-verified'));
  else expect(result.events).not.toContain('select:cloud');
  await noLeaks(page,observed);
});


for(const superseding of ['Close','already-selected Own'] as const)test(`delayed Cloud credential read cannot outlive ${superseding}`,async({page})=>{
 const observed=await fixture(page,true,false,true);await page.goto('/');
 const welcome=welcomePage(page);await expect(welcome).toBeVisible();
 await enterKeys(page,welcome,'Use my own API keys');await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome).toHaveCount(0);await ownKeySetupReady(page);await openProvider(page,'Own API keys');
 const before=await page.evaluate(async()=>{const f=(window as any).ownProvider;return {saved:f.saved,selected:f.selected,cleared:f.cleared,status:await (window as any).Capacitor.nativePromise('Agent','providerStatus',{})};});
 await page.evaluate(()=>{(window as any).ownProvider.holdCloudRead=true;});
 await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.cloudReadPending)).toBe(true);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 if(superseding==='Close'){
  await dialog(page).getByRole('button',{name:'Close Account',exact:true}).click();
  await expect(dialog(page)).toHaveCount(0);
 }else{
  await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');
  await dialog(page).getByRole('button',{name:'Own API keys',exact:true}).click();
 }
 await page.evaluate(()=>{(window as any).ownProvider.releaseCloudRead();});
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.cloudReadCompletions)).toBe(1);
 // Allow the released promise and its render to settle, not an arbitrary timeout.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 if(superseding==='Close')await expect(dialog(page)).toHaveCount(0);
 else{await expect(dialog(page)).toBeVisible();await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveAttribute('aria-pressed','true');await expect(dialog(page).getByRole('alert')).toHaveCount(0);}
 expect(await page.evaluate(async()=>{const f=(window as any).ownProvider;return {saved:f.saved,selected:f.selected,cleared:f.cleared,status:await (window as any).Capacitor.nativePromise('Agent','providerStatus',{})};})).toEqual(before);
 expect(await page.evaluate(()=>{const f=(window as any).ownProvider;return {emailStarts:f.emailStarts,emailVerifications:f.emailVerifications,cloud:(window as any).flagOff.slots['cloud:production']??null};})).toEqual({emailStarts:0,emailVerifications:0,cloud:null});
 await noLeaks(page,observed);
});
