import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])test(`compact large text preserves Files cards, address controls and Home workflow: ${theme}`,async({page,browserName},info)=>{
 await page.setViewportSize({width:360,height:640});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev&workflows=agent&theme='+theme);
 await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 // Home draws a card only when it has something to show: the development
 // inbox has unread mail, so its card stands for the row here (no workflow is enabled in this profile).
 const workflow=page.getByRole('button',{name:/^Open Inbox: \d+ unread emails?$/});await workflow.scrollIntoViewIfNeeded();
 expect(await workflow.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);expect(await workflow.locator('[data-overview-part="count"]').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;})).toBe(1);await page.screenshot({path:info.outputPath('home-workflow-large-text.png')});
 await workflow.focus();await page.keyboard.press('Enter');await expect(page.locator('html')).toHaveAttribute('data-active-view','inbox');
 await returnToApps(page);await page.getByRole('button',{name:'Files',exact:true}).click();
 const cards=page.getByRole('button',{name:/^(Downloads|Images|Videos|Audio|Documents|Internal storage|Trash)$/});
 await expect(cards).toHaveCount(7);
 for(const card of await cards.all()){
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(el=>{const r=el.getBoundingClientRect();return {x:el.scrollWidth-el.clientWidth,y:el.scrollHeight-el.clientHeight,children:[...el.children].every(c=>{const cr=c.getBoundingClientRect();return cr.top>=r.top&&cr.bottom<=r.bottom&&cr.left>=r.left&&cr.right<=r.right;})};})).toEqual({x:0,y:0,children:true});
 }
 await page.getByRole('button',{name:'Downloads',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('files-large-text.png')});
 await returnToApps(page);await page.getByRole('button',{name:'Browser',exact:true}).click();
 const address=page.getByRole('button',{name:'Edit address',exact:true}),tabs=page.getByRole('button',{name:'Tabs',exact:true});
 expect(await address.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 const a=await address.boundingBox(),t=await tabs.boundingBox();expect(a!.x+a!.width).toBeLessThanOrEqual(t!.x+.5);
 await address.focus();for(const control of [page.getByRole('button',{name:'Previous page',exact:true}),page.getByRole('button',{name:'Next page',exact:true}),tabs]){await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab');await expect(control).toBeFocused();}await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'New tab',exact:true})).toBeVisible();
 await page.waitForTimeout(450);await page.screenshot({path:info.outputPath('tabs-large-text.png')});
 await page.reload({waitUntil:'domcontentloaded'});await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--browser-text-scale').trim())).toBe('1.5');
 await page.getByRole('button',{name:'Workflows',exact:true}).click();
 for(const name of ['New automation','Workflows options']){
  const control=page.getByRole('button',{name,exact:true});
  await expect(control).toBeVisible();
  const box=(await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x+box.width).toBeLessThanOrEqual(360);
 }
 await expect(page.getByRole('button',{name:/^Scheduled digests\b/})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('workflows-large-text.png')});
});
