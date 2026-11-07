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
