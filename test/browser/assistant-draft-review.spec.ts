import {test,expect as baseExpect} from '@playwright/test';
// Every test here loads the whole development app at least once (several reload it, open a second tab
// or connect a profile), and the composer's saved draft is restored from IndexedDB after each load.
// Under four workers on a loaded machine a load has taken 10-30s and a restore more than the 5s
// default, so the timeouts are explicit: 90s per test, 15s per expectation. What is expected is
// unchanged; only how long the page may take to get there.
test.describe.configure({timeout:90_000});
const expect=baseExpect.configure({timeout:15_000});
for(const theme of ['light','dark'])for(const height of [915,420])test(`long assistant draft stays editable and bounded: ${theme} ${height}`,async({page},info)=>{
 await page.setViewportSize({width:412,height});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?theme='+theme);
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await expect(input).toHaveJSProperty('tagName','TEXTAREA');const text=Array.from({length:30},(_,i)=>`Line ${i+1}: review this before sending`).join('\n');await input.fill(text);await expect(input).toHaveValue(text);
 await expect.poll(()=>input.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(44);const bounds=await input.boundingBox();expect(bounds!.height).toBeLessThanOrEqual(Math.min(168,height*.28)+1);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(height);
 const send=page.getByRole('button',{name:'Send',exact:true});await expect(send).toBeInViewport();await input.press('ControlOrMeta+End');await input.press('Shift+Enter');await input.press('End');await input.type('Last line');await expect(input).toHaveValue(text+'\nLast line');await page.screenshot({path:info.outputPath('assistant-draft-review.png'),animations:'disabled'});
 await input.fill('Short');await expect.poll(()=>input.evaluate(el=>el.getBoundingClientRect().height)).toBe(44);await page.getByRole('button',{name:'Open conversation',exact:true}).click();const expanded=page.getByRole('textbox',{name:'Message Alpha',exact:true});await expanded.fill(text);await expect(expanded).toHaveValue(text);await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport();expect((await expanded.boundingBox())!.height).toBeLessThanOrEqual(Math.min(168,height*.28)+1);await page.screenshot({path:info.outputPath('assistant-expanded-draft.png'),animations:'disabled'});
});
test('IME confirmation and Shift Enter never dispatch; Enter sends the reviewed multiline draft once',async({page})=>{
 await page.goto('/?mode=dev');await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');(window as any).draftSends=[];LocalAgentProtocol.prototype.send=async(_id,text)=>{(window as any).draftSends.push(text);return {text:'Received'};};});
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('First line');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(input).toHaveValue('First line');await input.press('End');await input.press('Shift+Enter');await input.type('Second line');expect(await page.evaluate(()=>(window as any).draftSends)).toEqual([]);await input.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftSends.length)).toBe(1);expect((await page.evaluate(()=>(window as any).draftSends))[0]).toContain('First line\nSecond line');
});
