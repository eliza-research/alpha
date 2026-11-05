import {openBrowserCalendar} from './helpers/browser-calendar';
import {openLegacyNotes} from './helpers/legacy-notes';
import {DEFAULT_PULL_DISTANCE} from '../../.eliza/client-features/packages/ui/src/gestures/constants';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
});

test('standalone preview hides simulated system controls and developer tools', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Device controls',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Home',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-alpha-system-cutout]')).toBeHidden();
});

test('tools and launcher presentation require explicit development flags', async ({page}) => {
  await page.goto('/?tools=1&shell=launcher');
  await expect(page.getByRole('button',{name:'Device controls',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Home',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Home',exact:true})).toBeVisible();
});

test('chat handle captures an upward and downward drag outside its bounds', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  const handle=page.getByRole('button',{name:'Resize chat',exact:true});
  await expect(handle).toBeVisible();
  const panel=page.locator('[data-alpha-layer=conversation]');
  await expect.poll(()=>panel.evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.6)));}));
  const burst=await handle.evaluate(async element=>{
    const panel=document.querySelector<HTMLElement>('[data-alpha-layer="conversation"]')!,box=element.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2,before=panel.style.height;
    const dispatch=(type:string,dy:number)=>element.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:71,pointerType:'mouse',isPrimary:true,button:0,clientX:x,clientY:y+dy}));
    dispatch('pointerdown',0);for(let dy=10;dy<=80;dy+=10)dispatch('pointermove',dy);
    const synchronous=panel.style.height;await new Promise(requestAnimationFrame);const painted=panel.style.height;dispatch('pointercancel',80);return {before,synchronous,painted};
  });
  expect(burst.synchronous).toBe(burst.before);expect(burst.painted).not.toBe(burst.before);
  await expect.poll(()=>panel.evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.6)));}));
  await handle.evaluate(element=>{
    const box=element.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;
    for(const [type,dy] of [['pointerdown',0],['pointerup',-120]] as const)element.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:72,pointerType:'mouse',isPrimary:true,button:0,clientX:x,clientY:y+dy}));
  });
  await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Shrink chat',exact:true}).press('Enter');
  await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
  await handle.click({trial:true});
  const box=(await handle.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,20,{steps:12});
  await page.mouse.up();
  await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
  await expect(panel).toHaveCSS('height','915px');
  // Full screen has no grabber; Shrink chat is the way back.
  await expect(handle).toHaveCount(0);
  // Toolbar taps are ignored for 350ms after a drag, as a compatibility click may follow one.
  await page.waitForTimeout(400);
  await page.getByRole('button',{name:'Shrink chat',exact:true}).click();
  await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
  await expect.poll(()=>panel.evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.6)));}));
});


test('standalone views retain an accessible return to apps', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
  const back=page.getByRole('button',{name:'Back to apps',exact:true});
  await back.focus();
  await back.press('Enter');
  await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
});

test('an open modal owns native Back without leaving the app', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => {const dialog=document.createElement('dialog');dialog.textContent='Test permission explanation';document.body.append(dialog);dialog.showModal();});
  await expect(page.locator('html')).toHaveAttribute('data-alpha-can-go-back','true');
  await page.evaluate(() => window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-alpha-can-go-back','false');
});


test('standalone Home scrolls to the screen edge without a simulated status-bar gap',async({page},testInfo)=>{
  await page.setViewportSize({width:412,height:640});
  await page.goto('/');
  const home=page.locator('[data-alpha-layer="home"]'),screen=page.locator('[data-screen="1"]');
  await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
  const bounds=await home.boundingBox(),usable=await screen.boundingBox();
  expect(bounds!.y).toBeCloseTo(usable!.y,1);
  // Home fills the screen behind the floating composer; clearance inside the scroll content
  // lets the final app row move fully above it without clipping the full-height surface.
  const composer=page.locator('[data-alpha-layer="composer"] [data-alpha-input-bar]');
  expect(bounds!.y+bounds!.height).toBeCloseTo(usable!.y+usable!.height,1);
  await home.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  const lastApp=home.getByRole('button',{name:'All apps',exact:true});
  await expect.poll(async()=>{const dock=await composer.boundingBox(),last=await lastApp.boundingBox();return dock!.y-(last!.y+last!.height);}).toBeGreaterThanOrEqual(6);
  await home.evaluate(node=>{node.scrollTop=0;});
  expect((await home.boundingBox())!.height).toBeGreaterThan(usable!.height-140);
  const tile=await home.getByRole('button').first().boundingBox();
  expect(tile!.y-bounds!.y).toBeLessThan(16);

  await home.evaluate(node=>{node.scrollTop=80;});
  expect((await home.boundingBox())!.y).toBeCloseTo(usable!.y,1);
  await page.screenshot({path:testInfo.outputPath('home-scrolled-fullscreen.png')});
});

for(const view of ['Files','Notes','Calendar','Workflows','Inbox','Browser','Photos','Maps','Camera','Settings'])test(`standalone ${view} reuses one compact header and retains return to apps`,async({page})=>{
 await page.setViewportSize({width:360,height:740});await page.goto('/');await page.getByRole('button',{name:view,exact:true}).click();
 const app=page.locator('[data-alpha-layer="app"]'),back=page.getByRole('button',{name:'Back to apps',exact:true});await expect(back).toHaveCount(1);await expect(back).toBeVisible();const header=back.locator('xpath=ancestor::*[@data-alpha-app-header][1]');await expect(header).toHaveAttribute('data-alpha-app-header','main');expect(await header.evaluate(el=>getComputedStyle(el).marginTop)).toBe('0px');expect(await header.evaluate(el=>getComputedStyle(el).height)).toBe('52px');const target=(await back.boundingBox())!;expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);expect(await header.evaluate(el=>getComputedStyle(el).maskImage)).toBe('none');expect(await header.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await back.click();await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
});

for(const theme of ['light','dark'])for(const view of ['Files','Notes'])test(`${view} content edges fade without duplicating or fading its header: ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:360,height:600});await page.goto('/?theme='+theme);
 if(view==='Notes')await page.evaluate(async()=>{const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');const store=await openBrowserNotes();await store.replace(Array.from({length:12},(_,n)=>({id:`scroll-${n}`,kind:'text',title:`Scroll note ${n}`,body:`Scroll note ${n}\n`+'Readable body\n'.repeat(8)})));});
 if(view==='Notes'){await page.reload();}
 if(view==='Notes')await openLegacyNotes(page);else await page.getByRole('button',{name:view,exact:true}).click();const scroll=page.locator(`[data-alpha-app-scroll="${view.toLowerCase()}"]`),back=page.getByRole('button',{name:view==='Notes'?'Return to Notes':'Back to apps',exact:true}),header=back.locator('xpath=ancestor::*[@data-alpha-app-header][1]');await expect(scroll).toBeVisible();await scroll.evaluate(el=>el.scrollTop=0);await expect.poll(()=>scroll.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-top')))).toBe(0);await page.screenshot({path:info.outputPath('content-start.png'),animations:'disabled'});
 expect(await scroll.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(24);await scroll.evaluate(el=>el.scrollTop=60);await expect.poll(()=>scroll.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-top')))).toBeGreaterThan(0);expect(await header.evaluate(el=>getComputedStyle(el).maskImage)).toBe('none');await expect(back).toBeInViewport();await page.screenshot({path:info.outputPath('content-scrolled.png'),animations:'disabled'});await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);await expect.poll(()=>scroll.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-bottom')))).toBe(0);
});

test('standalone Calendar draft keeps its own Back and Save row; launcher headers retain their system inset',async({page})=>{
 await page.goto('/');await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await expect(page.getByRole('button',{name:'Back to apps',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Back to calendar',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save event',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await expect(page.getByRole('button',{name:'Back to apps',exact:true})).toBeVisible();await page.goto('/?shell=launcher');await page.getByRole('button',{name:'Files',exact:true}).click();await expect(page.getByRole('button',{name:'Back to apps',exact:true})).toHaveCount(0);expect(await page.locator('[data-alpha-app-header="main"]').evaluate(el=>getComputedStyle(el).marginTop)).toBe('44px');
});

for(const viewport of [{width:412,height:915},{width:1440,height:500}])test(`Files compact row remains aligned at ${viewport.width}x${viewport.height}`,async({page},info)=>{
 await page.setViewportSize(viewport);await page.goto('/');await page.getByRole('button',{name:'Files',exact:true}).click();const back=page.getByRole('button',{name:'Back to apps',exact:true}),title=page.getByRole('heading',{name:'Files',exact:true}),search=page.getByRole('button',{name:'Search files',exact:true});await back.click({trial:true});const a=(await back.boundingBox())!,b=(await title.boundingBox())!,c=(await search.boundingBox())!;expect(Math.abs(a.y+a.height/2-b.y-b.height/2)).toBeLessThanOrEqual(1);expect(Math.abs(a.y+a.height/2-c.y-c.height/2)).toBeLessThanOrEqual(1);if(viewport.width<=600)expect(c.height).toBeGreaterThanOrEqual(44);else expect(await search.evaluate(el=>getComputedStyle(el).height)).toBe('52px');expect(await title.evaluate(el=>getComputedStyle(el).fontSize)).toBe('20px');await page.screenshot({path:info.outputPath('files-compact-row.png'),animations:'disabled'});
});

test('a non-overflowing Files list has no edge fade',async({page})=>{
 await page.setViewportSize({width:412,height:1400});await page.goto('/');await page.getByRole('button',{name:'Files',exact:true}).click();const scroll=page.locator('[data-alpha-app-scroll="files"]');await expect(scroll).toBeVisible();expect(await scroll.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);await expect.poll(()=>scroll.evaluate(el=>({top:parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-top')),bottom:parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-bottom'))}))).toEqual({top:0,bottom:0});
});

test('small sheet follows the mouse down continuously and collapses near the bottom',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-layer=conversation]').evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.60)));}));await page.getByRole('button',{name:'Resize chat',exact:true}).click({trial:true});const handle=page.getByRole('button',{name:'Resize chat',exact:true}),panel=page.locator('[data-alpha-layer="conversation"]');const before=await panel.evaluate(el=>parseFloat(getComputedStyle(el).height)),box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+before-150,{steps:8});await expect(panel).toHaveCSS('transition-property','none');const during=await panel.evaluate(el=>parseFloat(getComputedStyle(el).height));expect(during).toBeLessThan(before-60);expect(during).toBeGreaterThan(0);await page.screenshot({path:info.outputPath('chat-follow-finger.png'),animations:'disabled'});await page.mouse.up();await expect(page.getByRole('button',{name:'Open conversation',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveCount(0);await expect(panel).toHaveCSS('height','0px');
});

test('touch capture can close the small sheet and pull the same pill into a sheet',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-layer=conversation]').evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.60)));}));await page.getByRole('button',{name:'Resize chat',exact:true}).click({trial:true});const cdp=await page.context().newCDPSession(page),handle=page.getByRole('button',{name:'Resize chat',exact:true}),panel=page.locator('[data-alpha-layer="conversation"]');let box=(await handle.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+90,id:1}]});await expect(panel).toHaveCSS('transition-property','none');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const pill=page.getByRole('button',{name:'Open conversation',exact:true});await expect(pill).toBeVisible();await pill.click({trial:true});box=(await pill.boundingBox())!;x=box.x+box.width/2;y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-120,id:2}]});await expect(panel).toHaveCSS('transition-property','none');expect(await panel.evaluate(el=>parseFloat(getComputedStyle(el).height))).toBeGreaterThan(100);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeVisible();await cdp.detach();
});

test('touch cancellation restores the prior detent without a click; keyboard controls still work',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-layer=conversation]').evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.60)));}));await page.getByRole('button',{name:'Resize chat',exact:true}).click({trial:true});const panel=page.locator('[data-alpha-layer="conversation"]'),before=await panel.evaluate(el=>getComputedStyle(el).height),handle=page.getByRole('button',{name:'Resize chat',exact:true}),box=(await handle.boundingBox())!,cdp=await page.context().newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+60,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expect(panel).toHaveCSS('height',before);await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();await cdp.detach();await page.getByRole('button',{name:'Expand chat',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
});

test('a tiny pill pointer wobble keeps the Type click and never opens a sheet',async({page})=>{
 await page.goto('/');const bar=(await page.locator('[data-alpha-input-bar]').boundingBox())!;await page.mouse.move(bar.x+3,bar.y+bar.height/2);await page.mouse.down();await page.mouse.move(bar.x+3,bar.y+bar.height/2+64,{steps:8});await page.mouse.up();const type=page.getByRole('button',{name:'Type',exact:true});await type.click({trial:true});const box=(await type.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+1,box.y+box.height/2-2);await page.mouse.up();await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);
});

test('short viewports keep the resized panel and grabber within the screen',async({page})=>{
 await page.setViewportSize({width:412,height:300});await page.goto('/');await page.getByRole('button',{name:'Open conversation',exact:true}).click();const panel=page.locator('[data-alpha-layer="conversation"]'),handle=page.getByRole('button',{name:'Resize chat',exact:true});await expect(handle).toBeInViewport();expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(300);await page.getByRole('button',{name:'Expand chat',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();await expect(handle).toHaveCount(0);await page.getByRole('button',{name:'Shrink chat',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();await expect(handle).toBeInViewport();await page.getByRole('button',{name:'Minimize chat',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'Open conversation',exact:true})).toBeVisible();
});

test('an incoming view change retires a captured drag without reopening chat on release',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-layer=conversation]').evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(await page.evaluate(()=>{const h=document.querySelector<HTMLElement>('[data-screen]')!.clientHeight;return Math.min(h,Math.max(200,h-72),Math.max(200,Math.round(h*.60)));}));await page.getByRole('button',{name:'Resize chat',exact:true}).click({trial:true});const handle=page.getByRole('button',{name:'Resize chat',exact:true}),box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+70,{steps:7});await page.evaluate(()=>document.querySelector<HTMLButtonElement>('button[aria-label="Calendar"]')!.click());await page.mouse.up();await expect(page.getByRole('region',{name:'Calendar',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open conversation',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);
});

for(const origin of ['background','alpha'] as const)for(const direction of ['down','up'] as const)test(`input bar ${origin} drag ${direction} follows the pointer and preserves the draft`,async({page})=>{
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Keep this unsent draft');const bar=page.locator('[data-alpha-input-bar]');await bar.getByRole('button',{name:'Open conversation',exact:true}).click({trial:true});const before=(await bar.boundingBox())!,alpha=bar.getByRole('button',{name:'Open conversation',exact:true}),a=(await alpha.boundingBox())!,x=origin==='background'?before.x+3:a.x+a.width/2,y=origin==='background'?before.y+before.height/2:a.y+a.height/2,delta=direction==='down'?DEFAULT_PULL_DISTANCE+8:-120;
 await page.evaluate(()=>{(window as any).motionClicks=0;document.addEventListener('click',event=>{const button=(event.target as Element)?.closest('button');if(button&&['Send','Talk'].includes(button.getAttribute('aria-label')||'')){(window as any).motionClicks++;event.preventDefault();event.stopImmediatePropagation();}},true);});
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+delta,{steps:10});await expect.poll(async()=>Math.abs((await bar.boundingBox())!.y-before.y)).toBeGreaterThan(30);expect(await bar.evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');await page.mouse.up();
 if(direction==='down'){await expect(page.getByRole('button',{name:'Type',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Type',exact:true}).click();await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toHaveValue('Keep this unsent draft');}
 else{await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Keep this unsent draft');}
 expect(await page.evaluate(()=>(window as any).motionClicks)).toBe(0);
});

test('touch input background can cancel to the exact input mode, then collapse to pill',async({page})=>{
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Unsent touch draft');const bar=page.locator('[data-alpha-input-bar]');await bar.getByRole('button',{name:'Open conversation',exact:true}).click({trial:true});const box=(await bar.boundingBox())!,x=box.x+3,y=box.y+box.height/2,cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-90,id:1}]});await expect(bar).toHaveCSS('transition-property','none');await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expect(input).toHaveValue('Unsent touch draft');await expect(bar).toHaveCSS('transform',/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);const current=(await bar.boundingBox())!;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:current.x+3,y:current.y+current.height/2,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:current.x+3,y:current.y+current.height/2+45,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.getByRole('button',{name:'Type',exact:true})).toBeVisible();await cdp.detach();
});

test('input textarea owns text selection and vertical scrolling without moving the bar',async({page})=>{
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true}),text='Select this authored text without moving the bar.\n'+'More authored text stays in the draft.\n'.repeat(24);await input.fill(text);await input.evaluate(el=>el.scrollTop=0);await input.click({trial:true});const box=(await input.boundingBox())!;await page.mouse.move(box.x+14,box.y+20);await page.mouse.down();await page.mouse.move(box.x+125,box.y+20,{steps:12});await page.mouse.up();expect(await input.evaluate((el:HTMLTextAreaElement)=>el.selectionEnd-el.selectionStart)).toBeGreaterThan(0);await expect(input).toHaveValue(text);await expect(page.locator('[data-alpha-input-bar]')).toHaveCSS('transform',/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);await input.hover();await page.mouse.wheel(0,180);await expect.poll(()=>input.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await expect(page.locator('[data-alpha-input-bar]')).toHaveCSS('transform',/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});

test('tiny Alpha input jitter remains a click; header is closer without shrinking the grab target',async({page})=>{
 await page.setViewportSize({width:412,height:430});await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();const alpha=page.locator('[data-alpha-input-bar]').getByRole('button',{name:'Open conversation',exact:true});await alpha.click({trial:true});const box=(await alpha.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+1,box.y+box.height/2-2);await page.mouse.up();const grab=page.getByRole('button',{name:'Resize chat',exact:true});await expect(grab).toBeVisible();expect((await grab.boundingBox())!.height).toBeGreaterThanOrEqual(44);const mark=(await grab.locator('span').boundingBox())!,header=(await page.locator('[data-alpha-chat-header]').boundingBox())!;expect(header.y+header.height/2-mark.y-mark.height/2).toBeLessThanOrEqual(32);await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'Minimize chat',exact:true})).toBeInViewport();
});

for(const target of ['Send','Talk'])test(`an input Alpha drag released over ${target} never synthesizes its click`,async({page})=>{
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();if(target==='Send')await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Never send from a drag');const bar=page.locator('[data-alpha-input-bar]');await bar.getByRole('button',{name:'Open conversation',exact:true}).click({trial:true});const alpha=(await bar.getByRole('button',{name:'Open conversation',exact:true}).boundingBox())!,button=(await bar.getByRole('button',{name:target,exact:true}).boundingBox())!;await page.evaluate(target=>{(window as any).lateInputAction=0;document.addEventListener('click',event=>{if((event.target as Element)?.closest(`button[aria-label="${target}"]`)){(window as any).lateInputAction++;event.preventDefault();event.stopImmediatePropagation();}},true);},target);await page.mouse.move(alpha.x+alpha.width/2,alpha.y+alpha.height/2);await page.mouse.down();await page.mouse.move(alpha.x+alpha.width/2,alpha.y+alpha.height/2-90,{steps:9});await page.mouse.move(button.x+button.width/2,button.y+button.height/2,{steps:9});await page.mouse.up();expect(await page.evaluate(()=>(window as any).lateInputAction)).toBe(0);await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toHaveValue(target==='Send'?'Never send from a drag':'');
});

for(const viewport of [{width:412,height:915},{width:1440,height:500}])for(const pointer of ['mouse','touch'] as const)test(`empty placeholder ${pointer} short pull and tap at ${viewport.width}x${viewport.height}`,async({page})=>{
 await page.setViewportSize(viewport);await page.goto('/');const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await expect(input).toBeVisible();
 const cdp=pointer==='touch'?await page.context().newCDPSession(page):null;
 async function pull(up:boolean){
  await input.click({trial:true});const box=(await input.boundingBox())!,scale=await page.locator('[data-screen]').evaluate(el=>el.getBoundingClientRect().height/(el as HTMLElement).clientHeight),x=box.x+box.width/2,y=box.y+box.height/2,delta=(up?-32:32)*scale;
  expect(y+Math.max(0,delta)).toBeLessThan(viewport.height);
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});else{await page.mouse.move(x,y);await page.mouse.down();}
  for(let step=1;step<=6;step++){await page.waitForTimeout(65);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+delta*step/6,id:1}]});else await page.mouse.move(x,y+delta*step/6);}
  await expect(input).not.toBeFocused();
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
 }
 await pull(false);await expect(page.getByRole('button',{name:'Type',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Type',exact:true}).click();await expect(input).toHaveValue('');
 if(cdp){const box=(await input.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else await input.click();
 await expect(input).toBeFocused();await expect(input).toHaveValue('');await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);await input.evaluate(el=>(el as HTMLTextAreaElement).blur());
 await pull(true);await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('');await page.screenshot({animations:'disabled',path:test.info().outputPath(`empty-placeholder-${pointer}.png`)});await cdp?.detach();
});

for(const view of ['Settings','Notes','Files'])test(`${view} Back beside the half chat collapses it first, then works, while full chat isolates the app`,async({page},info)=>{
 await page.setViewportSize({width:412,height:915});await page.goto('/');await page.getByRole('button',{name:view,exact:true}).click();
 const app=view==='Notes'?page.locator('[role="region"][aria-label="Notes"]').filter({has:page.locator('h1').filter({hasText:/^Notes$/})}):page.locator('[data-alpha-layer="app"]'),back=app.locator('button[aria-label="Back to apps"]');
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Keep this unsent draft');await page.locator('[data-alpha-layer=conversation]').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 await expect(back).toBeVisible();await expect(app).not.toHaveAttribute('inert','');await expect(app).toHaveAttribute('aria-hidden','false');expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:info.outputPath('header-live-beside-sheet.png'),animations:'disabled'});await page.mouse.click(((await back.boundingBox())!).x+22,((await back.boundingBox())!).y+22);await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(0);await expect(page.locator('html')).toHaveAttribute('data-active-view',view.toLowerCase());await back.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','home');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toHaveValue('Keep this unsent draft');
 await page.getByRole('button',{name:view,exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await expect(app).toHaveAttribute('inert','');await expect(app).toHaveAttribute('aria-hidden','true');await expect(app.getByRole('button',{name:'Back to apps',exact:true})).toHaveCount(0);
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('[inert]'))).toBe(false);}
 await page.getByRole('button',{name:'Shrink chat',exact:true}).click();await expect(app).not.toHaveAttribute('inert','');await back.press('Enter');await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
});
// The sheet's scrim takes touch and wheel above it (f21e9a6e4); the scroll range and keyboard focus stay.
test('half chat keeps app scrolling and keyboard-focused Settings controls above the sheet',async({page})=>{
 await page.setViewportSize({width:412,height:640});await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 const panel=page.locator('[data-alpha-layer="conversation"]'),app=page.locator('[data-alpha-layer="app"]');await panel.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const scroll=app.locator('[data-alpha-app-scroll="settings"]'),target=app.getByRole('button',{name:'Agent connection',exact:true});await scroll.evaluate(el=>el.scrollTop=0);await target.focus();await expect(target).toBeFocused();
 expect((await target.boundingBox())!.y+(await target.boundingBox())!.height).toBeLessThanOrEqual((await panel.boundingBox())!.y-8);await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
 await app.getByRole('button',{name:'Back to apps',exact:true}).press('Enter');await page.getByRole('button',{name:'Open conversation',exact:true}).click();const home=page.locator('[data-alpha-layer="home"]');await expect(home).not.toHaveAttribute('inert','');await home.evaluate(el=>{el.scrollTop=120;});await expect.poll(()=>home.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
});
test('Calendar month dialog retains priority and focus over half chat',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('button',{name:'Month view',exact:true}).press('Enter');
 const dialog=page.getByRole('dialog',{name:'Choose calendar date',exact:true});await expect(dialog).toBeVisible();await expect(page.locator('[data-alpha-layer="conversation"]')).toBeHidden();await expect.poll(()=>dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 const first=dialog.getByRole('button').first(),last=dialog.getByRole('button').last();await last.focus();await page.keyboard.press('Tab');await expect(first).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Month view',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
});
for(const key of ['Enter','Space'])test(`chat Alpha brand returns Home with ${key} and keeps the unsent draft`,async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Keep this exact unsent draft');
 await page.locator('[data-alpha-layer=conversation]').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const brand=page.getByRole('button',{name:'Go Home',exact:true});await expect(brand).toHaveCount(1);await expect(brand).toContainText('Alpha');expect((await brand.boundingBox())!.height).toBeGreaterThanOrEqual(44);await brand.focus();await brand.press(key);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Keep this exact unsent draft');await expect(page.getByRole('button',{name:'Resize chat',exact:true})).toHaveCount(1);
});
test('a completed grabber drag cannot activate the chat Home brand through a late click',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();const handle=page.getByRole('button',{name:'Resize chat',exact:true});await handle.click({trial:true});
 // Dispatch the late click in the same event turn as pointerup, inside the existing gesture fence.
 await handle.evaluate(element=>{const b=element.getBoundingClientRect(),point={bubbles:true,pointerId:97,pointerType:'mouse',button:0,isPrimary:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2};element.dispatchEvent(new PointerEvent('pointerdown',point));element.dispatchEvent(new PointerEvent('pointermove',{...point,clientY:point.clientY-120}));element.dispatchEvent(new PointerEvent('pointerup',{...point,clientY:point.clientY-120}));document.querySelector<HTMLButtonElement>('[data-alpha-chat-home]')!.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));});
 await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
});
test('a separate Expand tap immediately after Open is not swallowed as a duplicate gesture',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));await page.goto('/');await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 const app=page.locator('[data-alpha-layer="app"]');await expect(app).toHaveAttribute('inert','');await expect(app).toHaveAttribute('aria-hidden','true');await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Shrink chat',exact:true}).press('Enter');await expect(app).not.toHaveAttribute('inert','');await expect(app).toHaveAttribute('aria-hidden','false');
});
