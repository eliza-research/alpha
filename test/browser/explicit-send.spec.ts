import {test,expect,type Page} from '@playwright/test';
const composer=(page:Page)=>page.getByRole('textbox',{name:'Message Alpha',exact:true});
async function ready(page:Page){
 await page.goto('/?mode=dev');await page.evaluate(async()=>{
  const fixture=(window as any).explicitSend={sent:[],rows:[],room:''};
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');
  const {LocalAgentProtocol:P}=await import('/src/runtime/local-agent.ts'),{Component}=await import('/src/prototype/model.js');
  P.prototype.send=async(room,text)=>{fixture.room=room;fixture.sent.push(text);const u=crypto.randomUUID(),a=crypto.randomUUID();fixture.rows.push({id:u,role:'user',text},{id:a,role:'assistant',text:'Reply '+fixture.sent.length});return {text:'Reply '+fixture.sent.length,agentName:'Alpha',userMessageId:u,messageId:a};};
  P.prototype.messages=async()=>({messages:structuredClone(fixture.rows)});P.prototype.listConversations=async()=>[{id:fixture.room,title:'Owned conversation'}];
  P.prototype.truncateMessages=async()=>{throw Error('No truncation expected');};
  const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){fixture.shell=this;return render.call(this);};
 });
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Original request');await input.press('Enter');await expect(page.locator('[data-alpha-message-text]').filter({hasText:'Reply 1'})).toBeVisible();
}
const bubbles=(page:Page,text:string)=>page.locator('[data-alpha-message-text]').filter({hasText:text});
test('an explicit prompt with an empty composer posts once and shows one user bubble',async({page})=>{
 await ready(page);
 await page.evaluate(async()=>await(window as any).explicitSend.shell.send('Suggested prompt'));
 await expect(bubbles(page,'Reply 2')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).explicitSend.sent)).toEqual(['Original request','Suggested prompt']);
 await expect(bubbles(page,'Suggested prompt')).toHaveCount(1);
});
test('an explicit prompt while a message edit is open is refused with a toast and keeps the edit',async({page})=>{
 await ready(page);await bubbles(page,'Original request').click();await page.getByRole('menu',{name:'Message actions'}).getByRole('menuitem',{name:'Edit and resend',exact:true}).click();
 await expect(composer(page)).toHaveValue('Original request');await composer(page).fill('Edited request');
 await page.evaluate(async()=>await(window as any).explicitSend.shell.send('Suggested prompt'));
 await expect(page.getByText('Finish or cancel the message you are editing first.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).explicitSend.sent)).toEqual(['Original request']);
 await expect(bubbles(page,'Suggested prompt')).toHaveCount(0);await expect(composer(page)).toHaveValue('Edited request');
 expect(await page.evaluate(()=>!!(window as any).explicitSend.shell.messageEditTarget)).toBe(true);
});
