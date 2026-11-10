import {expect,type Page} from '@playwright/test';

/** Isolated browser-owned pixels: exercises the real library/editor, never device media. */
export async function openOwnedPhotoViewer(page:Page,theme='light'){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(`/?theme=${theme}`);
 await page.evaluate(async()=>{
  const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');
  const canvas=document.createElement('canvas');canvas.width=240;canvas.height=180;
  const context=canvas.getContext('2d')!;context.fillStyle='#d6a667';context.fillRect(0,0,240,180);
  await importBrowserPhoto({original:new File([],'accessibility-fixture.jpg',{type:'image/jpeg'}),image:canvas.toDataURL('image/jpeg'),width:240,height:180},new AbortController().signal);
 });
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await page.getByRole('button',{name:/^Photo, /}).click();
 await expect(page.locator('[data-alpha-subview="photos-viewer"]:not([inert])')).toBeVisible();
}

/** Open the visible Photos menu without toggling an already-open menu closed. */
export async function openPhotoTools(page:Page){
 const menu=page.locator('details').filter({has:page.getByLabel('Photos tools',{exact:true})}).filter({visible:true});
 await expect(menu).toBeVisible();
 if(await menu.getAttribute('open')===null)await menu.getByLabel('Photos tools',{exact:true}).click();
 return menu;
}

/** Choose an action from the current single-photo menu. */
export async function choosePhotoAction(page:Page,name:string){
 const menu=page.locator('details').filter({has:page.getByLabel('Photo actions',{exact:true})}).filter({visible:true});
 await expect(menu).toBeVisible();
 if(await menu.getAttribute('open')===null)await menu.getByLabel('Photo actions',{exact:true}).click();
 await menu.getByRole('button',{name,exact:true}).click();
}

/** Open the current single-photo Share action. */
export const openPhotoShare=(page:Page)=>choosePhotoAction(page,'Share');
