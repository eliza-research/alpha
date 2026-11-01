import {expect, test, type Page} from '@playwright/test';
import {completeAccessSetup, expectNoDevelopmentSurface, fenceNetwork, flagOffAndroid, residentHome} from './flag-off-android';

// The flag-off bundle and its real connection/controller UI run against the existing native
// fixture. The extra methods model native request leases and return only public provider status.
// No provider keys, account login, microphone, network provider, or Android device are real.
const AI_KEY='synthetic-own-cerebras-ui-key';
const VOICE_KEY='synthetic-own-cartesia-ui-key';
const DATA_KEY='own-provider-ui-existing-data';
async function fixture(page:Page, signedOut=false){
 const logs:string[]=[];page.on('console',message=>logs.push(message.text()));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const foreign=await fenceNetwork(page);await flagOffAndroid(page);
 await page.addInitScript(({signedOut,dataKey})=>{
  const w=window as any,base=w.Capacitor.nativePromise;
  const leases=new Set<string>();let selected:any=null;
  const f=w.ownProvider={events:[] as string[],saved:0,cancelled:0,cleared:0,checks:0,hold:false,reject:false,pending:false,release:null as null|(()=>void),matched:false};
  localStorage.setItem(dataKey,'existing local app data');
  if(signedOut){delete w.flagOff.slots['cloud:production'];w.flagOff.persist();}
  const status=()=>selected?{provider:'cerebras',configured:true,selected:true,model:'qwen-3.8-27b',revision:selected.revision,voiceConfigured:selected.voice}:base('Agent','providerStatus',{});
  w.Capacitor.PluginHeaders.find((p:any)=>p.name==='AlphaNotifications').methods.push({name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'});
  w.Capacitor.PluginHeaders.find((p:any)=>p.name==='Agent').methods.push(...['prepareProviderConfiguration','configureProvider','cancelProviderConfiguration'].map(name=>({name,rtype:'promise'})));
  w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin!=='Agent')return base(plugin,method,input);
   if(method==='providerStatus'){f.checks++;return status();}
   if(method==='prepareProviderConfiguration'){const id=crypto.randomUUID();leases.add(id);f.events.push('reserve');return {requestId:id};}
   if(method==='cancelProviderConfiguration'){leases.delete(input.requestId);f.cancelled++;f.events.push('cancel');return {};}
   if(method==='configureProvider'){
    f.events.push('configure');if(!leases.has(input.requestId))throw Error('Provider request cancelled');
    f.matched=input.apiKey==='synthetic-own-cerebras-ui-key'&&input.cartesiaKey==='synthetic-own-cartesia-ui-key'&&input.model==='qwen-3.8-27b';
    if(f.hold){f.pending=true;await new Promise<void>(resolve=>f.release=resolve);f.pending=false;}
    if(!leases.has(input.requestId))throw Error('Provider request cancelled');
    if(f.reject)throw Error('Cerebras did not accept this key. It was not saved.');
    leases.delete(input.requestId);selected={revision:crypto.randomUUID(),voice:!!input.cartesiaKey};f.saved++;return status();
   }
   if(method==='clearProvider'){if(input?.requestId&&!leases.has(input.requestId))throw Error('Provider request cancelled');if(input?.requestId)leases.delete(input.requestId);selected=null;f.cleared++;return base(plugin,method,input);}
   return base(plugin,method,input);
  };
 },{signedOut,dataKey:DATA_KEY});
 return {logs,errors,foreign};
}
const dialog=(page:Page)=>page.getByRole('dialog',{name:'AI provider',exact:true});
async function openProvider(page:Page){
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'AI provider',exact:true}).click();
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
}
async function enterKeys(page:Page,container=dialog(page)){
 await container.getByRole('button',{name:'Own API keys',exact:true}).click();
 await expect(container.getByLabel('Cerebras API key',{exact:true})).toHaveAttribute('type','password');
 await expect(container.getByLabel('Cartesia API key (optional)',{exact:true})).toHaveAttribute('autocomplete','off');
 await container.getByLabel('Cerebras API key',{exact:true}).fill(AI_KEY);
 await container.getByLabel('Cartesia API key (optional)',{exact:true}).fill(VOICE_KEY);
}
async function noLeaks(page:Page,observed:Awaited<ReturnType<typeof fixture>>){
 const values=await page.evaluate(()=>({storage:[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'),text:document.body.innerText,data:localStorage.getItem('own-provider-ui-existing-data')}));
 for(const key of [AI_KEY,VOICE_KEY]){expect(values.storage).not.toContain(key);expect(values.text).not.toContain(key);expect(observed.logs.join('\n')).not.toContain(key);}
 expect(values.data).toBe('existing local app data');expect(observed.errors).toEqual([]);expect(observed.foreign).toEqual([]);
 await expectNoDevelopmentSurface(page);
}

test('Cloud is the default; explicit own-key save and return to Cloud preserve existing app data',async({page},info)=>{
 const observed=await fixture(page);await residentHome(page);
 const account=await page.evaluate(()=>({cloud:(window as any).flagOff.slots['cloud:production'],agent:sessionStorage.getItem('flag-off-agent')}));
 await openProvider(page);await expect(dialog(page).getByLabel('Cerebras API key',{exact:true})).toHaveCount(0);
 const selectedColor=await dialog(page).getByRole('button',{name:'Cloud',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 await enterKeys(page);await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).ownProvider.events)).toEqual([]);
 await enterKeys(page);await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);await completeAccessSetup(page);
 await page.getByRole('button',{name:'AI provider',exact:true}).click();
 await expect(dialog(page).getByText('Own API keys · Cerebras',{exact:true})).toBeVisible();
 await expect(dialog(page).getByText('Voice uses your Cartesia key when you start the microphone.',{exact:true})).toBeVisible();
 await expect(dialog(page).getByRole('button',{name:'Own API keys',exact:true})).toHaveCSS('background-color',selectedColor);
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).not.toHaveCSS('background-color',selectedColor);
 await page.screenshot({path:info.outputPath('own-provider-settings.png'),animations:'disabled'});
 expect(await page.evaluate(()=>(window as any).ownProvider.matched)).toBe(true);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
 await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
 await dialog(page).getByRole('button',{name:'Keep own keys',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).ownProvider.cleared)).toBe(0);
 await dialog(page).getByRole('button',{name:'Cloud',exact:true}).click();
 await dialog(page).getByRole('button',{name:'Switch to Cloud',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);
 await page.getByRole('button',{name:'AI provider',exact:true}).click();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>(window as any).ownProvider.cleared)).toBe(1);
 expect(await page.evaluate(()=>({cloud:(window as any).flagOff.slots['cloud:production'],agent:sessionStorage.getItem('flag-off-agent')}))).toEqual(account);
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);await noLeaks(page,observed);
});

test('a rejected own-key check keeps Cloud selected and clears entered secrets',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await page.evaluate(()=>(window as any).ownProvider.reject=true);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(dialog(page).getByRole('alert')).toContainText('Cerebras did not accept this key');
 await expect(dialog(page).getByLabel('Cerebras API key',{exact:true})).toHaveValue('');
 await expect(dialog(page).getByLabel('Cartesia API key (optional)',{exact:true})).toHaveValue('');
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(0);
 await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);await noLeaks(page,observed);
});

test('a signed-in Cloud subscription remains accessible with own Cerebras keys selected',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(dialog(page)).toHaveCount(0);await completeAccessSetup(page);
 await expect.poll(()=>page.evaluate(async()=>{
  const snapshot=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot();
  return {signedIn:!!snapshot.cloudAccount,provider:snapshot.providerStatus?.provider,selected:snapshot.providerStatus?.selected};
 })).toEqual({signedIn:true,provider:'cerebras',selected:true});
 await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.openPlan());
 const account=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});
 const subscription=account.getByRole('region',{name:'Subscription',exact:true});
 await expect(account).toBeVisible();await expect(subscription).toBeVisible();
 await expect(subscription.getByText('Plus',{exact:true})).toBeVisible();
 await expect(subscription.getByRole('button',{name:'Manage subscription',exact:true})).toBeVisible();
 await subscription.getByRole('button',{name:'Enter membership code',exact:true}).click();
 const code=subscription.getByRole('textbox',{name:'Membership code',exact:true});
 await expect(code).toBeFocused();await code.fill('SYNTHETIC-UNSUBMITTED');
 await expect(subscription.getByRole('button',{name:'Redeem',exact:true})).toBeEnabled();
 await expect(account).not.toContainText(/Available credits|Add credits|\$\d/);
 await expect(account.getByLabel('Cerebras API key',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).ownProvider.cleared)).toBe(0);
 expect(await page.evaluate(async()=>{
  const state=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot();
  return state.providerStatus?.provider==='cerebras'&&state.providerStatus.selected===true;
 })).toBe(true);
 await noLeaks(page,observed);
});

test('Back cancels an in-flight native lease before the key can be saved',async({page})=>{
 const observed=await fixture(page);await residentHome(page);await openProvider(page);await enterKeys(page);
 await page.evaluate(()=>(window as any).ownProvider.hold=true);
 await dialog(page).getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.pending)).toBe(true);
 await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>(window as any).ownProvider.cancelled)).toBe(1);
 await page.evaluate(()=>(window as any).ownProvider.release());
 await expect(dialog(page).getByRole('button',{name:'Save and use own keys',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(0);
 await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog(page).getByRole('button',{name:'Cloud',exact:true})).toHaveAttribute('aria-pressed','true');
 await noLeaks(page,observed);
});

test('signed-out onboarding can explicitly select own keys without starting a Cloud sign-in',async({page})=>{
 const observed=await fixture(page,true);await page.goto('/');
 const welcome=page.getByRole('main',{name:'Welcome to Alpha.',exact:true});await expect(welcome).toBeVisible();
 await enterKeys(page,welcome);await welcome.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 await expect(welcome).toHaveCount(0);await completeAccessSetup(page);
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).ownProvider.saved)).toBe(1);
 expect(await page.evaluate(()=>(window as any).flagOff.slots['cloud:production']??null)).toBeNull();
 expect(await page.evaluate(()=>(window as any).flagOff.calls.filter((call:string)=>/AlphaCloudSignIn\.(start|verify)/.test(call)))).toEqual([]);
 await noLeaks(page,observed);
});
