import {test,expect} from '@playwright/test';
import {flagOffAndroid,fenceNetwork,residentHome} from './flag-off-android';

// Full flag-off production renderer and bundled CSS, closed native/Gmail ports only.
// Deleting the API before mount exercises the WebView113 path; no real mail is read.
for(const legacy of [false,true])for(const width of [360,412])test(`Inbox folders stay hidden and dismiss safely: ${legacy?'legacy-no-popover':'modern'} ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:740});await fenceNetwork(page);
 if(legacy)await page.addInitScript(()=>{delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;});
 await flagOffAndroid(page,{accounts:[{connectionId:'qa-mailbox',email:'qa@example.invalid',connected:true,messages:[]}]});
 await residentHome(page);
 // The 30-day fixture has no expiry warning; the mailbox starts unobstructed.
 await expect(page.getByRole('region',{name:'Eliza Cloud sign-in notice',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 const trigger=page.getByRole('button',{name:'Other mail folders',exact:true}),menu=page.getByRole('menu',{name:'Mail folders',exact:true});
 await expect(trigger).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(menu).toBeHidden();
 await trigger.click();await expect(menu).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','true');
 expect(await menu.evaluate(el=>el.hasAttribute('popover'))).toBe(!legacy);
 const box=(await menu.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(740);
 await page.screenshot({path:info.outputPath('folders-open.png'),animations:'disabled'});
 await trigger.click();await expect(menu).toBeHidden();
 await trigger.focus();await trigger.press('ArrowDown');await expect(menu.getByRole('menuitemradio',{name:'Starred',exact:true})).toBeFocused();
 await page.keyboard.press('End');await expect(menu.getByRole('menuitemradio',{name:'Drafts',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(menu).toBeHidden();await expect(trigger).toBeFocused();await expect(page.getByRole('region',{name:'Inbox',exact:true})).toBeVisible();
 await trigger.click();await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(menu).toBeHidden();
 await trigger.click();await menu.getByRole('menuitemradio',{name:'Starred',exact:true}).click();await expect(menu).toBeHidden();await expect(trigger).toContainText('Starred');
 await trigger.click();await expect(menu.getByRole('menuitemradio',{name:'Starred',exact:true})).toHaveAttribute('aria-checked','true');
 await page.keyboard.press('Tab');await expect(menu).toBeHidden();
});
