import {test,expect,type Page} from '@playwright/test';
// Explicit test-mocks recovery fixtures. Production retains damaged bytes and offers
// guidance without migration/reset controls (reset-only.production.spec.ts).
async function boot(page:Page,key:string,raw:string){
 await page.addInitScript(([key,raw])=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,raw);sessionStorage.setItem('seeded','1');}},[key,raw]);
 await page.goto('/?tools=1');
}
async function noDevTools(page:Page){await expect(page.locator('.alpha-dev-controls[open]')).toHaveCount(0);}

test('damaged bookmarks are recovered from Browser bookmarks without Device controls',async({page})=>{
 await boot(page,'alpha.browser.bookmarks.v1','{damaged bookmarks');
 await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
 const entry=page.getByRole('button',{name:'Recover saved bookmarks',exact:true});await expect(entry).toBeVisible();await expect(page.getByText('Saved bookmarks could not be opened. Their original data is retained.')).toBeVisible();
 await entry.click();await noDevTools(page);
 const dialog=page.getByRole('dialog',{name:'Browser bookmark recovery'});await expect(dialog).toBeVisible();
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download bookmarks backup',exact:true}).click();const stream=await (await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks).toString()).toBe('{damaged bookmarks');
 await dialog.getByRole('button',{name:'Reset app bookmarks',exact:true}).click();await dialog.getByRole('button',{name:'Confirm bookmarks reset',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Browser',exact:true}).click();await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
 await expect(page.getByRole('button',{name:'Recover saved bookmarks',exact:true})).toHaveCount(0);await expect(page.getByText('Nothing here yet')).toBeVisible();
});

test('damaged photo albums are recovered from Photos albums without Device controls',async({page})=>{
 await boot(page,'alpha.browser.albums.v1','{damaged albums');
 await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Albums',exact:true}).click();
 const entry=page.getByRole('button',{name:'Albums could not be read. Recover',exact:true});await expect(entry).toBeVisible();
 await entry.click();await noDevTools(page);
 const dialog=page.getByRole('dialog',{name:'Photo album recovery'});await expect(dialog).toBeVisible();
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download photo albums backup',exact:true}).click();const stream=await (await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks).toString()).toBe('{damaged albums');
 await dialog.getByRole('button',{name:'Reset app photo albums',exact:true}).click();await dialog.getByRole('button',{name:'Confirm photo albums reset',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Albums',exact:true}).click();
 await expect(page.getByRole('button',{name:'Favorites',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Recover$/})).toHaveCount(0);
});

test('healthy stores show no recovery entry',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?tools=1');
 await page.getByRole('button',{name:'Browser',exact:true}).click();await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
 await expect(page.getByText('Nothing here yet')).toBeVisible();await expect(page.getByRole('button',{name:'Recover saved bookmarks',exact:true})).toHaveCount(0);
 await page.goto('/?tools=1');await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Albums',exact:true}).click();
 await expect(page.getByRole('button',{name:'Favorites',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Recover$/})).toHaveCount(0);
});
