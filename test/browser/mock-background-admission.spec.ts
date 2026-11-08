import {test,expect} from '@playwright/test';
// Real rendered entry and cold-start controllers; controlled native collectors.
for(const entry of ['cold','chooser'] as const)for(const failure of ['none','hosted','notifications'] as const){
 test(`mock admission ${entry}: ${failure}`,async({page})=>{
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.addInitScript(({entry,failure})=>{
   const w=window as any;w.androidBridge={};
   if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:entry==='cold'?'mock':'offline'}));
   const f=w.mockFixture={hosted:true,notifications:true,calls:[] as string[],held:[] as (()=>void)[],fail:failure};
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'AlphaConnection',methods:methods(['pauseNotificationCollection','secureRead','secureWrite','secureRemove','addListener','removeListener'])},
    {name:'AlphaHostedResults',methods:methods(['disableBackground','status','pendingResult','addListener','removeListener'])},
    {name:'Agent',methods:methods(['getStatus'])}, {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
   ],nativePromise:async(plugin:string,method:string,input:any)=>{
    if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='Agent')return {packaged:false,state:'unavailable'};
    if(method==='secureRead')return {value:null};
    if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher:false,version:'fixture'};
    if(method==='pauseNotificationCollection'||method==='disableBackground'){
     const kind=method==='disableBackground'?'hosted':'notifications';f.calls.push(kind);
     if(kind==='hosted'&&input?.sessionId)throw Error('Cold persisted session must be fenced without an invented renderer identity');
     if(!sessionStorage.getItem('mock-barriers-released'))await new Promise<void>(resolve=>f.held.push(resolve));
     if(f.fail===kind)throw Error('Synthetic native pause rejection');f[kind]=false;return {};
    }
    return {};
   }};
  },{entry,failure});
  await page.goto('/');
  if(entry==='chooser'){

   await page.getByRole('button',{name:'Settings',exact:true}).click();
   await page.getByRole('button',{name:/Agent connection/}).click();
   await page.locator('.alpha-connection-scrim summary').filter({hasText:/^Mock mode$/}).click();
   await page.getByRole('button',{name:'Enter mock mode',exact:true}).click();
  }else await expect(page.getByRole('status')).toContainText('Pausing live background activity');
  await expect.poll(()=>page.evaluate(()=>(window as any).mockFixture.calls.length)).toBe(2);
  await expect(page.getByText('Mock mode · simulated data and actions')).toHaveCount(0);
  if(entry==='cold')await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
  else expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!).kind)).toBe('offline');
  // Release only one barrier: mounting/navigation must remain blocked.
  await page.evaluate(()=>(window as any).mockFixture.held.shift()());
  await expect(page.getByText('Mock mode · simulated data and actions')).toHaveCount(0);
  await page.evaluate(()=>{sessionStorage.setItem('mock-barriers-released','1');(window as any).mockFixture.held.shift()();});
  if(failure==='none'){
   await expect(page.getByText('Mock mode · simulated data and actions')).toBeVisible();
  }else{
   await expect(page.getByText(/Live background activity could not be paused/)).toBeVisible();
   await expect(page.getByText('Mock mode · simulated data and actions')).toHaveCount(0);
   expect(await page.evaluate(()=>(window as any).mockFixture.calls)).toEqual(['notifications','hosted']);
   if(entry==='cold'){
    await page.evaluate(()=>(window as any).mockFixture.fail='none');
    await page.getByRole('button',{name:'Retry mock mode'}).click();
    await expect(page.getByText('Mock mode · simulated data and actions')).toBeVisible();
   }else expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!).kind)).toBe('offline');
  }
  expect(pageErrors).toEqual([]);
 });
}
