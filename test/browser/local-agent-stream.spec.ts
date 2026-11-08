import {test,expect} from '@playwright/test';

// Real renderer/client with a held synthetic transport; never calls a model.
for(const outcome of ['complete','cancel','failure'] as const){
 test(`streamed reply renders before completion and handles ${outcome}`,async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
  await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).waitFor();
  await page.evaluate(async()=>{
   const {alphaClient}=await import('/src/runtime/alpha-client.ts');
   const w=window as any;w.streamFixture={posts:0};
   alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.example'},
    send:({onText}:any)=>{w.streamFixture.posts++;onText('First streamed text');w.streamFixture.emit=onText;return new Promise((resolve,reject)=>{w.streamFixture.finish=()=>resolve({text:'Authoritative final reply'});w.streamFixture.fail=()=>reject(Error('Fixture provider failed'));});},
    execute:async()=>{throw Error('No action may execute');},
   });
  });
  await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Synthetic streaming test');
  await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).press('Enter');
  const conversation=page.locator('[data-alpha-layer="conversation"]');
  await expect(conversation.getByText('First streamed text',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toBeVisible();
  await expect(conversation.getByText('Authoritative final reply',{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('progress.png')});
  if(outcome==='complete')await page.evaluate(()=>(window as any).streamFixture.finish());
  else if(outcome==='failure')await page.evaluate(()=>(window as any).streamFixture.fail());
  else await page.getByRole('button',{name:'Stop reply',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as any).streamFixture.emit('Late untrusted text'));
  await expect(conversation.getByText('Late untrusted text',{exact:true})).toHaveCount(0);
  if(outcome==='complete'){
   await expect(conversation.getByText('Authoritative final reply',{exact:true})).toHaveCount(1);
   await expect(conversation.getByText('First streamed text',{exact:true})).toHaveCount(0);
  }else {
   const reason=outcome==='cancel'?'Request cancelled. Check whether the action already happened.':'Sorry, I couldn’t finish that reply.';
   await expect(conversation.getByText('First streamed text',{exact:false})).toContainText(reason);
   await expect(page.getByRole('button',{name:/^Check saved conversation/})).toHaveCount(0);
  }
  expect(await page.evaluate(()=>(window as any).streamFixture.posts)).toBe(1);
  await page.screenshot({path:info.outputPath('terminal.png')});
 });
}

test('authored composer text reaches the verified transport unchanged and blank-only stays local',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.waitFor();
 await page.evaluate(async()=>{const {alphaClient}=await import('/src/runtime/alpha-client.ts');const w=window as any;w.authoredRequests=[];alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'authored-session',origin:'https://fixture.example'},send:async({text}:any)=>{w.authoredRequests.push(text);return{text:'Complete'};},execute:async()=>{throw Error('No action');}});});
 await input.fill(' \n\t  ');await input.press('Enter');
 expect(await page.evaluate(()=>(window as any).authoredRequests)).toEqual([]);
 const authored='  Indented line.\n\nTrailing space.  \n';
 await input.fill(authored);await input.press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as any).authoredRequests)).toEqual([authored]);
 await expect(page.locator('[data-alpha-message-text]').filter({hasText:'Complete'})).toBeVisible();
});
