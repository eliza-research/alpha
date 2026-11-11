import {test,expect} from '@playwright/test';
test.use({viewport:{width:360,height:430}});
for(const theme of ['light','dark'])test(`${theme} sharing leaves the application layout intact`,async({page},info)=>{
 await page.goto(`/?mode=dev&theme=${theme}`);
 await page.evaluate(async()=>{
  Object.defineProperty(document,'permissionsPolicy',{configurable:true,value:{allowsFeature:()=>true}});
  Object.defineProperty(navigator,'share',{configurable:true,value:async(data:unknown)=>{(window as any).shared=data;}});
  const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});
  const {shareMap}=await import('/src/maps/share.ts');await shareMap({title:'Destination',text:'Reviewed route'},new AbortController().signal);
 });
 await expect(page.getByRole('dialog',{name:'Share',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).shared)).toEqual({title:'Destination',text:'Reviewed route'});
 await page.screenshot({path:info.outputPath('device-share-large-text.png')});
});
