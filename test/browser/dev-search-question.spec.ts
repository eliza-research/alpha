import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
for(const app of ['Files','Photos'])test(`${app} uses the assistant composer and sends a search only after review`,async({page})=>{
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();await returnToApps(page);await page.getByRole('button',{name:app,exact:true}).click();await page.getByRole('button',{name:'Type',exact:true}).click();const composer=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await composer.fill('Find mountain trip '+app.toLowerCase());
 await expect(page.getByRole('button',{name:'Search '+app.toLowerCase(),exact:true})).toHaveCount(0);
 await expect(composer).toHaveValue('Find mountain trip '+app.toLowerCase());
 expect(await page.evaluate(async()=>(await (await import('/src/browser/development-agent-document.ts')).readDevelopmentAgent((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).conversations.flatMap((c:any)=>c.messages))).toEqual([]);
 await composer.fill('Reviewed search question');await composer.press('Enter');await expect.poll(()=>page.evaluate(async()=>(await (await import('/src/browser/development-agent-document.ts')).readDevelopmentAgent((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).conversations.flatMap((c:any)=>c.messages).filter((m:any)=>m.role==='user').map((m:any)=>m.text.split('[USER MESSAGE]\n')[1]))).toEqual(['Reviewed search question']);
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
