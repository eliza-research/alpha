import {test,expect} from '@playwright/test';
// Android Back pops one Settings level, matching each page's on-screen back (docs/ui-refresh-2026-11, tla/SettingsNav.tla).
const back=(page:import('@playwright/test').Page)=>page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
const current=(page:import('@playwright/test').Page)=>page.locator('[data-settings-page]:not([inert])').last();
test('Back from Open source licenses returns to About, then to Settings, then Home',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 await current(page).getByRole('button',{name:'Open source licenses',exact:true}).click();
 await expect(current(page)).toHaveAttribute('data-settings-page','Open source licenses');
 await back(page);
 await expect(current(page)).toHaveAttribute('data-settings-page','About');
 await back(page);
 await expect(current(page)).toHaveAttribute('data-settings-page','Settings');
 await back(page);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
});
