import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import {test,expect} from '@playwright/test';
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});

for(const theme of ['light','dark'])test(`${theme} album manager owns keyboard focus and restores the photo control`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 // This reference case checks the launcher Home indicator and Home dismissal.
 await page.goto(`/?shell=launcher&theme=${theme}`);
 await page.evaluate(async()=>{const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');const canvas=document.createElement('canvas');canvas.width=100;canvas.height=80;canvas.getContext('2d')!.fillRect(0,0,100,80);await importBrowserPhoto({original:new File([],'fixture.jpg'),image:canvas.toDataURL('image/jpeg'),width:100,height:80},new AbortController().signal);});
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await page.getByRole('button',{name:/^Photo, /}).click();
 const info=page.getByRole('button',{name:'Photo info',exact:true});
 await info.focus();await page.keyboard.press('Enter');
 // Info lists the facts and offers Add to album, which opens the album sheet.
 const sheet=page.getByRole('dialog',{name:'Photo info',exact:true});
 await expect(sheet.getByText('Dimensions',{exact:true})).toBeVisible();await expect(sheet.getByText('100 × 80',{exact:true})).toBeVisible();
 await sheet.getByRole('button',{name:'Add to album',exact:true}).click();
 const dialog=page.locator('[data-alpha-album-manager]');
 await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
 await expect(page.getByRole('button',{name:'Back from photo',exact:true})).toHaveCount(0);
 await expect(dialog).toHaveCSS('color',theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
 await expect(page.locator('button[aria-label="Home"] span')).toHaveCSS('background-color',theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
 await page.screenshot({path:test.info().outputPath('album-dialog.png'),animations:'disabled'});
 await page.keyboard.press('Shift+Tab');
 await expect(dialog.getByRole('button',{name:'New album',exact:true})).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
 await dialog.getByRole('button',{name:'New album',exact:true}).click();
 await expect(dialog.getByRole('textbox',{name:'Album name',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(info).toBeFocused();
 await info.click();await sheet.getByRole('button',{name:'Add to album',exact:true}).click();await expect(dialog).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back')));
 await expect(dialog).toHaveCount(0);await expect(info).toBeFocused();
 await info.click();await sheet.getByRole('button',{name:'Add to album',exact:true}).click();await expect(dialog).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Photos',exact:true})).toBeVisible();
});
