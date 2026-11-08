import {installHomeCalendar} from './helpers/home-calendar';
import {test,expect,type Page} from '@playwright/test';

// The Resize chat grabber moves the open sheet: it rests where released, snaps only near the
// collapsed form or the top, and a flick jumps. Full screen has no grabber, so nothing of Alpha's
// competes with the top edge, where a pull is Android's shade (docs/gesture-zones.md).
const panel=(page:Page)=>page.locator('[data-alpha-layer="conversation"]');
const grabber=(page:Page)=>page.getByRole('button',{name:'Resize chat',exact:true});
const height=(page:Page)=>panel(page).evaluate(element=>parseFloat(getComputedStyle(element).height));
async function sheet(page:Page,url='/?shell=launcher&tools=1'){
 await page.setViewportSize({width:412,height:915});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(url);
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(grabber(page)).toBeVisible();
 await panel(page).evaluate(element=>Promise.all(element.ownerDocument.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
}
/** A deliberate drag: the finger stops before it lifts, so it is never a flick. */
async function slow(page:Page,dy:number){
 const box=(await grabber(page).boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+dy,{steps:8});
 await page.waitForTimeout(160);await page.mouse.up();
}
/** A finger flick through Chromium's touch pipeline: lifted at speed, far from either zone. */
async function flick(page:Page,dy:number){
 const box=(await grabber(page).boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2,cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await cdp.detach();
}

for(const dy of [-120,90])test(`a slow drag of ${dy} rests where it is released`,async({page})=>{
 await sheet(page);
 const before=await height(page);
 await slow(page,dy);
 await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
 await expect.poll(()=>height(page)).toBeCloseTo(before-dy,0);
 await page.waitForTimeout(500);
 expect(Math.abs(await height(page)-(before-dy))).toBeLessThan(1);
});

test('a slow drag near the collapsed form collapses',async({page})=>{
 await sheet(page);
 await slow(page,await height(page)-150);
 await expect(grabber(page)).toHaveCount(0);
 await expect.poll(()=>height(page)).toBe(0);
 await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
});

test('a slow drag near the top goes full screen and the grabber goes away',async({page})=>{
 await sheet(page);
 await slow(page,-(915-(await height(page))-60));
 await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
 await expect(grabber(page)).toHaveCount(0);
});

test.describe('touch',()=>{
 test.use({hasTouch:true});
 test('a flick jumps to either end',async({page})=>{
 await sheet(page);
 await flick(page,-200);
 await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Shrink chat',exact:true}).click();
 await expect(grabber(page)).toBeVisible();
 await panel(page).evaluate(element=>Promise.all(element.ownerDocument.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 await flick(page,200);
 await expect(grabber(page)).toHaveCount(0);
 await expect.poll(()=>height(page)).toBe(0);
});
});

test('Shrink chat returns to the height the person left, and Minimize collapses',async({page})=>{
 await sheet(page);
 await slow(page,120);
 const rested=await height(page);
 // Toolbar taps are ignored for 350ms after a drag, as a compatibility click may follow one.
 await page.waitForTimeout(400);
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await page.getByRole('button',{name:'Shrink chat',exact:true}).click();
 await expect.poll(()=>height(page)).toBeCloseTo(rested,0);
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await expect(grabber(page)).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
});

for(const inset of [0,52])test(`full chat header clears the status bar with no grabber: inset ${inset}`,async({page})=>{
 await sheet(page);
 await page.evaluate(value=>document.documentElement.style.setProperty('--native-top-inset',`${value}px`),inset);
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 const shrink=page.getByRole('button',{name:'Shrink chat',exact:true});
 await expect(shrink).toBeVisible();
 await expect(grabber(page)).toHaveCount(0);
 await panel(page).evaluate(element=>Promise.all(element.ownerDocument.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const box=(await shrink.boundingBox())!,screen=(await page.locator('[data-screen]').boundingBox())!;
 // 44px status bar band in the browser; on a phone the measured inset, plus 16 screen pixels.
 expect(box.y-screen.y).toBeGreaterThanOrEqual(Math.max(44,inset)+16);
 // The controls keep the right edge with the grabber's column empty.
 expect(box.x+box.width).toBeGreaterThan(screen.x+screen.width-120);
 await expect(page.locator('[data-alpha-layer="shade"]')).not.toBeInViewport();
});

// Outside the open sheet the first touch only collapses the chat; the next one is ordinary.
const activeView=(page:Page)=>page.locator('html').getAttribute('data-active-view');
// Home draws its calendar card only with an event (docs/ui-refresh-2026-11), so one is saved first;
// the card is the control above the sheet.
const card=(page:Page)=>page.getByRole('button',{name:/^Open calendar event: Synthetic outside target/});
async function eventSheet(page:Page){
 await page.setViewportSize({width:412,height:915});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?shell=launcher&tools=1');
 const start=new Date(Date.now()+2*86400000);start.setHours(9,30,0,0);
 await installHomeCalendar(page,{title:'Synthetic outside target',startAt:start.toISOString(),endAt:new Date(start.getTime()+1800000).toISOString()});
 await expect(card(page)).toBeVisible();
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(grabber(page)).toBeVisible();
 await panel(page).evaluate(element=>Promise.all(element.ownerDocument.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
}
test('the first click outside collapses and is captured; the next one reaches the app',async({page})=>{
 await eventSheet(page);
 const box=(await card(page).boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.click(x,y);
 await expect(grabber(page)).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
 await page.waitForTimeout(300);
 expect(await activeView(page)).toBe('home');
 await page.mouse.click(x,y);
 await expect.poll(()=>activeView(page)).toBe('calendar');
});

test.describe('focused Home composer',()=>{
 test.use({hasTouch:true});
 for(const touch of [false,true])test(`outside ${touch?'touch':'click'} dismisses the composer before opening an app`,async({page})=>{
  await page.setViewportSize({width:412,height:915});
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/?shell=launcher&tools=1');
  const composer=page.getByRole('textbox',{name:'Ask Alpha',exact:true});
  await composer.fill('Keep this draft');
  await expect(composer).toBeFocused();
  const settings=page.locator('[data-alpha-layer="home"]').getByRole('button',{name:'Settings',exact:true});
  const box=(await settings.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
  const tap=()=>touch?page.touchscreen.tap(x,y):page.mouse.click(x,y);
  await tap();
  await expect(composer).not.toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
  await expect(composer).toHaveValue('Keep this draft');
  await tap();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 });
 test('the composer raised from the pill returns to it with the draft',async({page})=>{
  await page.setViewportSize({width:412,height:915});
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const type=page.getByRole('button',{name:'Type',exact:true});
  await type.click();
  const composer=page.locator('[data-alpha-input-bar] textarea');
  await composer.fill('Keep this Settings draft');
  await expect(composer).toBeFocused();
  const back=page.getByRole('button',{name:'Back to apps',exact:true});
  const box=(await back.boundingBox())!;
  await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  await expect(type).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
  await type.click();
  await expect(composer).toHaveValue('Keep this Settings draft');
 });
});

test('a drag outside collapses and neither scrolls nor pulls anything',async({page})=>{
 await sheet(page);
 const home=page.locator('[data-alpha-layer="home"]');
 await page.mouse.move(206,120);await page.mouse.down();await page.mouse.move(206,240,{steps:6});
 await expect(grabber(page)).toBeVisible();
 await page.mouse.up();
 await expect(grabber(page)).toHaveCount(0);
 expect(await home.evaluate(element=>element.scrollTop)).toBe(0);
 await expect(page.locator('[data-alpha-layer="shade"]')).not.toBeInViewport();
 expect(await activeView(page)).toBe('home');
});

test('a tap inside the sheet does not collapse it, and full screen has nothing outside',async({page})=>{
 await sheet(page);
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).click();
 await expect(grabber(page)).toBeVisible();
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await expect(page.locator('[data-alpha-chat-scrim]')).toHaveCSS('pointer-events','none');
});

test.describe('touch outside',()=>{
 test.use({hasTouch:true});
 test('the first tap collapses and is captured; the next tap reaches the app',async({page})=>{
  await eventSheet(page);
  const box=(await card(page).boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
  await page.touchscreen.tap(x,y);
  await expect(grabber(page)).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await activeView(page)).toBe('home');
  await page.touchscreen.tap(x,y);
  await expect.poll(()=>activeView(page)).toBe('calendar');
 });
});

test.describe('landscape',()=>{
 test.use({hasTouch:true,isMobile:true,viewport:{width:915,height:412}});
 test('the chat docks beside Home, so Home keeps its taps',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/?shell=launcher&tools=1');
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  await expect(grabber(page)).toBeVisible();
  await expect(page.locator('[data-alpha-chat-scrim]')).toHaveCSS('pointer-events','none');
 });
});

// One rule for every raised dock (docs/ui-refresh-2026-11, tla/ChatInput.tla).
test.describe('raised dock',()=>{
 const open=async(page:Page)=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?shell=launcher&tools=1');};
 test('the bar raised from the pill lowers on the first outside tap, which reaches nothing; Back lowers it before leaving',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
  const pill=page.locator('[data-alpha-layer="pill"]');
  await pill.getByRole('button',{name:'Type',exact:true}).click();
  const composer=page.locator('[data-alpha-layer="composer"] textarea[data-alpha-composer]');
  await expect(composer).toBeFocused();
  await composer.fill('keep this draft');
  const before=await page.evaluate(()=>location.href+document.querySelector('[data-alpha-layer="app"]')?.innerHTML.length);
  await page.mouse.click(206,300);
  await expect(pill).toBeVisible();
  await expect(page.locator('[data-alpha-layer="composer"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
  expect(await page.evaluate(()=>location.href+document.querySelector('[data-alpha-layer="app"]')?.innerHTML.length)).toBe(before);
  // The draft survives lowering.
  await pill.getByRole('button',{name:'Type',exact:true}).click();
  await expect(composer).toHaveValue('keep this draft');
  await composer.blur();
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
  await expect(pill).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
 });
 test('with the keyboard up on Home the first tap only closes it; the next opens the app',async({page})=>{
  await open(page);
  const composer=page.locator('[data-alpha-layer="composer"] textarea[data-alpha-composer]');
  await composer.click();
  await expect(composer).toBeFocused();
  const icon=(await page.getByRole('button',{name:'Calendar',exact:true}).boundingBox())!;
  await page.mouse.click(icon.x+icon.width/2,icon.y+icon.height/2);
  await expect(composer).not.toBeFocused();
  await page.waitForTimeout(300);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
  await page.mouse.click(icon.x+icon.width/2,icon.y+icon.height/2);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 });
 test('when the keyboard closes by itself the composer lets go and Home taps work again',async({page})=>{
  await open(page);
  const composer=page.locator('[data-alpha-layer="composer"] textarea[data-alpha-composer]');
  await composer.click();
  await expect(page.locator('[data-alpha-dock-guard]')).toHaveCSS('pointer-events','auto');
  // adjustResize: the window shrinks with the keyboard and grows back when it closes.
  const size=page.viewportSize()!;
  await page.setViewportSize({width:size.width,height:size.height-320});await page.waitForTimeout(300);
  await page.setViewportSize(size);
  await expect(composer).not.toBeFocused();
  await expect(page.locator('[data-alpha-dock-guard]')).toHaveCSS('pointer-events','none');
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 });
 test('an upward drag on Home content opens nothing; a drag up from the bar opens the chat',async({page})=>{
  await open(page);
  const conversation=page.locator('[data-alpha-layer="conversation"]');
  await page.mouse.move(206,520);await page.mouse.down();await page.mouse.move(206,240,{steps:8});await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(conversation).toHaveAttribute('aria-hidden','true');
  const bar=(await page.locator('[data-alpha-input-bar]').boundingBox())!;
  await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height/2);await page.mouse.down();await page.mouse.move(bar.x+bar.width/2,bar.y-300,{steps:10});await page.mouse.up();
  await expect(conversation).toHaveAttribute('aria-hidden','false');
 });
});
