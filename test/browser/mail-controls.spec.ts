import {test,expect} from '@playwright/test';
test('compact and expanded assistant controls expose one voice mic without a duplicate dictation launcher',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 const pill=page.locator('[data-alpha-layer="pill"]');await expect(pill).toBeVisible();
 await expect(pill.getByRole('button')).toHaveCount(3);await expect(pill.getByRole('button',{name:'Transcribe',exact:true})).toHaveCount(0);
 await pill.getByRole('button',{name:'Type',exact:true}).click();
 await expect(page.getByRole('button',{name:'Transcribe',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Talk',exact:true})).toHaveCount(1);
 await expect(page.locator('textarea[data-alpha-composer]')).toBeVisible();
});
test('Folder menu supports keyboard and native Back; local Drafts needs no provider drafts',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const client={gmailAccounts:async()=>[{connectionId:'controls-grant',label:'owner@example.test',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailSearch:async()=>({messages:[],syncedAt:'sync',nextPageToken:null}),gmailInboxCapabilities:async()=>({from:'owner@example.test',send:false,readState:false})};
  c.getCloudClient=()=>({client,sessionId:'controls-session',credentialId:'fixture'} as any);const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'controls-owner',sessionId:'controls-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();const folders=page.getByRole('button',{name:'Other mail folders',exact:true});await expect(folders).toBeVisible();
 const metrics=await folders.evaluate(el=>({appearance:getComputedStyle(el).appearance,height:el.getBoundingClientRect().height,paddingRight:parseFloat(getComputedStyle(el).paddingRight)}));

 // Chromium layout transforms can introduce subpixel floating-point rounding.
 expect(metrics.height).toBeCloseTo(44,4);
 expect(await folders.evaluate(el=>el.getBoundingClientRect().right<=document.querySelector('[data-screen]')!.getBoundingClientRect().right-8)).toBe(true);
 await folders.press('ArrowDown');await expect(page.getByRole('menuitemradio',{name:'Starred',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(folders).toBeFocused();
 await folders.click();await expect(page.getByRole('menu',{name:'Mail folders',exact:true})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(page.getByRole('menu',{name:'Mail folders',exact:true})).toBeHidden();await expect(page.locator('html')).toHaveAttribute('data-active-view','inbox');await expect(folders).toBeFocused();await folders.click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();await expect(page.getByRole('heading',{name:'Drafts',exact:true})).toBeVisible();await expect(page.getByText('Local drafts',{exact:true})).toBeVisible();
});
