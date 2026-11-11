import {test,expect} from '@playwright/test';
// Flag-off product boundary. Remote development protocol fixtures live in the dev-* lane.
for(const legacy of [null,{kind:'remote',origin:'https://agent.example.test'},{kind:'cloud',environment:'production',agentId:'legacy-agent',ownerId:'legacy-owner'}])test(`local-only product does not reconnect ${legacy?.kind||'cold start'}`,async({page})=>{
 const outside:string[]=[];
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();outside.push(url.href);return route.abort();});
 await page.addInitScript(({legacy})=>{
  if(!sessionStorage.getItem('boundary-seeded')){
   sessionStorage.setItem('boundary-seeded','1');
   if(legacy)localStorage.setItem('alpha.connection.selection.v1',JSON.stringify(legacy));
   localStorage.setItem('alpha.connection.conversations.v1',JSON.stringify({'legacy-owner-a':'conversation-a','legacy-owner-b':'conversation-b'}));
  }
 },{legacy});
 await page.goto('/');
 const chooser=page.getByRole('dialog').filter({hasText:'Android only'});
 await expect(chooser).toBeVisible();
 await expect(chooser.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
 await expect(page.getByLabel('Pairing code',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Connect remote|Dedicated|Create agent|Connect personal/})).toHaveCount(0);
 // #406: a saved hosted agent becomes the resident agent; the old choice is moved aside, not deleted.
 if(legacy){
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({kind:'resident'});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.legacy-hosted-selection.v1')!))).toEqual([legacy]);
 }
 expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.conversations.v1'))).toBe(JSON.stringify({'legacy-owner-a':'conversation-a','legacy-owner-b':'conversation-b'}));
 await page.reload();await expect(chooser).toBeVisible();
 expect(outside).toEqual([]);
 await chooser.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(chooser).toHaveCount(0);await page.reload();await expect(chooser).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.conversations.v1'))).toBe(JSON.stringify({'legacy-owner-a':'conversation-a','legacy-owner-b':'conversation-b'}));
 expect(outside).toEqual([]);
});
