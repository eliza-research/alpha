import {installHomeCalendar} from './helpers/home-calendar';
import {test,expect,type Page} from '@playwright/test';
test.use({hasTouch:true});
const answer='Synthetic reply for message actions.';
const agent=(page:Page)=>page.locator('[data-alpha-message-text]').filter({hasText:answer});
const menu=(page:Page)=>page.getByRole('menu',{name:'Message actions'});
async function conversation(page:Page,theme='light',reply=answer){
 await page.goto('/?mode=dev&theme='+theme);
 await page.evaluate(async reply=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).copiedMessage=text;}}});
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');
  const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');LocalAgentProtocol.prototype.send=async(room)=>{(window as any).messageActionsRoom=room;return {text:reply};};
 },reply);
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('My original request');await input.press('Enter');await expect(agent(page)).toBeVisible();
 // Raw CDP touches bypass Playwright actionability. Wait for the opening sheet
 // to settle and receive input before measuring coordinates; no click is sent.
 await agent(page).click({trial:true});
}
for(const theme of ['light','dark'])test(`tap reveals quiet actions and copies exact message: ${theme}`,async({page},info)=>{
 await conversation(page,theme);await expect(menu(page)).toHaveCount(0);await expect(page.getByText('Listen with Cloud',{exact:true})).toHaveCount(0);await expect(page.getByText('Listen on phone',{exact:true})).toHaveCount(0);
 const bounds=await agent(page).boundingBox();await page.touchscreen.tap(bounds!.x+20,bounds!.y+10);await expect(menu(page)).toBeVisible();
 await menu(page).getByRole('menuitem',{name:'Copy',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).copiedMessage)).toBe(answer);await expect(page.locator('.alpha-message-action-announcement')).toHaveText('Copied.');
 await expect(menu(page).getByRole('menuitem',{name:'Copy',exact:true}).locator('[data-alpha-icon]')).toHaveAttribute('data-alpha-icon','/icons/lucide/copy.svg');
 await page.screenshot({path:info.outputPath('message-actions-'+theme+'.png'),animations:'disabled'});
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).click();await expect(menu(page)).toHaveCount(0);
});
test('quoted message retains visible paragraphs, indentation and exact clipboard bytes',async({page},info)=>{
 const exact='  '+answer+'\n\n  Keep two spaces.\n\tUnicode: α — 🙂.  \n';
 await conversation(page,'light',exact);const message=agent(page);
 expect(await message.textContent()).toBe(exact);
 await expect(message).toHaveCSS('white-space','pre-wrap');
 expect(await message.innerText()).toContain('\n\n  Keep two spaces.');
 await message.click();await menu(page).getByRole('menuitem',{name:'Copy',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).copiedMessage)).toBe(exact);
 await page.screenshot({path:info.outputPath('message-verbatim-formatting.png'),animations:'disabled'});
});
test('keyboard focus, arrow navigation and Escape return to the selected message',async({page})=>{
 await conversation(page);await agent(page).focus();await agent(page).press('Enter');await expect(menu(page).getByRole('menuitem',{name:'Copy',exact:true})).toBeFocused();
 await page.keyboard.press('End');await expect(menu(page).getByRole('menuitem').last()).toBeFocused();await page.keyboard.press('Home');await expect(menu(page).getByRole('menuitem',{name:'Copy',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu(page)).toHaveCount(0);await expect(agent(page)).toBeFocused();
});
test('long press reveals actions, pointer movement cancels a held gesture',async({page})=>{
 await conversation(page);const b=await agent(page).boundingBox(),cdp=await page.context().newCDPSession(page),point={x:b!.x+20,y:b!.y+10};
 await expect(menu(page)).toHaveCount(0);expect(await agent(page).evaluate((element,point)=>element.contains(document.elementFromPoint(point.x,point.y)),point)).toBe(true);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await expect(menu(page)).toBeVisible();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(menu(page)).toBeVisible();await page.getByRole('textbox',{name:'Message Alpha',exact:true}).click();await expect(menu(page)).toHaveCount(0);
 await agent(page).dispatchEvent('pointerdown',{pointerType:'touch',clientX:30,clientY:30});await agent(page).dispatchEvent('pointermove',{pointerType:'touch',clientX:60,clientY:30});await page.waitForTimeout(550);await expect(menu(page)).toHaveCount(0);
});
test('copy denial stays in the menu and does not change the original messages',async({page})=>{
 await conversation(page);await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}}));await agent(page).click();await menu(page).getByRole('menuitem',{name:'Copy',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Copy unavailable.'})).toBeVisible();await expect(agent(page)).toHaveText(answer);await expect(page.locator('[data-alpha-message-text]').filter({hasText:'My original request'})).toHaveText('My original request');
});
test('Read aloud uses the selected Cloud account; fixture blocks all audio',async({page})=>{
 await conversation(page);await page.evaluate(async()=>{
  const w=window as any,{connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{BrowserVoice}=await import('/src/browser/voice.ts');w.localSpeechCalls=0;
  c.getCloudEnvironment=()=> 'production';c.getCloudClient=()=>({sessionId:'synthetic-cloud-session',credentialId:'synthetic-cloud-credential',client:{}} as any);
  BrowserVoice.prototype.synthesize=async(input)=>{w.messageSpeechInput=input;throw Error('Synthetic audio blocked');};
  BrowserVoice.prototype.localSpeechStatus=async()=>{w.localSpeechCalls++;return {ready:true,execution:'browser',route:'browser'};};
  BrowserVoice.prototype.synthesizeLocal=async()=>{w.localSpeechCalls++;throw Error('Unexpected local fallback');};
 });
 await agent(page).click();await menu(page).getByRole('menuitem',{name:'Read aloud'}).click();await expect.poll(()=>page.evaluate(()=>(window as any).messageSpeechInput?.text)).toBe(answer);await expect(page.getByRole('status').filter({hasText:'Synthetic audio blocked'})).toBeVisible();
 expect(await page.evaluate(()=>{const w=window as any;return {environment:w.messageSpeechInput.environment,credentialId:w.messageSpeechInput.credentialId,localCalls:w.localSpeechCalls};})).toEqual({environment:'production',credentialId:'synthetic-cloud-credential',localCalls:0});
});
test('user messages copy without unsupported playback, reply or edit controls',async({page})=>{
 await conversation(page);await page.locator('[data-alpha-message-text]').filter({hasText:'My original request'}).click();await expect(menu(page).getByRole('menuitem',{name:'Read aloud'})).toHaveCount(0);await expect(menu(page).getByRole('menuitem',{name:'Reply'})).toHaveCount(0);await expect(menu(page).getByRole('menuitem',{name:'Edit'})).toHaveCount(0);await menu(page).getByRole('menuitem',{name:'Copy',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).copiedMessage)).toBe('My original request');
});
test('same bubble toggles; pointer close stays quiet and keyboard close restores visible focus',async({page},info)=>{
 await conversation(page);const message=agent(page);
 await message.tap();await expect(menu(page)).toBeVisible();await message.tap();await expect(menu(page)).toHaveCount(0);
 await message.tap();await message.tap();await expect(menu(page)).toHaveCount(0);
 expect(await message.evaluate(element=>element.matches(':focus-visible'))).toBe(false);
 await page.screenshot({path:info.outputPath('pointer-close.png'),animations:'disabled'});
 await message.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');await expect(message).toBeFocused();
 expect(await message.evaluate(element=>getComputedStyle(element).outlineWidth)).toBe('2px');
 await page.screenshot({path:info.outputPath('keyboard-focus.png'),animations:'disabled'});
 await message.press('Enter');await page.keyboard.press('End');await expect(menu(page).getByRole('menuitem').last()).toBeFocused();await page.keyboard.press('Escape');await expect(menu(page)).toHaveCount(0);await expect(message).toBeFocused();
});
async function textPoint(locator:import('@playwright/test').Locator,end=false){
 return locator.evaluate((element,end)=>{const node=element.firstChild!;const range=document.createRange();const offset=end?Math.max(0,node.textContent!.length-1):0;range.setStart(node,offset);range.setEnd(node,offset+1);const rect=range.getBoundingClientRect();return {x:end?rect.right-1:rect.left+1,y:rect.top+rect.height/2};},end);
}
test('mouse selection follows chronological DOM across messages without shell gestures or menus',async({page},info)=>{
 await conversation(page);const first=page.locator('[data-alpha-message-text]').filter({hasText:'My original request'}),last=agent(page);
 expect(await page.locator('[data-alpha-message-text]').allTextContents()).toEqual(['My original request',answer]);
 const a=await textPoint(first),b=await textPoint(last,true);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:16});await page.mouse.up();
 const selected=await page.evaluate(()=>window.getSelection()!.toString());expect(selected).toContain('My original request');expect(selected).toContain('Synthetic reply for message actions');expect(selected.indexOf('My original request')).toBeLessThan(selected.indexOf('Synthetic reply'));
 await expect(menu(page)).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('chronological-selection.png'),animations:'disabled'});
});
test('touch long-press drag selects across messages without opening a message menu',async({page},info)=>{
 await conversation(page);const first=page.locator('[data-alpha-message-text]').filter({hasText:'My original request'}),last=agent(page),a=await textPoint(first),b=await textPoint(last,true),cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});await page.waitForTimeout(650);
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const selected=await page.evaluate(()=>window.getSelection()!.toString());expect(selected).toContain('My original request');expect(selected).toContain('Synthetic reply for message actions');await expect(menu(page)).toHaveCount(0);await page.screenshot({path:info.outputPath('touch-selection.png'),animations:'disabled'});
});
test('transcript keeps the older reading anchor and follows only bottom or a new user turn',async({page})=>{
 await conversation(page);await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const {LocalAgentProtocol:P}=await import('/src/runtime/local-agent.ts');const rows=(window as any).scrollRows=Array.from({length:48},(_,i)=>({id:crypto.randomUUID(),role:i%2?'assistant':'user',text:`Historical ${i}: complete synthetic text for scroll anchoring. More text stays on this message.`}));P.prototype.messages=async()=>({messages:structuredClone(rows)});P.prototype.listConversations=async()=>[{id:(window as any).messageActionsRoom,title:'Synthetic scroll fixture'}];await c.restoreHistory((window as any).messageActionsRoom);});
 const transcript=page.locator('[data-alpha-transcript]');await expect(transcript.locator('[data-alpha-message-id]')).toHaveCount(48);
 await page.locator('[data-alpha-layer="conversation"]').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const before=await transcript.evaluate(element=>{element.scrollTop=element.scrollHeight/3;const top=element.getBoundingClientRect().top;const anchor=Array.from(element.querySelectorAll('[data-alpha-message-id]')).find(row=>row.getBoundingClientRect().bottom>top)!;return {id:anchor.getAttribute('data-alpha-message-id'),y:anchor.getBoundingClientRect().top};});
 await page.evaluate(async()=>{(window as any).scrollRows.push({id:crypto.randomUUID(),role:'assistant',text:'New synthetic reply while reading older history.'});await(await import('/src/runtime/connection-ui.tsx')).connectionController.restoreHistory((window as any).messageActionsRoom);});
 const anchored=await page.locator(`[data-alpha-message-id="${before.id}"]`).boundingBox();expect(Math.abs(anchored!.y-before.y)).toBeLessThan(2);
 await transcript.evaluate(element=>element.scrollTop=element.scrollHeight);
 await page.evaluate(async()=>{(window as any).scrollRows.push({id:crypto.randomUUID(),role:'assistant',text:'Another synthetic reply while pinned to bottom.'});await(await import('/src/runtime/connection-ui.tsx')).connectionController.restoreHistory((window as any).messageActionsRoom);});
 await expect.poll(()=>transcript.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThan(2);
 await page.getByRole('button',{name:'Shrink chat',exact:true}).click();await page.locator('[data-alpha-layer="conversation"]').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));await expect.poll(()=>transcript.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThan(2);
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();await page.locator('[data-alpha-layer="conversation"]').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 await transcript.evaluate(element=>element.scrollTop=0);const composer=page.getByRole('textbox',{name:'Message Alpha',exact:true});await composer.fill('A new user turn');await composer.press('Enter');await expect(agent(page)).toBeVisible();await expect.poll(()=>transcript.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThan(2);
});
test('Home shows clean Calendar and Workflows tiles with Inbox last',async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await installHomeCalendar(page);
 const home=page.getByRole('region',{name:'Home',exact:true});await expect(home.getByRole('button',{name:'Open Agent Calendar',exact:true})).toContainText(/Nothing planned/);
 await expect(home.getByRole('button',{name:'Open workflows',exact:true})).toBeVisible();
 const tiles=home.locator('[data-alpha-home-layout] > .scr').first().getByRole('button');await expect(tiles.nth(1)).toHaveAttribute('aria-label','Open workflows');await expect(tiles.nth(2)).toHaveAttribute('aria-label',/^Open Inbox(?:$|:)/);
 await page.screenshot({path:info.outputPath('home-clean-tiles.png'),animations:'disabled'});
 await installHomeCalendar(page,{title:'Synthetic Home calendar check',startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+7200000).toISOString()});await expect(home.getByRole('button',{name:/^Open calendar event: Synthetic Home calendar check, \w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2}/})).toContainText('Synthetic Home calendar check');expect(await page.evaluate(()=>(window as any).homeCalendarFixture.requests.every((r:any)=>r.method==='GET'))).toBe(true);await page.screenshot({path:info.outputPath('home-next-event.png'),animations:'disabled'});
});

test('chat brand Home preserves the existing conversation and unsent draft',async({page})=>{
 await conversation(page);await page.getByRole('button',{name:'Minimize chat',exact:true}).click();await page.getByRole('button',{name:'Notes',exact:true}).click();
 // Keep the next deliberate click inside the gesture's 350ms suppression window,
 // independent of runner speed; timers and browser actionability still run.
 await page.clock.setFixedTime(new Date());await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Unsent after the original response');await page.getByRole('button',{name:'Go Home',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Unsent after the original response');await page.getByRole('button',{name:'Minimize chat',exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(agent(page)).toHaveText(answer);await expect(page.locator('[data-alpha-message-text]').filter({hasText:'My original request'})).toHaveText('My original request');await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Unsent after the original response');
});
test('transcript reading position survives a keyboard resize, Back from full and HOME then reopen; bottom-follow holds at the bottom',async({page})=>{
 test.setTimeout(90_000);
 await conversation(page);await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const {LocalAgentProtocol:P}=await import('/src/runtime/local-agent.ts');const rows=Array.from({length:48},(_,i)=>({id:crypto.randomUUID(),role:i%2?'assistant':'user',text:`Historical ${i}: complete synthetic text for scroll continuity. More text stays on this message.`}));P.prototype.messages=async()=>({messages:structuredClone(rows)});P.prototype.listConversations=async()=>[{id:(window as any).messageActionsRoom,title:'Synthetic scroll fixture'}];await c.restoreHistory((window as any).messageActionsRoom);});
 const transcript=page.locator('[data-alpha-transcript]'),layer=page.locator('[data-alpha-layer="conversation"]');await expect(transcript.locator('[data-alpha-message-id]')).toHaveCount(48);
 const settle=async()=>{await layer.evaluate(element=>Promise.all(element.getAnimations({subtree:true}).filter(animation=>animation.timeline===document.timeline&&Number.isFinite(animation.effect?.getTiming().iterations)).map(animation=>animation.finished.catch(()=>{}))));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();await settle();
 // Offset of a message from the top of the visible transcript, and the distance from the bottom.
 const offset=(id:string)=>transcript.evaluate((element,id)=>element.querySelector(`[data-alpha-message-id="${id}"]`)!.getBoundingClientRect().top-element.getBoundingClientRect().top,id);
 const fromBottom=()=>transcript.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop);
 const steps:Array<[string,()=>Promise<unknown>]>=[
  ['keyboard resize',async()=>{await page.setViewportSize({width:412,height:520});await settle();}],
  ['keyboard closed',async()=>{await page.setViewportSize({width:412,height:915});await settle();}],
  ['Back from full',async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();await settle();}],
  ['HOME then reopen',async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(layer).toHaveAttribute('aria-hidden','true');await settle();await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect(layer).not.toHaveAttribute('aria-hidden','true');await settle();}],
 ];
 // Reading older history: the anchored message stays where it was after every step.
 const before=await transcript.evaluate(element=>{element.scrollTop=element.scrollHeight/3;const top=element.getBoundingClientRect().top;const anchor=Array.from(element.querySelectorAll('[data-alpha-message-id]')).find(row=>row.getBoundingClientRect().bottom>top)!;return {id:anchor.getAttribute('data-alpha-message-id')!,y:anchor.getBoundingClientRect().top-top};});
 for(const [name,step] of steps){await step();expect(Math.abs(await offset(before.id)-before.y),name).toBeLessThan(2);}
 // At the bottom: every step keeps following the newest message.
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();await settle();
 await transcript.evaluate(element=>element.scrollTop=element.scrollHeight);await settle();
 for(const [name,step] of steps){await step();expect(await fromBottom(),name).toBeLessThan(2);}
});
