import {test,expect} from '@playwright/test';
// The settled reply is announced once through the page's status region, and focus stays on the composer.
async function setup(page:any,reply:(text:string,onText:(value:string)=>void,f:any)=>Promise<{text:string}>){
 await page.route('https://**/*',r=>r.abort());await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));(window as any).announce={sent:[],heard:[]};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('No real microphone');};});await page.goto('/?connections=advanced');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeEnabled();
 await page.evaluate(async(source:string)=>{const {Component}=await import('/src/prototype/model.js'),{alphaClient}=await import('/src/runtime/alpha-client.ts');const f=(window as any).announce;const send=new Function('return '+source)();Component.prototype.connectAgent=async()=>{};alphaClient.send=async(text:string,onText:(value:string)=>void)=>{f.sent.push(text);return send(text,onText,f);};const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return render.call(this);};
  const region=document.querySelector('[data-alpha-reply-announcer]')!;new MutationObserver(()=>{if(region.textContent)f.heard.push(region.textContent);}).observe(region,{childList:true,characterData:true,subtree:true});},reply.toString());
 await expect.poll(()=>page.evaluate(()=>!!(window as any).announce.shell)).toBe(true);
 await page.evaluate(()=>{(window as any).announce.shell.connectAgent=async()=>{};});
}
const heard=(page:any)=>page.evaluate(()=>(window as any).announce.heard);
test('a streamed reply is announced as replying, then once when it settles',async({page})=>{
 await setup(page,async(_text,onText,f)=>{await new Promise<void>(r=>f.stream=r);onText('Part');onText('Partial reply');await new Promise<void>(r=>f.settle=r);return {text:'Your calendar is clear today.'};});
 const region=page.locator('[data-alpha-reply-announcer]');await expect(region).toHaveAttribute('role','status');await expect(region).toHaveAttribute('aria-live','polite');
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();const input=page.getByRole('textbox',{name:'Message Alpha',exact:true});await input.fill('What is on my calendar');await input.press('Enter');
 await expect.poll(()=>page.evaluate(()=>!!(window as any).announce.stream)).toBe(true);await expect(region).toHaveText('Alpha is replying');
 await page.evaluate(()=>(window as any).announce.stream());await expect.poll(()=>page.evaluate(()=>!!(window as any).announce.settle)).toBe(true);await page.waitForTimeout(100);
 expect(await heard(page)).toEqual(['Alpha is replying']);
 await page.evaluate(()=>(window as any).announce.settle());await expect(region).toHaveText('Your calendar is clear today.');await page.waitForTimeout(200);
 expect(await heard(page)).toEqual(['Alpha is replying','Your calendar is clear today.']);
 await expect(input).toBeFocused();
});
test('a whole reply after a send is announced once and does not move focus',async({page})=>{
 await setup(page,async(_text,_onText,f)=>{await new Promise<void>(r=>f.settle=r);return {text:'Done.'};});
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Hello');await input.press('Enter');
 const next=page.getByRole('textbox',{name:'Message Alpha',exact:true});await expect(next).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>!!(window as any).announce.settle)).toBe(true);await page.evaluate(()=>(window as any).announce.settle());
 await expect(page.locator('[data-alpha-reply-announcer]')).toHaveText('Done.');await page.waitForTimeout(200);
 expect(await heard(page)).toEqual(['Alpha is replying','Done.']);await expect(next).toBeFocused();
});
