import {test,expect} from '@playwright/test';

for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 test(`selected Settings navigation and preferences persist at ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  const open=async()=>{await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();};
  const panel=(name:string)=>page.locator(`[data-settings-page="${name}"]:not([inert])`);
  await open();
  const root=panel('Settings');
  for(const label of ['Account','General','Privacy','Apps','Help'])await expect(root.getByRole('button',{name:label,exact:true})).toBeVisible();
  await expect(root.getByText('Voice & personality',{exact:true})).toHaveCount(0);
  await root.getByRole('button',{name:'Account',exact:true}).click();
  await expect(panel('Account')).toBeVisible();
  await expect(panel('Account').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await root.getByRole('button',{name:'General',exact:true}).click();
  await panel('General').getByRole('button',{name:'Display',exact:true}).click();
  await expect(panel('Display').getByRole('slider')).toHaveCount(0);
  await panel('Display').getByRole('button',{name:'Text size: Large',exact:true}).click();
  await expect(panel('Display').getByRole('button',{name:'Text size: Large, selected',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to General',exact:true}).click();
  await panel('General').getByRole('button',{name:'Notifications',exact:true}).click();
  const alerts=panel('Notifications').getByRole('button',{name:'Allow alerts',exact:true});
  const before=await alerts.getAttribute('aria-pressed');
  await alerts.click();
  await expect(alerts).toHaveAttribute('aria-pressed',before==='true'?'false':'true');
  await expect(page.locator('[data-browser-settings]')).toHaveCount(0);
  await open();
  await root.getByRole('button',{name:'General',exact:true}).click();
  await panel('General').getByRole('button',{name:'Display',exact:true}).click();
  await expect(panel('Display').getByRole('button',{name:'Text size: Large, selected',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to General',exact:true}).click();
  await panel('General').getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(panel('Notifications').getByRole('button',{name:'Allow alerts',exact:true})).toHaveAttribute('aria-pressed',before==='true'?'false':'true');
  await page.getByRole('button',{name:'Back to General',exact:true}).click();
  await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
  await root.getByRole('button',{name:'Apps',exact:true}).click();
  await panel('Apps').getByRole('button',{name:'Inbox',exact:true}).click();
  await panel('Inbox').getByRole('button',{name:'Google & email',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'Google accounts',exact:true});
  await expect(manager).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const box=(await manager.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);
  expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
 });
}
