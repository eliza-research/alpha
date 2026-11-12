import {retainedMailDraft} from './helpers/retained-mail-draft';
import {chooseMailAction} from './helpers/mail-actions.ts';
import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await page.getByRole('button',{name:'Inbox',exact:true}).click();});
test('local Inbox saves and restores attachment drafts then sends and opens the same bytes after reload',async({page},testInfo)=>{
 const external:string[]=[];page.on('request',r=>{if(!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)&&/^https?:/.test(r.url()))external.push(r.url());});
 await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'To',exact:true}).fill('reader@example.test');await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'Remove reader@example.test',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Local attachment journey');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Saved body');await page.getByRole('button',{name:'Cc and Bcc',exact:true}).click();await page.getByRole('textbox',{name:'Cc',exact:true}).fill('copy@example.test');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach file',exact:true}).click();await (await chooser).setFiles({name:'local-letter.txt',mimeType:'text/plain',buffer:Buffer.from('Café\r\nExact local bytes')});await expect(page.getByRole('button',{name:'Remove local-letter.txt',exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('local-inbox-draft.png')});await retainedMailDraft(page,'save');await expect.poll(()=>retainedMailDraft(page,'status')).toMatch(/^Saved locally/);await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Restore local draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Local attachment journey');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Saved body');await expect(page.getByRole('button',{name:'Remove local-letter.txt',exact:true})).toBeVisible();await page.getByRole('button',{name:'Send email',exact:true}).click();await expect(page.getByText('Sent locally',{exact:true})).toBeVisible();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!));expect(saved.localDrafts).toEqual([]);expect(saved.sent[0]).toMatchObject({to:['reader@example.test'],cc:['copy@example.test'],subj:'Local attachment journey'});expect(Buffer.from(saved.sent[0].atts[0].dataBase64,'base64').toString()).toBe('Café\r\nExact local bytes');await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Sent',exact:true}).click();await page.getByText('Local attachment journey',{exact:true}).click();await page.getByText('local-letter.txt',{exact:true}).click();await expect(page.getByRole('dialog',{name:'Reviewed attachment'})).toContainText('Exact local bytes');expect(external).toEqual([]);
});
test('failed local send retains the composer and does not duplicate a retry',async({page})=>{
 await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'To',exact:true}).fill('reader@example.test');await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'Remove reader@example.test',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Retry local send');await page.evaluate(()=>{const original=Storage.prototype.setItem;(window as any).restore=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(key,value){if(key==='alpha.dev.app.inbox')throw Error('Full');return original.call(this,key,value);};});await page.getByRole('button',{name:'Send email',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Retry local send');await expect(page.getByText('Sent locally',{exact:true})).toHaveCount(0);await page.evaluate(()=>(window as any).restore());await page.getByRole('button',{name:'Send email',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).sent.filter((m:any)=>m.subj==='Retry local send').length)).toBe(1);
});
test('draft save retains an unsubmitted address and discard requires its explicit confirmation',async({page})=>{
 await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'To',exact:true}).fill('draft@example.test');await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Keep draft');await retainedMailDraft(page,'save');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).localDrafts[0].to)).toEqual(['draft@example.test']);await retainedMailDraft(page,'discard');const review=page.getByRole('dialog',{name:'Discard this draft?'});await review.getByRole('button',{name:'No',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Keep draft');await retainedMailDraft(page,'discard');await review.getByRole('button',{name:'Yes',exact:true}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).localDrafts)).toEqual([]);await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveCount(0);
});

test('malformed recipient chips cannot be saved or sent locally',async({page})=>{
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'To',exact:true}).fill('bad,extra@example.test');
 await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Invalid recipient');
 await retainedMailDraft(page,'save');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')||'{}').localDrafts||[])).toEqual([]);
 await page.getByRole('button',{name:'Send email',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Invalid recipient');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')||'{}').sent||[])).toEqual([]);
});

test('a selected contact remains a valid local recipient after draft reload',async({page})=>{
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('button',{name:/Maya Chen.*@/}).click();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Contact recipient');
 await retainedMailDraft(page,'save');
 await expect.poll(()=>retainedMailDraft(page,'status')).toMatch(/^Saved locally/);
 await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Restore local draft',exact:true}).click();
 await page.getByRole('button',{name:'Send email',exact:true}).click();
 await expect(page.getByText('Sent locally',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).sent[0].to)).toEqual(['maya']);
});
test('local reply, forward, archive undo and search retain mailbox state',async({page})=>{
 await page.getByText('Dinner Friday?',{exact:true}).click();await chooseMailAction(page, 'Reply');await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Re: Dinner Friday?');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Local reply');await page.getByRole('button',{name:'Send email',exact:true}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).mails.find((m:any)=>m.id===4).replied)).toBe(true);await chooseMailAction(page, 'Archive');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).mails.find((m:any)=>m.id===4).arch)).toBe(true);await page.getByRole('button',{name:'Undo',exact:true}).click();await chooseMailAction(page, 'Forward');await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Fwd: Dinner Friday?');await page.getByRole('textbox',{name:'To',exact:true}).fill('forward@example.test');await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');await page.getByRole('button',{name:'Send email',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Search email',exact:true}).click();await page.getByRole('searchbox',{name:'Search mail',exact:true}).fill('Dinner Friday');await expect(page.getByText('Dinner Friday?',{exact:true})).toBeVisible();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!));expect(saved.sent).toHaveLength(2);expect(saved.sent[0].body).toContain('tacos');expect(saved.mails.find((m:any)=>m.id===4).arch).toBeFalsy();
});

test('editing a saved draft replaces its saved status with an unsaved notice',async({page})=>{
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Saved subject');
 await retainedMailDraft(page,'save');
 await expect.poll(()=>retainedMailDraft(page,'status')).toMatch(/^Saved locally/);
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Unsaved subject');
 await expect.poll(()=>retainedMailDraft(page,'status')).toBe('Unsaved local draft');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).localDrafts[0].subject)).toBe('Saved subject');
});
