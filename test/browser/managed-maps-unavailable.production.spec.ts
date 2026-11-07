// UI fixtures only: synthetic native HTTP boundaries, no provider/account/location access.
import {test,expect} from '@playwright/test';
import {flagOffAndroid,residentHome,button,fenceNetwork} from './flag-off-android';
import {residentStub} from './resident-stub';
import {settled} from './helpers/settled';

test.beforeEach(({},info)=>test.skip(info.project.name!=='production','Flag-off renderer'));
for(const [orientation,viewport] of [['portrait',{width:412,height:915}],['landscape',{width:915,height:412}]] as const){
 test.describe(orientation,()=>{
  test.use({viewport,hasTouch:true,isMobile:true});
  test('managed Cloud outage offers retry without provider setup or invented results',async({page},info)=>{
   const foreign=await fenceNetwork(page);await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'fixture-background',type:'background',paint:{'background-color':'#eef3f5'}}]}}));await flagOffAndroid(page);await residentStub(page);
   await page.addInitScript(()=>{
    const w=window as any,base=w.Capacitor.nativePromise;
    w.Capacitor.PluginHeaders.push({name:'ElizaSense',methods:[{name:'turnOff',rtype:'promise'},{name:'status',rtype:'promise'}]});
    const f=w.mapsUnavailableFixture={capabilities:0,otherMaps:0};
    w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
     if(plugin==='ElizaSense')return{available:true,state:'OFF',label:'Listening off',consented:false,listening:false,microphoneOpen:false};
     if(plugin==='AlphaConnection'&&method==='request'&&new URL(input.url).pathname.startsWith('/api/v1/maps/')){
      if(new URL(input.url).pathname.endsWith('/capabilities')){f.capabilities++;return{status:503,data:{code:'maps_not_configured',error:'Maps unavailable'}};}
      f.otherMaps++;throw Error('Unavailable fixture must not request places or routes');
     }
     return base(plugin,method,input);
    };
   });
   await residentHome(page);await button(page,'Maps').click();
   const search=page.getByRole('textbox',{name:'Search places',exact:true});await search.fill('Synthetic place');await search.press('Enter');
   const status=page.locator('[data-alpha-maps-status] [role="status"]');
   await expect(status).toHaveText('Maps is unavailable right now. Try again later.');
   await expect(page.getByText(/Connect a Maps provider/)).toHaveCount(0);
   expect(await page.locator('[data-alpha-maps-root]').evaluate(element=>JSON.parse((element as HTMLElement).dataset.mapDiagnostics!).error)).toBe('unconfigured');
   const before=await page.evaluate(()=>(window as any).mapsUnavailableFixture.capabilities);
   await search.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).mapsUnavailableFixture.capabilities)).toBeGreaterThan(before);
   await expect(status).toHaveText('Maps is unavailable right now. Try again later.');
   expect(await page.evaluate(()=>(window as any).mapsUnavailableFixture.otherMaps)).toBe(0);
   await settled(page);
   await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='UI FIXTURE · synthetic service outage';badge.style.cssText='position:fixed;right:4px;top:4px;z-index:2147483647;padding:3px 6px;background:#112b46;color:white;font:10px sans-serif;pointer-events:none';badge.setAttribute('aria-hidden','true');document.body.append(badge);});
   await page.screenshot({path:info.outputPath(`UI-FIXTURE-maps-unavailable-${orientation}.png`),animations:'disabled'});
   expect(foreign).toEqual([]);
  });
 });
}
