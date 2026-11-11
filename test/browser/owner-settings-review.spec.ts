import {test,expect} from '@playwright/test';
import {returnToApps} from './app-navigation';

test('Settings category state matches the selected context and resets on a fresh visit',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 const current=()=>page.locator('[data-settings-page]:not([inert])').last();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await current().getByRole('button',{name:'Apps',exact:true}).click();
 await current().getByRole('button',{name:'Calendar',exact:true}).click();
 await page.getByRole('button',{name:'Back to Apps',exact:true}).click();
 await expect(current().getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context?.selectedObject)).toEqual({kind:'settings',id:'settings-apps'});
 await returnToApps(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(current()).toHaveAttribute('data-settings-page','Settings');
 await expect(current().getByRole('button',{name:'Apps',exact:true})).toBeVisible();
 await expect(current().getByRole('button',{name:'Calendar',exact:true})).toHaveCount(0);
});

for(const size of [{width:390,height:844},{width:1280,height:900}]){
 test(`grouped Settings and signed-out Account fit at ${size.width}`,async({page},info)=>{
  await page.setViewportSize(size);
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/?mode=dev');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.locator('[data-settings-page="Settings"]:not([inert])');
  await expect(settings).toBeVisible();
  for(const label of ['General','Privacy','Apps','About'])await expect(settings.getByRole('button',{name:label,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'General',exact:true}).click();
  await expect(settings.getByRole('button',{name:'Models',exact:true})).toHaveCount(0);
  const current=()=>page.locator('[data-settings-page]:not([inert])').last();
  const display=current().getByRole('button',{name:'Display',exact:true});
  await display.focus();await display.press('Enter');
  const back=page.getByRole('button',{name:'Back to General',exact:true});
  await expect(back).toBeFocused();
  await back.press('Enter');await expect(display).toBeFocused();
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await settings.getByRole('button',{name:'Privacy',exact:true}).click();
  const review=current().getByRole('switch',{name:'Ask before Alpha acts',exact:true});
  await expect(review).toHaveAttribute('aria-checked','false');
  expect(await review.evaluate(element=>({width:(element as HTMLElement).offsetWidth,height:(element as HTMLElement).offsetHeight}))).toEqual({width:52,height:52});
  const target=await review.boundingBox();expect(target!.width).toBeGreaterThanOrEqual(44);expect(target!.height).toBeGreaterThanOrEqual(44);
  await review.focus();await review.press('Space');await expect(review).toHaveAttribute('aria-checked','true');
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await page.getByRole('button',{name:'Account',exact:true}).filter({visible:true}).click();
  const account=page.getByRole('dialog',{name:'Alpha',exact:true});
  await expect(account).toBeVisible();
  await expect(settings.getByRole('button',{name:'Account & plan',exact:true})).toHaveCount(0);
  const box=(await account.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);
  expect(box.y+box.height).toBeLessThanOrEqual(size.height+1);
  await page.screenshot({path:info.outputPath('account-sign-in.png')});
  await account.getByRole('button',{name:'Back',exact:true}).click();
  await expect(account).toHaveCount(0);
  await settings.getByRole('button',{name:'About',exact:true}).click();
  await expect(current().getByRole('button',{name:'Licenses',exact:true})).toBeVisible();
  await expect(page.getByText('Agent execution',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await expect(settings).toBeVisible();
  await page.screenshot({path:info.outputPath('grouped-settings.png')});
 });
}
