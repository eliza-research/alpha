import {expect,test,type Page} from '@playwright/test';
import {fenceNetwork,flagOffAndroid,residentHome} from './flag-off-android';

// The shipped renderer, ProviderKeys and real connection controller run together.
// Only the native boundary is synthetic. Status publishes the edited revision
// before Agent.start resolves, reproducing the reconnect race; no provider/device use.
async function fixture(page:Page){
 await fenceNetwork(page);await flagOffAndroid(page);
 await page.addInitScript(()=>{
  const w=window as any,base=w.Capacitor.nativePromise;
  let revision='own-start',voice=true;const leases=new Set<string>();
  const f=w.keyReconnect={hold:false,starting:false,release:null as null|(()=>void),cancels:0,edits:0,removes:0};
  const status=()=>({mode:'own',provider:'cerebras',configured:true,selected:true,model:'qwen-3.8-27b',voiceConfigured:voice,revision,persistence:'native-secure-store',keys:{text:{configured:true},voice:{configured:voice}}});
  const agent=w.Capacitor.PluginHeaders.find((p:any)=>p.name==='Agent');
  for(const name of ['prepareProviderConfiguration','cancelProviderConfiguration','editProviderKeys','removeProviderKey','cancelStart'])if(!agent.methods.some((m:any)=>m.name===name))agent.methods.push({name,rtype:'promise'});
  if(!w.Capacitor.PluginHeaders.some((p:any)=>p.name==='AlphaHostedResults'))w.Capacitor.PluginHeaders.push({name:'AlphaHostedResults',methods:[{name:'disableBackground',rtype:'promise'},{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]});
  w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaHostedResults'&&method==='disableBackground')return {};
   if(plugin!=='Agent')return base(plugin,method,input);
   if(method==='providerStatus')return status();
   if(method==='prepareProviderConfiguration'){const requestId=crypto.randomUUID();leases.add(requestId);return {requestId};}
   if(method==='cancelProviderConfiguration'){leases.delete(input.requestId);return {};}
   if(method==='editProviderKeys'||method==='removeProviderKey'){
    if(!leases.delete(input.requestId)||input.expectedRevision!==revision)throw Error('Stale key request');
    if(method==='editProviderKeys'){if(typeof input.voiceKey!=='string'||input.textKey!==undefined)throw Error('Wrong independent edit');f.edits++;}
    else{if(input.key!=='voice')throw Error('Wrong key removal');voice=false;f.removes++;}
    revision=crypto.randomUUID();return status();
   }
   if(method==='start'&&f.hold){f.starting=true;await new Promise<void>(resolve=>f.release=resolve);f.starting=false;}
   if(method==='cancelStart'){f.cancels++;return {};}
   return base(plugin,method,input);
  };
 });
}
for(const action of ['edit','remove'] as const)test(`Own Voice ${action} survives status revision publication during the real reconnect`,async({page})=>{
 await fixture(page);await residentHome(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Account',exact:true}).click();
 await page.getByRole('button',{name:'AI connection',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'AI connection',exact:true});await expect(panel).toBeVisible();
 await panel.getByRole('button',{name:'View keys',exact:true}).click();
 const voice=panel.getByRole('region',{name:'Voice key',exact:true});
 await page.evaluate(()=>{(window as any).keyReconnect.hold=true;});
 if(action==='edit'){
  await voice.getByRole('button',{name:'Edit',exact:true}).click();
  await voice.getByLabel('Voice API key',{exact:true}).fill('synthetic-new-voice-key');
  await voice.getByRole('button',{name:'Save',exact:true}).click();
 }else{
  await voice.getByRole('button',{name:'Remove',exact:true}).click();
  await voice.getByRole('button',{name:'Remove key',exact:true}).click();
 }
 await expect.poll(()=>page.evaluate(()=>(window as any).keyReconnect.starting)).toBe(true);
 // connectResident has already read and published the new revision at this point.
 await expect(voice.locator('input')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).keyReconnect.cancels)).toBe(0);
 await page.evaluate(()=>{const f=(window as any).keyReconnect;f.hold=false;f.release();});
 // A successful connection closes the dialog through the ordinary connect path.
 await expect(panel).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Talk',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'AI connection',exact:true}).click();
 await panel.getByRole('button',{name:'View keys',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Close keys',exact:true})).toBeEnabled();
 await expect(voice).toContainText(action==='remove'?'Not added':'Added');
 await expect(panel.getByRole('alert')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).keyReconnect.cancels)).toBe(0);
 expect(await page.evaluate(action=>(window as any).keyReconnect[action==='edit'?'edits':'removes'],action)).toBe(1);
 await expect(panel).not.toContainText('synthetic-new-voice-key');
});
