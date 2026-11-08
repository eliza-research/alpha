import {test,expect} from '@playwright/test';

// Real renderer/client with a held synthetic transport; never calls a model. The complete, cancel and
// failure outcomes are covered with the native stream adapter in local-agent-native-stream.spec.ts.
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
