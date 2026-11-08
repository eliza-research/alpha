import {test,expect} from '@playwright/test';

for(const size of [{width:390,height:844},{width:1280,height:900}]){
 test(`grouped Settings and connection sheets fit at ${size.width}`,async({page},info)=>{
  await page.setViewportSize(size);
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/?mode=dev');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.locator('[data-settings-page="Settings"]:not([inert])');
  await expect(settings).toBeVisible();
  for(const heading of ['Account','Preferences','Privacy','Help'])await expect(settings.getByText(heading,{exact:true})).toBeVisible();
  for(const label of ['Account & plan','Google & email','AI connection','Connection help'])await expect(settings.getByRole('button',{name:label,exact:true})).toBeVisible();
  await expect(settings.getByRole('button',{name:'Models',exact:true})).toHaveCount(0);
  const display=settings.getByRole('button',{name:'Display',exact:true});
  await display.focus();await display.press('Enter');
  const back=page.getByRole('button',{name:'Back to Settings',exact:true});
  await expect(back).toBeFocused();
  await back.press('Enter');await expect(display).toBeFocused();
  await settings.getByRole('button',{name:'AI connection',exact:true}).click();
  const provider=page.getByRole('dialog',{name:'AI connection',exact:true});
  await expect(provider).toBeVisible();
  const box=(await provider.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);
  expect(box.y+box.height).toBeLessThanOrEqual(size.height+1);
  await page.screenshot({path:info.outputPath('provider-sheet.png')});
  await provider.getByRole('button',{name:'Close AI connection settings',exact:true}).click();
  await expect(provider).toHaveCount(0);
  await settings.getByRole('button',{name:'Google & email',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Google & email',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await settings.getByRole('button',{name:'About',exact:true}).click();
  await expect(page.getByText('Agent execution',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await expect(settings).toBeVisible();
  await page.screenshot({path:info.outputPath('grouped-settings.png')});
 });
}
