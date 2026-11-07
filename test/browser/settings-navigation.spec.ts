import {test,expect,type Page} from '@playwright/test';
// Android Back pops one Settings level, matching each page's on-screen back (docs/ui-refresh-2026-11, tla/SettingsNav.tla).
const back=(page:Page)=>page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
const current=(page:Page)=>page.locator('[data-settings-page]:not([inert])').last();
async function settings(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(current(page)).toHaveAttribute('data-settings-page','Settings');
}
for(const child of ['Problem log','Open source licenses'])test(`Back from ${child} returns to About, then to Settings, then Home`,async({page})=>{
 await settings(page);
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 await current(page).getByRole('button',{name:child,exact:true}).click();
 await expect(current(page)).toHaveAttribute('data-settings-page',child);
 await back(page);
 await expect(current(page)).toHaveAttribute('data-settings-page','About');
 await back(page);
 await expect(current(page)).toHaveAttribute('data-settings-page','Settings');
 await back(page);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
});
test('Back from a first-level page returns to the Settings top level',async({page})=>{
 await settings(page);
 for(const [row,title] of [['Calendars','Calendars'],['Passwords','Passwords'],['About','About']]){
  await current(page).getByRole('button',{name:row,exact:true}).click();
  await expect(current(page)).toHaveAttribute('data-settings-page',title);
  await back(page);
  await expect(current(page)).toHaveAttribute('data-settings-page','Settings');
 }
});
