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
async function imageSetting(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await page.getByRole('button',{name:'Settings',exact:true}).click();const current=()=>page.locator('[data-settings-page]:not([inert])').last();await current().getByRole('button',{name:'Apps',exact:true}).click();await current().getByRole('button',{name:'Inbox',exact:true}).click();return current().getByRole('button',{name:'Load images in email',exact:true});}
test('HTML email loads images across reloads and retains isolated inline links',async({page})=>{
 let imageRequests=0;
 await page.route('https://images.invalid/**',route=>{imageRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP4/x8AAwAB/2+Bq7YAAAAASUVORK5CYII=','base64')});});
 await setup(page);await openMail(page);
 const frame=page.frameLocator('iframe[title="Formatted email"]');
 await expect(frame.getByRole('img',{name:'Product'})).toBeVisible();await expect.poll(()=>imageRequests).toBeGreaterThan(0);
 await expect(page.getByRole('group',{name:'Links in this email'})).toHaveCount(0);
 await expect(frame.getByRole('link',{name:'Read more'})).toBeVisible();
 await expect(page.locator('iframe[title="Formatted email"]')).toHaveAttribute('sandbox','allow-same-origin');
 expect(await page.evaluate(()=>(window as any).mailInjected)).toBeUndefined();
 await page.evaluate(async()=>{await (await import('/src/browser/device-preferences.ts')).editDevicePreferences(value=>{value.autoLoadMailImages=false;});});
 await page.reload();await setup(page);await openMail(page);
 await expect(frame.getByRole('img',{name:'Product'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Show images',exact:true})).toHaveCount(0);
 await frame.getByRole('link',{name:'Read more'}).click();
 await expect(page.getByRole('region',{name:'Browser',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit address',exact:true})).toContainText('example.invalid');
 const toggle=await imageSetting(page);await expect(toggle).toHaveCount(0);

});
test('plain-text email retains its reviewed link controls',async({page})=>{
 await setup(page,false);await openMail(page);await expect(page.getByRole('group',{name:'Links in this email'})).toBeVisible();await expect(page.getByRole('button',{name:'Read more (example.invalid)',exact:true})).toBeVisible();await expect(page.locator('iframe[title="Formatted email"]')).toHaveCount(0);
});

test('Conversation pages load images without a separate image control',async({page})=>{
 const requests:string[]=[];
 await page.route('https://images.invalid/**',route=>{requests.push(route.request().url());return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP4/x8AAwAB/2+Bq7YAAAAASUVORK5CYII=','base64')});});
 await setup(page);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  await (await import('/src/browser/device-preferences.ts')).editDevicePreferences(value=>{value.autoLoadMailImages=false;});
  const client=c.getCloudClient()!.client as any,read=client.gmailRead;
  client.gmailInboxCapabilities=async()=>({version:1,from:'owner@example.test',threads:true,send:false,providerDrafts:false,mailboxMutations:false,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false});
  client.gmailThread=async(_grant:string,_thread:string,_signal:AbortSignal,page?:{offset:number})=>{
   const first=await read(),offset=page?.offset??0;
   const body=offset?{...first,message:{...first.message,id:'second-image-mail',subject:'Next image fixture'},bodyHtml:'<p>Next message</p><img src="https://images.invalid/second.png" alt="Second product">'}:first;
   return {messages:[body],total:2,offset,historyId:'image-thread-history',nextOffset:offset?null:1};
  };
 });
 await openMail(page);
 await expect(page.frameLocator('iframe[title="Formatted email"]').getByRole('img',{name:'Product',exact:true})).toBeVisible();
 await expect.poll(()=>requests.length).toBeGreaterThan(0);
 await page.getByRole('button',{name:'More messages',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Next image fixture',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Show images',exact:true})).toHaveCount(0);
 await expect(page.frameLocator('iframe[title="Formatted email"]').getByRole('img',{name:'Second product',exact:true})).toBeVisible();
 await expect.poll(()=>requests.some(url=>url.endsWith('/second.png'))).toBe(true);
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
