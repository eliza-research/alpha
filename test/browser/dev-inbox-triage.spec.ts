import {chooseMailAction} from './helpers/mail-actions.ts';
import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
const bytes=Buffer.from('Forwarded original\r\nCafé');
test.beforeEach(async({page})=>{
 await page.addInitScript(({dataBase64,sha256})=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  if(!localStorage.getItem('alpha.dev.app.inbox'))localStorage.setItem('alpha.dev.app.inbox',JSON.stringify({mails:[
   {id:'one',name:'Sender One',email:'one@example.test',subj:'Planning notes',body:'Meeting context',acct:'personal',unread:true,k:2,time:'Today',atts:[{name:'original.txt',mimeType:'text/plain',dataBase64,sha256,size:'26 bytes',browserAttachment:true}]},
   {id:'two',name:'Sender Two',email:'two@example.test',subj:'Travel details',body:'Train times',acct:'personal',unread:true,k:1,time:'Today'}],sent:[],localDrafts:[]}));
 },{dataBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')});
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Inbox',exact:true}).click();
});
async function stored(page:any){return page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!));}
test('search, archive, undo and delete preserve their local state through reload',async({page})=>{
 await page.getByRole('button',{name:'Search email',exact:true}).click();await page.getByRole('searchbox',{name:'Search mail',exact:true}).fill('Train times');
 await expect(page.getByRole('button',{name:/Sender Two, Travel details/})).toBeVisible();await expect(page.getByRole('button',{name:/Sender One, Planning notes/})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to inbox',exact:true}).click();await page.getByRole('button',{name:/Sender One, Planning notes/}).click();
 await chooseMailAction(page, 'Archive');expect((await stored(page)).mails[0].arch).toBe(true);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await stored(page)).mails[0].arch).not.toBe(true);
 await chooseMailAction(page, 'Move to Trash');expect((await stored(page)).mails[0].del).toBe(true);
 await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:/Sender One, Planning notes/})).toHaveCount(0);await expect(page.getByRole('button',{name:/Sender Two, Travel details/})).toBeVisible();
});
test('reply saves its source identity and sending marks only that source as replied',async({page})=>{
 await page.getByRole('button',{name:/Sender One, Planning notes/}).click();await chooseMailAction(page, 'Reply');await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Re: Planning notes');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Local reply');await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Restore local draft',exact:true}).click();await page.getByRole('button',{name:'Send email',exact:true}).click();
 const data=await stored(page);expect(data.sent[0]).toMatchObject({to:['one@example.test'],subj:'Re: Planning notes',body:'Local reply'});expect(data.mails[0]).toMatchObject({unread:false,replied:true});expect(data.mails[1].replied).toBeUndefined();
});
test('forward retains reviewed attachment bytes and requires a chosen recipient',async({page})=>{
 await page.getByRole('button',{name:/Sender One, Planning notes/}).click();await chooseMailAction(page, 'Forward');await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Fwd: Planning notes');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toContainText('Meeting context');await page.getByRole('button',{name:'Send email',exact:true}).click();expect((await stored(page)).sent).toEqual([]);
 await page.getByRole('textbox',{name:'To',exact:true}).fill('forward@example.test');await page.getByRole('button',{name:'Send email',exact:true}).click();const data=await stored(page);expect(data.sent[0].to).toEqual(['forward@example.test']);expect(Buffer.from(data.sent[0].atts[0].dataBase64,'base64')).toEqual(bytes);expect(data.mails[0].replied).toBeUndefined();
});

test('sending a separate message preserves an earlier saved draft',async({page})=>{
 await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'To',exact:true}).fill('saved@example.test');await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Retain this draft');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button',{name:'Back from draft',exact:true}).click();
 await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'To',exact:true}).fill('other@example.test');await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Separate message');await page.getByRole('button',{name:'Send email',exact:true}).click();
 expect((await stored(page)).localDrafts.map((d:any)=>d.subject)).toEqual(['Retain this draft']);await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Restore local draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Retain this draft');
});

test('multiple drafts retain identity and discarding one keeps the other',async({page})=>{
 for(const subject of ['First draft','Second draft']){await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'Subject',exact:true}).fill(subject);await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button',{name:'Back from draft',exact:true}).click();}
 const before=await stored(page);expect(before.localDrafts).toHaveLength(2);expect(new Set(before.localDrafts.map((d:any)=>d.localDraftId)).size).toBe(2);
 await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Restore draft 1: First draft',exact:true}).click();await page.getByRole('button',{name:'Discard draft',exact:true}).click();await page.getByRole('dialog',{name:'Discard draft?',exact:true}).getByRole('button',{name:'Discard draft',exact:true}).click();
 expect((await stored(page)).localDrafts.map((d:any)=>d.subject)).toEqual(['Second draft']);await page.getByRole('button',{name:'Restore local draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Second draft');
});
test('an older draft receives an identity on restore and saving it does not create a duplicate',async({page})=>{
 await page.evaluate(()=>{const key='alpha.dev.app.inbox',data=JSON.parse(localStorage.getItem(key)!);data.localDrafts=[{to:['legacy@example.test'],subject:'Legacy draft',body:'Before identities'}];localStorage.setItem(key,JSON.stringify(data));});await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Restore local draft',exact:true}).click();const id=(await stored(page)).localDrafts[0].localDraftId;expect(typeof id).toBe('string');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Updated legacy');await page.getByRole('button',{name:'Save draft',exact:true}).click();const drafts=(await stored(page)).localDrafts;expect(drafts).toHaveLength(1);expect(drafts[0]).toMatchObject({localDraftId:id,body:'Updated legacy'});
});
