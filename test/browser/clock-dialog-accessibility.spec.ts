import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])test(`${theme} Clock review owns focus and leaves no hidden modal on Home`,async({page})=>{
 await page.goto(`/?mode=mock&shell=launcher&theme=${theme}`);
 await page.getByRole('button',{name:'Workflows',exact:true}).click();
 const opener=page.getByRole('button',{name:'Clock alarms',exact:true});await opener.click();
 const dialog=page.getByRole('dialog',{name:'Clock alarms',exact:true});
 await expect(dialog.getByRole('button',{name:'Close Clock',exact:true})).toBeFocused();
 await expect(page.getByRole('button',{name:'New automation',exact:true})).toHaveCount(0);
 await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Review Clock request',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 await opener.click();await dialog.getByRole('button',{name:'Review Clock request',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Confirm Clock request',exact:true})).toBeVisible();
 // Mock mode has no resident-agent native event bridge; exercise the shell Home handler.
 await page.locator('button[aria-label="Home"]').dispatchEvent('click');
 await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Workflows',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await opener.click();await expect(dialog.getByRole('button',{name:'Confirm Clock request',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(dialog).toHaveCount(0);await expect(page.getByRole('region',{name:'Workflows',exact:true})).toBeVisible();await expect(opener).toBeFocused();
});

for(const theme of ['light','dark'])test(`${theme} app Alarms separates saved records from the new form without opening an alarm`,async({page},info)=>{
 await page.setViewportSize({width:360,height:640});await page.clock.setFixedTime(new Date('2027-06-01T06:00:00Z'));
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(`/?mode=dev&theme=${theme}`);await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Clock alarms',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Clock alarms',exact:true}),cancel=dialog.getByRole('button',{name:'Cancel',exact:true}),save=dialog.getByRole('button',{name:'Save alarm',exact:true});
 await expect(dialog.getByRole('heading',{name:'Alarms',exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Saved alarms',exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'New alarm',exact:true})).toBeVisible();await expect(dialog.getByText('No alarms',{exact:true})).toBeVisible();await expect(cancel).toBeFocused();
 await dialog.getByLabel('Alarm time',{exact:true}).fill('23:59');await dialog.getByLabel('Alarm label',{exact:true}).fill('Future appointment');
 const footer=dialog.locator('footer');await expect(footer.getByRole('button').nth(0)).toHaveText('Cancel');await expect(footer.getByRole('button').nth(1)).toHaveText('Save alarm');
 for(const button of [cancel,save]){const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x+box!.width).toBeLessThanOrEqual(360);}
 expect(await save.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');await page.screenshot({path:info.outputPath('alarms-new-form.png'),animations:'disabled'});
 await cancel.click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('DailyApps').listReminders()).reminders.filter((row:any)=>row.id.startsWith('alarm_')).length;})).toBe(0);
 await page.getByRole('button',{name:'Clock alarms',exact:true}).click();await dialog.getByLabel('Alarm time',{exact:true}).fill('23:59');await dialog.getByLabel('Alarm label',{exact:true}).fill('Future appointment');await save.click();await expect(dialog.getByText('Future appointment',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Delete Future appointment',exact:true})).toBeVisible();await expect(dialog.getByText('Ringing',{exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('alarms-saved.png'),animations:'disabled'});
});
