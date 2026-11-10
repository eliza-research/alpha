import {test,expect} from '@playwright/test';
test.use({viewport:{width:360,height:430}});
for(const theme of ['light','dark'])test(`${theme} common Share panel remains usable at large text`,async({page},info)=>{
 await page.goto(`/?mode=dev&theme=${theme}`);
 await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});const {shareMap}=await import('/src/maps/share.ts');void shareMap({title:'Destination-'+ 'unbroken'.repeat(20),text:'Reviewed route'},new AbortController().signal);});
 const dialog=page.getByRole('dialog',{name:'Share',exact:true});await expect(dialog).toBeVisible();expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 for(const name of ['Share','Copy text','Close share']){const button=dialog.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);}
 await page.screenshot({path:info.outputPath('common-share-large-text.png')});await dialog.getByRole('button',{name:'Close share',exact:true}).click();await expect(dialog).toHaveCount(0);
});
