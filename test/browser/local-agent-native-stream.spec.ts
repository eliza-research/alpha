import {test,expect} from '@playwright/test';

// Real renderer/client with a held synthetic transport; never calls a model.
for(const outcome of ['complete','cancel','failure','done-then-failure'] as const){
 test(`native adapter streamed reply renders before completion and handles ${outcome}`,async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
  await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).waitFor();
  await page.evaluate(async()=>{
   const {alphaClient}=await import('/src/runtime/alpha-client.ts');
   const w=window as any;w.streamFixture={posts:0};
   alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.example'},
    send:async({onText,signal}:any)=>{
      const {streamNativeAgent}=await import('/src/runtime/local-agent-native-stream.ts');
      let emit:any,id='';
      const frame=(value:any)=>emit({streamId:id,event:value});
      const data=(value:any)=>frame({type:'chunk',dataBase64:btoa('data: '+JSON.stringify(value)+'\n\n')});
      const port={async addListener(_:string,callback:any){emit=callback;return{async remove(){w.streamFixture.removed=true;}};},async cancelStream(){w.streamFixture.closed=true;},async requestStream(input:any){
        id=input.streamId;w.streamFixture.posts++;
        frame({type:'response',status:200,headers:{'content-type':'text/event-stream'}});
        data({type:'token',text:'First streamed text'});
        w.streamFixture.emit=(text:string)=>data({type:'token',fullText:text});
        w.streamFixture.done=()=>data({type:'done',fullText:'Authoritative final reply',agentName:'Alpha'});
        w.streamFixture.finish=()=>frame({type:'complete'});
        w.streamFixture.fail=()=>frame({type:'complete',error:'Fixture provider failed'});
        return{streamId:id};
      }};
      return streamNativeAgent(port,{path:'/api/conversations/fixture/messages/stream',ownerId:'fixture-owner',headers:{},body:'{}'},signal,onText);
    },
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
  if(outcome==='complete'||outcome==='done-then-failure'){
   await page.evaluate(()=>(window as any).streamFixture.done());
   await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toBeVisible();
   await expect(conversation.getByText('Authoritative final reply',{exact:true})).toHaveCount(0);
   await page.evaluate(outcome=>outcome==='complete'?(window as any).streamFixture.finish():(window as any).streamFixture.fail(),outcome);
  }
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
  await expect.poll(()=>page.evaluate(()=>(window as any).streamFixture.closed===true&&(window as any).streamFixture.removed===true)).toBe(true);
  await page.screenshot({path:info.outputPath('terminal.png')});
 });
}

for(const outcome of ['ready-failure','ready-done','correction','tool-only','cancel','view-change','account-change','invalid-native','failed-ready','malformed-complete'] as const)test(`retained navigation waits for native stream settlement: ${outcome}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).waitFor();
 await page.evaluate(async(outcome)=>{
  const {alphaClient}=await import('/src/runtime/alpha-client.ts'),{connectionController}=await import('/src/runtime/connection-ui.tsx'),{ViewNavigationClient}=await import('/src/runtime/view-navigation.ts'),{streamNativeAgent}=await import('/src/runtime/local-agent-native-stream.ts');const w=window as any,f=w.readyNavigationFixture={requests:[],ready:false,posts:0};
  const navigation=new ViewNavigationClient(async(path,body)=>{f.requests.push({path,body,pending:alphaClient.getState().pending});return path.endsWith('claim')?{claimId:'owned-claim'}:{ok:true,accepted:true};},()=>alphaClient.getState().session?.sessionId==='ready-navigation-session',()=>alphaClient.getState().context);
  connectionController.captureViewNavigation=context=>({client:navigation,attempt:navigation.capture(context)});
  const prepared={actionName:'VIEWS_SHOW',success:true,values:{mode:'show',viewId:'notes',viewPath:'/notes',viewType:'gui',label:'Notes',completedActionDelivered:false,completedActionHandoffId:'owned-ready-handoff',navigationPrepared:true,navigationBinding:{requestId:'owned-ready-handoff',clientId:navigation.clientId,viewId:'notes',viewType:'gui',installationId:'owned-installation'}}};
  alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'ready-navigation-session',origin:'https://fixture.example'},send:async({signal,onText,onReplyReady})=>{
   let emit:any,id='';const frame=(event:any)=>emit({streamId:id,event}),data=(value:any)=>frame({type:'chunk',dataBase64:btoa('data: '+JSON.stringify(value)+'\n\n')});
   const port={async addListener(_:string,callback:any){emit=callback;return{async remove(){}};},async cancelStream(){},async requestStream(input:any){id=input.streamId;f.posts++;frame({type:'response',status:200,headers:{'content-type':'text/event-stream'}});data({type:'token',text:'Opening Notes.'});data({type:outcome==='tool-only'?'tool':'reply_ready',fullText:'PRIVATE_READY_PROSE',actionResults:[prepared],...(outcome==='failed-ready'?{terminalFailure:{code:'MODEL_OUTPUT_INCOMPLETE'}}:{})});f.finish=()=>{if(outcome==='ready-done'){data({type:'done',fullText:'Opening Notes.',agentName:'Alpha',actionResults:[prepared]});frame({type:'complete'});}else if(outcome==='correction'){data({type:'done',fullText:'Correction',agentName:'Alpha',actionResults:[]});frame({type:'complete'});}else if(outcome==='invalid-native')frame({type:'unknown'});else if(outcome==='malformed-complete')frame({type:'complete',error:{code:'malformed'}});else frame({type:'complete',error:'PRIVATE_PERSISTENCE_FAILURE'});};return{streamId:id};}};
   return streamNativeAgent(port,{path:'/api/conversations/fixture/messages/stream',ownerId:'fixture-owner',headers:{},body:'{}'},signal,onText||(()=>{}),results=>{f.ready=results!==undefined;onReplyReady?.(results);});
  },execute:async()=>{throw Error('No device approval effects');}});
 },outcome);
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Open Notes');await input.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).readyNavigationFixture.posts)).toBe(1);if(outcome!=='tool-only'&&outcome!=='failed-ready')await expect.poll(()=>page.evaluate(()=>(window as any).readyNavigationFixture.ready)).toBe(true);expect(await page.evaluate(()=>(window as any).readyNavigationFixture.requests)).toEqual([]);await expect(page.getByRole('heading',{name:'Notes',exact:true})).toHaveCount(0);
 if(outcome==='cancel')await page.getByRole('button',{name:'Stop reply',exact:true}).click();else if(outcome==='view-change')await page.evaluate(()=>document.querySelector<HTMLButtonElement>('button[aria-label="Calendar"]')!.click());else if(outcome==='account-change')await page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.disconnect());else if(outcome!=='failed-ready')await page.evaluate(()=>(window as any).readyNavigationFixture.finish());
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
 if(outcome==='ready-failure'||outcome==='ready-done'){await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();const requests=await page.evaluate(()=>(window as any).readyNavigationFixture.requests);expect(requests.map((r:any)=>r.path)).toEqual(['/api/views/interact-claim','/api/views/interact-result']);expect(requests.every((r:any)=>r.pending===false)).toBe(true);expect(requests[1].body).toMatchObject({success:true,result:{switched:true}});if(outcome==='ready-failure'){await expect(page.locator('[data-alpha-layer="conversation"]')).toHaveAttribute('aria-hidden','false');const messages=await page.locator('[data-alpha-message-text]').allTextContents();expect(messages.join('\n')).toContain('conversation response was interrupted');expect(messages.join('\n')).not.toMatch(/PRIVATE_|message saved/i);}}
 else expect(await page.evaluate(()=>(window as any).readyNavigationFixture.requests)).toEqual([]);
});
