import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])for(const size of [{width:360,height:640},{width:740,height:360}])test(`Gmail attachment review retains exit and keyboard reading ${theme} ${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);await page.goto('/?theme='+theme);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  s.read=async()=>null;s.compareExchange=async()=>({status:'saved'});
  const name='Attachment'+'x'.repeat(100)+'.txt',text=Array.from({length:80},(_,i)=>`Line ${i}: <img src=x onerror=alert(1)> `+'content'.repeat(30)).join('\n');
  const message={id:'selected',threadId:'thread',from:'Fixture sender',to:['reader@example.test'],subject:'Selected attachment',snippet:'Review a long attachment',receivedAt:'2026-10-04T12:00:00Z',unread:false};
  const f=(window as any).attachmentFixture={reads:0,mutations:0,accounts:0};
  const client={gmailAccounts:async()=>{f.accounts++;if((f as any).revoked)return [];return [{connectionId:'fixture-grant',label:'Fixture mailbox',connected:true,grantedCapabilities:['google.gmail.triage']}];},gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false}),gmailSearch:async()=>({messages:[message],syncedAt:'1'}),gmailRead:async()=>({message,bodyText:'Choose the attachment below.',historyId:'1',attachments:[{partId:'part',name,mimeType:'text/plain',size:text.length,supported:true}]}),gmailAttachment:async()=>{f.reads++;return{name,text,mimeType:'text/plain',size:text.length,sha256:'a'.repeat(64)};},gmailPrepareOperation:async()=>{f.mutations++;throw Error('No provider writes allowed');}};
  c.getCloudClient=()=>({client,sessionId:'fixture-session'} as any);const snapshot={...c.getSnapshot(),session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-agent-session',origin:'https://agent.invalid'},cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByText('Selected attachment',{exact:true}).click();await page.getByText(/^Attachmentx+\.txt$/).click();
 await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 const dialog=page.getByRole('dialog',{name:'Review attachment'}),content=dialog.getByRole('region',{name:'Attachment contents'}),back=dialog.getByRole('button',{name:'Back to message',exact:true});
 await expect(back).toBeFocused();
 await expect(page.getByRole('button',{name:'Back to inbox',exact:true})).toHaveCount(0);
 await content.focus();await page.keyboard.press('Tab');await expect(back).toBeFocused();
 await expect(content).toBeVisible();await expect(content).toHaveCSS('font-size','24px');await expect(back).toBeInViewport();// The desktop phone preview is scaled; target geometry is measured in its CSS coordinate space.
 expect(await back.evaluate(el=>el.clientHeight)).toBeGreaterThanOrEqual(44);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await content.focus();await page.keyboard.press('End');await expect.poll(()=>content.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await expect(back).toBeInViewport();await expect(content.locator('img')).toHaveCount(0);await expect(content).toContainText('<img src=x onerror=alert(1)>');
 const accountReads=await page.evaluate(()=>(window as any).attachmentFixture.accounts);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>page.evaluate(()=>(window as any).attachmentFixture.accounts)).toBeGreaterThan(accountReads);
 await page.screenshot({path:info.outputPath('gmail-attachment-review.png')});await back.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:/Attachmentx+\.txt/})).toBeFocused();await expect(page.getByText('Choose the attachment below.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).attachmentFixture)).toMatchObject({reads:1,mutations:0});
 const share=page.getByRole('button',{name:/Review email with agent/});await share.click();
 const review=page.getByRole('dialog',{name:'Review email sharing',exact:true});
 await expect(review.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await expect(page.getByRole('button',{name:'Back to inbox',exact:true})).toHaveCount(0);
 await page.keyboard.press('Shift+Tab');await expect(review.getByRole('button',{name:'Send reviewed email to agent',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(review).toHaveCount(0);await expect(share).toBeFocused();
 expect(await page.evaluate(()=>(window as any).attachmentFixture.mutations)).toBe(0);
 if(theme==='light'&&size.height===640){await page.evaluate(()=>{(window as any).attachmentFixture.revoked=true;window.dispatchEvent(new Event('focus'));});await expect(page.getByText('Choose the attachment below.',{exact:true})).toHaveCount(0);await expect(page.getByText('Connect Gmail to read your inbox',{exact:true})).toBeVisible();}
});
