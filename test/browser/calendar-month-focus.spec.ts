import {test,expect} from '@playwright/test';
// The Calendar title menu (Schedule / Day / Week / Month and calendar switches) owns focus while
// open; Escape, Back and a choice return focus to the title. Search takes focus; Back closes it
// (after lowering a half chat over it) and focus returns to the Search button.
for(const theme of ['light','dark'])for(const height of [915,420])test(`views menu owns keyboard focus ${theme} ${height}`,async({page},info)=>{
 await page.setViewportSize({width:412,height});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?theme='+theme);await page.getByRole('button',{name:'Calendar',exact:true}).click();
 const trigger=page.getByRole('button',{name:'Calendar views',exact:true});await expect(trigger).toHaveAttribute('aria-haspopup','dialog');await trigger.click();
 const dialog=page.getByRole('dialog',{name:'Views and calendars'});await expect(dialog).toBeVisible();await expect(page.locator('[data-alpha-layer="pill"]')).toBeHidden();await expect(page.locator('[data-alpha-layer="composer"]')).toBeHidden();
 await expect(page.getByRole('button',{name:'New event',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('radio')).toHaveText(['Schedule','Day','Week','Month']);await expect(dialog.getByRole('radio',{name:'Day',exact:true})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 const first=dialog.locator('button').first(),last=dialog.locator('button').last();await last.focus();await page.keyboard.press('Tab');await expect(first).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(last).toBeFocused();
 await page.screenshot({path:info.outputPath('views-menu.png')});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(page.getByRole('button',{name:'New event',exact:true})).toBeVisible();
 await trigger.click();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 // Month: a grid of days; a day opens Day view.
 await trigger.click();await dialog.getByRole('radio',{name:'Month',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 const month=page.locator('[data-alpha-calendar-month]');await expect(month).toBeVisible();await expect(page.getByRole('region',{name:'Calendar timeline',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Next month',exact:true}).click();await page.getByRole('button',{name:'Previous month',exact:true}).click();await page.screenshot({path:info.outputPath('month-view.png')});
 const day=month.getByRole('button',{name:/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /}).first();expect((await day.boundingBox())!.height).toBeGreaterThanOrEqual(44);await day.click();
 await expect(month).toHaveCount(0);await expect(page.getByRole('region',{name:'Calendar timeline',exact:true})).toBeVisible();
 // Search takes focus; Back closes it and focus returns to the Search button.
 const searchButton=page.getByRole('button',{name:'Search',exact:true});
 await searchButton.click();const search=page.getByRole('searchbox',{name:'Search events',exact:true});await expect(search).toBeFocused();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(search).toHaveCount(0);await expect(trigger).toBeVisible();await expect(searchButton).toBeFocused();
 // With the half chat over Search, Back lowers the chat first; the next Back closes Search.
 await searchButton.click();await expect(search).toBeFocused();
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
 await page.evaluate(()=>(document.activeElement as HTMLElement|null)?.blur());
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeHidden();await expect(search).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(search).toHaveCount(0);await expect(trigger).toBeVisible();
 await trigger.click();await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
});
