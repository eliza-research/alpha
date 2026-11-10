import {returnToApps} from './app-navigation';
import {test,expect} from '@playwright/test';
async function setup(page:any){
 await page.route('https://**/*',r=>r.abort());await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));(window as any).sendFocus={sent:[],holdConsume:false};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('No real microphone');};});await page.goto('/?connections=advanced');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeEnabled();
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js'),{alphaClient}=await import('/src/runtime/alpha-client.ts');const f=(window as any).sendFocus;Component.prototype.connectAgent=async()=>{};alphaClient.send=async(text:string)=>{f.sent.push(text);await new Promise<void>(r=>f.reply=r);return {text:'Closed fixture reply'};};const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return render.call(this);};});
 // Capture the instrumented shell during an explicit render; a settled startup need not
 // produce another incidental render just to initialize this fixture.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!(window as any).sendFocus.shell)).toBe(true);
 await returnToApps(page);
 await page.evaluate(()=>{(window as any).sendFocus.shell.connectAgent=async()=>{};});
}
for(const detent of ['input','sheet','full'])for(const method of ['Enter','click'])test(`Send preserves composer focus ${detent} ${method}`,async({page})=>{
 await setup(page);if(detent!=='input'){await page.getByRole('button',{name:'Open conversation',exact:true}).click();if(detent==='full')await page.getByRole('button',{name:'Expand chat',exact:true}).click();}
 const input=page.locator('textarea[data-alpha-composer]');await input.fill('First prompt');await input.focus();if(method==='Enter')await input.press('Enter');else await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).sendFocus.sent.length)).toBe(1);const next=page.getByRole('textbox',{name:'Message Alpha',exact:true});await expect(next).toBeFocused();await page.keyboard.type('Next prompt');await expect(next).toHaveValue('Next prompt');expect(await next.evaluate((e:any)=>e.selectionStart)).toBe(11);await page.evaluate(()=>(window as any).sendFocus.reply());await expect(next).toBeFocused();await expect(next).toHaveValue('Next prompt');
});
test('a later provider reply never steals the user’s new focus',async({page})=>{
 await setup(page);const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('First prompt');await input.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).sendFocus.sent.length)).toBe(1);const chosen=page.getByRole('button',{name:'Resize chat',exact:true});await chosen.focus();await page.evaluate(()=>(window as any).sendFocus.reply());await expect(chosen).toBeFocused();
});
test('empty Enter, IME confirmation and multiline input preserve the draft without dispatch',async({page})=>{
 await setup(page);const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.focus();await input.press('Enter');await expect(input).toBeFocused();await input.fill('Keep this');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await input.press('End');await input.press('Shift+Enter');await page.keyboard.type('second line');await expect(input).toHaveValue('Keep this\nsecond line');expect(await page.evaluate(()=>(window as any).sendFocus.sent.length)).toBe(0);
});
test('a background connection operation never blocks a send or claims the draft changed',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const read=c.getSnapshot.bind(c);c.getSnapshot=()=>({...read(),busy:true,backgroundWork:true}) as any;});const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Send while starting');await input.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).sendFocus.sent)).toEqual(['Send while starting']);await expect(page.getByText('The draft changed',{exact:false})).toHaveCount(0);await page.evaluate(()=>(window as any).sendFocus.reply());
});

test('a foreground connection operation keeps the typed draft undispatched',async({page})=>{
 await setup(page);
 await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const read=c.getSnapshot.bind(c);c.getSnapshot=()=>({...read(),busy:true,backgroundWork:false}) as any;});
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});
 await input.fill('Keep while connecting');await input.press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as any).sendFocus.shell.draftSendPending)).toBe(false);
 await expect(input).toHaveValue('Keep while connecting');
 expect(await page.evaluate(()=>(window as any).sendFocus.sent)).toEqual([]);
});
