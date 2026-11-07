import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
for(const app of ['Files','Photos'])test(`${app} composes an editable question and sends only after review`,async({page})=>{
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();await returnToApps(page);await page.getByRole('button',{name:app,exact:true}).click();if(app==='Photos'){
  await page.getByRole('button',{name:'Search photos',exact:true}).click();
  await page.getByRole('textbox',{name:'Search photos',exact:true}).fill('mountain trip');
  await page.getByRole('button',{name:'Ask Alpha: “mountain trip”',exact:true}).click();
 }else{
  await expect(page.getByRole('button',{name:'Search files',exact:true})).toHaveCount(0);
  await page.getByRole('group',{name:'Assistant controls'}).getByRole('button',{name:'Type',exact:true}).click();
 }
 const composer=page.getByRole('textbox',{name:app==='Files'?'Ask Alpha':'Message Alpha',exact:true});
 if(app==='Files')await composer.fill('Find the file mountain trip');
 await expect(composer).toHaveValue(app==='Files'?'Find the file mountain trip':'mountain trip');
 expect(await page.evaluate(async()=>(await (await import('/src/browser/development-agent-document.ts')).readDevelopmentAgent((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).conversations.flatMap((c:any)=>c.messages))).toEqual([]);
 await composer.fill('Reviewed search question');await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>(await (await import('/src/browser/development-agent-document.ts')).readDevelopmentAgent((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).conversations.flatMap((c:any)=>c.messages).filter((m:any)=>m.role==='user').map((m:any)=>m.text.split('[USER MESSAGE]\n')[1]))).toEqual(['Reviewed search question']);
});
test('Home attention opens the local Inbox and tracks unread mail through reload',async({page})=>{
 await page.addInitScript(()=>{if(!localStorage.getItem('alpha.dev.app.inbox'))localStorage.setItem('alpha.dev.app.inbox',JSON.stringify({mails:[{id:'visible',name:'Reader',ini:'R',email:'reader@example.test',acct:'personal',k:1,time:'Now',unread:true,subj:'Visible unread',body:'Local body'},{id:'archived',name:'Reader',ini:'R',acct:'personal',unread:true,arch:true,subj:'Archived unread'},{id:'deleted',name:'Reader',ini:'R',acct:'personal',unread:true,del:true,subj:'Deleted unread'}],sent:[],localDrafts:[]}));});
 await page.goto('/?mode=dev');const attention=page.getByRole('button',{name:'Open Inbox: 1 unread email',exact:true});await expect(attention).toContainText('1');await attention.click();await page.getByRole('button',{name:'Unread, Reader, Visible unread',exact:true}).click();await expect(page.getByText('Local body',{exact:true}).last()).toBeVisible();await returnToApps(page);await expect(page.locator('[data-alpha-layer="home"] [data-alpha-home-inbox]')).toHaveCount(0);
 // A fully read mailbox collapses its attention card, while the app tile remains.
 await page.reload();const inbox=page.getByRole('button',{name:'Inbox',exact:true});await expect(inbox).toBeVisible();
 await expect(page.locator('[data-alpha-layer="home"] [data-alpha-home-inbox]')).toHaveCount(0);
 await inbox.click();await expect(page.getByRole('button',{name:'Reader, Visible unread',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Unread, Reader, Visible unread',exact:true})).toHaveCount(0);
});
