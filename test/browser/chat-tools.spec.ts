import {test,expect,type Page} from '@playwright/test';
import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import {returnToApps} from './app-navigation';

async function setup(page:Page){
  await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
  await page.goto('/?mode=dev&tools=1');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await openConnectionDiagnostics(page);
  await page.getByRole('button',{name:'Connect development profile',exact:true}).click();
  await returnToApps(page);
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
}
async function attach(page:Page){
  await page.getByRole('button',{name:'Chat actions',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Upload file',exact:true}).click();
  await(await chooser).setFiles({name:'composer-qa.txt',mimeType:'text/plain',buffer:Buffer.from('The launch check word is lilac.')});
  await expect(page.getByRole('button',{name:'Remove attachment composer-qa.txt',exact:true})).toBeVisible();
}

test('the plus menu adds a file, sends its exact bytes and retains its message chip on reload',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{
    const {alphaClient}=await import('/src/runtime/alpha-client.ts');const original=alphaClient.send.bind(alphaClient);
    alphaClient.send=async(...args:any[])=>{(window as any).sentFileOptions=args[4];return original(...args);};
  });
  await attach(page);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('Development reply. Edit this response in Agent connection.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).sentFileOptions.images)).toMatchObject([{name:'composer-qa.txt',mimeType:'text/plain',data:'VGhlIGxhdW5jaCBjaGVjayB3b3JkIGlzIGxpbGFjLg=='}]);
  await expect(page.getByRole('button',{name:'Remove attachment composer-qa.txt',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-alpha-message-id]').getByText('composer-qa.txt',{exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  await expect(page.locator('[data-alpha-message-id]').getByText('composer-qa.txt',{exact:true})).toBeVisible();
});

test('the plus menu opens cancellable message search without a Home item',async({page})=>{
  await setup(page);
  await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');connectionController.searchMessages=async(query:string)=>[{messageId:'11111111-1111-4111-8111-111111111111',conversationId:'22222222-2222-4222-8222-222222222222',roomId:'33333333-3333-4333-8333-333333333333',role:'user',text:query+' exact result',snippet:query+' exact result',createdAt:Date.now(),score:1}];});
  await page.getByRole('button',{name:'Chat actions',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Chat actions',exact:true}).getByText('Back to Home',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Search chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Search messages',exact:true}).fill('launch');
  await expect(page.getByRole('dialog',{name:'Search chats',exact:true}).getByText('launch exact result',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close search',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Search chats',exact:true})).toHaveCount(0);
});
