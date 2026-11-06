import {test,expect} from '@playwright/test';
test.use({viewport:{width:360,height:720}});
for(const theme of ['light','dark'])test(`${theme} long file deletion review fits at 150 percent text`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(`/?mode=dev&theme=${theme}`);
 const filename='File-'+ 'abcdef'.repeat(30)+'.txt';
 await page.evaluate(async name=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['Retained'],name,{type:'text/plain'}));const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});},filename);
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();await page.getByRole('button',{name:'Open '+filename,exact:true}).click();await page.getByRole('button',{name:'Delete file',exact:true}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Trash',exact:true}).click();await page.getByRole('button',{name:filename,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:filename,exact:true});
 await dialog.getByRole('button',{name:'Delete now',exact:true}).click();
 await dialog.getByRole('button',{name:'Delete permanently',exact:true}).scrollIntoViewIfNeeded();
 expect(await dialog.locator(':scope > div').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 const dock=await page.locator('[data-alpha-layer="pill"]').boundingBox();
 for(const name of ['Restore','Delete permanently','Cancel']){const box=await dialog.getByRole('button',{name,exact:true}).boundingBox();expect(box!.y).toBeGreaterThan(0);expect(box!.y+box!.height).toBeLessThan(dock!.y);}
 await page.screenshot({path:test.info().outputPath('large-delete-review.png'),animations:'disabled'});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:filename,exact:true})).toBeVisible();
});
