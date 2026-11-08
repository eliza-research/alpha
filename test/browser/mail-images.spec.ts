import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,html:boolean|string=true,extraUrls:string[]=[]){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async ({html,extraUrls})=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const message={id:'image-mail',threadId:'thread',subject:'Image fixture',from:'Sender',fromEmail:'sender@example.test',to:['owner@example.test'],cc:[],replyTo:null,snippet:'Preview',receivedAt:'2026-10-06T12:00:00Z',unread:false};
  const client={gmailAccounts:async()=>[{connectionId:'grant',label:'owner@example.test',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailInboxCapabilities:async()=>({from:'owner@example.test',send:false,readState:false}),gmailSearch:async()=>({messages:[message],syncedAt:'sync',nextPageToken:null}),gmailRead:async()=>({message,bodyText:['Read https://example.invalid/read',...extraUrls].join(' '),bodyHtml:typeof html==='string'?html:html?'<p>Formatted content</p><img src="https://images.invalid/product.png" alt="Product"><a href="https://example.invalid/read">Read more</a><script>parent.mailInjected=true</script>':undefined,links:[{href:'https://example.invalid/read',text:'Read more'},...extraUrls.map(href=>({href,text:href}))],attachments:[]})};
  c.getCloudClient=()=>({client,sessionId:'mail-fixture',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'mail-owner',sessionId:'mail-fixture',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 },{html,extraUrls});
}
async function openMail(page:Page){await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByText('Image fixture',{exact:true}).click();}
async function imageSetting(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Connections',exact:true}).click();return page.getByRole('button',{name:'Automatically load email images',exact:true});}
test('HTML email loads images by default, keeps inline links isolated, and saved opt-out survives reload',async({page})=>{
 let imageRequests=0;
 await page.route('https://images.invalid/**',route=>{imageRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64')});});
 await setup(page);await openMail(page);
 const frame=page.frameLocator('iframe[title="Formatted email"]');
 await expect(frame.getByRole('img',{name:'Product'})).toBeVisible();await expect.poll(()=>imageRequests).toBeGreaterThan(0);
 await expect(page.getByRole('group',{name:'Links in this email'})).toHaveCount(0);
 await expect(frame.getByRole('link',{name:'Read more'})).toBeVisible();
 const review=page.waitForEvent('dialog').then(async dialog=>{expect(dialog.message()).toContain('Site: example.invalid');await dialog.dismiss();});await frame.getByRole('link',{name:'Read more'}).click();await review;
 await expect(page.locator('iframe[title="Formatted email"]')).toHaveAttribute('sandbox','allow-same-origin');
 expect(await page.evaluate(()=>(window as any).mailInjected)).toBeUndefined();
 const toggle=await imageSetting(page);await expect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');
 const beforeOptOut=imageRequests;await page.reload();await setup(page);await openMail(page);
 await expect(page.getByRole('button',{name:'Show images',exact:true})).toBeVisible();
 await expect(frame.getByRole('img',{name:'Product'})).toHaveCount(0);expect(imageRequests).toBe(beforeOptOut);
 await page.getByRole('button',{name:'Show images',exact:true}).click();await expect(frame.getByRole('img',{name:'Product'})).toBeVisible();
 expect(await page.evaluate(async()=>(await (await import('/src/browser/device-preferences.ts')).readDevicePreferences()).autoLoadMailImages)).toBe(false);
});
test('plain-text email retains its reviewed link controls',async({page})=>{
 await setup(page,false);await openMail(page);await expect(page.getByRole('group',{name:'Links in this email'})).toBeVisible();await expect(page.getByRole('button',{name:'Read more (example.invalid)',exact:true})).toBeVisible();await expect(page.locator('iframe[title="Formatted email"]')).toHaveCount(0);
});

test('HTML with an unlinked URL retains its reviewed fallback',async({page})=>{
 await setup(page,'<p>Visit https://example.invalid/read</p>');await openMail(page);
 await expect(page.frameLocator('iframe[title="Formatted email"]').getByText('Visit https://example.invalid/read')).toBeVisible();
 await expect(page.getByRole('group',{name:'Links in this email'})).toBeHidden();
 await page.getByText('Other links (1)',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Read more (example.invalid)',exact:true})).toBeVisible();
});
test('HTML only removes fallback URLs already represented by inline anchors',async({page})=>{
 await setup(page,'<a href="https://example.invalid/read">Read more</a><p>Visit https://extra.invalid/read</p>',['https://extra.invalid/read','https://provider.invalid/only']);await openMail(page);
 await expect(page.frameLocator('iframe[title="Formatted email"]').getByRole('link',{name:'Read more'})).toBeVisible();
 const fallback=page.getByRole('group',{name:'Links in this email'});
 await expect(fallback).toBeHidden();await page.getByText('Other links (2)',{exact:true}).click();
 await expect(fallback.getByRole('button')).toHaveCount(2);
 await expect(fallback.getByRole('button',{name:'Read more (example.invalid)',exact:true})).toHaveCount(0);
 await expect(fallback.getByRole('button',{name:'extra.invalid',exact:true})).toBeVisible();
 await expect(fallback.getByRole('button',{name:'provider.invalid',exact:true})).toBeVisible();
});
