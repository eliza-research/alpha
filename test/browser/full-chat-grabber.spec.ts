import {test,expect,type Page} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';

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
const card=(page:Page)=>page.locator('[data-alpha-home-calendar]');
// Home draws its calendar card only with an event (docs/daily-overview.md), so one is saved first;
// the card is the control above the sheet.
async function eventSheet(page:Page){
 await page.setViewportSize({width:412,height:915});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?shell=launcher&tools=1');
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts'),date=new Date(Date.now()+2*86400000);date.setHours(9,30,0,0);await new BrowserCalendar().save({calendarId:'local',title:'Synthetic outside target',begin:date.getTime(),end:date.getTime()+1800000,allDay:false,creationId:crypto.randomUUID()});});
 await page.reload();
 // Home reads the browser calendar once it is chosen in Calendar (as home-daily-overview.spec.ts).
 // Back leaves Calendar (its root) for Home directly: no chat is opened on the way.
 await openBrowserCalendar(page);await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
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

// One rule for every raised dock (docs/gesture-zones.md): the bar raised from
// the pill, or the bar with the keyboard up, takes the first touch outside it, lowers to its
// resting form and reaches nothing underneath.
test.describe('raised dock',()=>{
 const open=async(page:Page)=>{await page.setViewportSize({width:412,height:915});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?shell=launcher&tools=1');};
 const composer=(page:Page)=>page.locator('[data-alpha-layer="composer"] textarea[data-alpha-composer]');
 const guard=(page:Page)=>page.locator('[data-alpha-dock-guard]');
 const pill=(page:Page)=>page.locator('[data-alpha-layer="pill"]');
 const appState=(page:Page)=>page.evaluate(()=>location.href+document.querySelector('[data-alpha-layer="app"]')?.innerHTML.length);
 async function raiseInNotes(page:Page){
  await open(page);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
  await pill(page).getByRole('button',{name:'Type',exact:true}).click();
  await expect(composer(page)).toBeFocused();
  await expect(guard(page)).toHaveCSS('pointer-events','auto');
 }
 test('the bar raised from the pill lowers on the first outside tap, which reaches nothing; Back lowers it before leaving',async({page})=>{
  await raiseInNotes(page);
  await composer(page).fill('keep this draft');
  const before=await appState(page);
  await page.mouse.click(206,300);
  await expect(pill(page)).toBeVisible();
  await expect(page.locator('[data-alpha-layer="composer"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
  expect(await appState(page)).toBe(before);
  await expect(guard(page)).toHaveCSS('pointer-events','none');
  // The draft survives lowering.
  await pill(page).getByRole('button',{name:'Type',exact:true}).click();
  await expect(composer(page)).toHaveValue('keep this draft');
  await composer(page).blur();
  // A bar raised over a pill view is still raised without the keyboard: Back lowers it first.
  await expect(guard(page)).toHaveCSS('pointer-events','auto');
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
  await expect(pill(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
 });
 test('a drag outside the raised bar lowers it on release and scrolls nothing',async({page})=>{
  await raiseInNotes(page);
  const before=await appState(page);
  await page.mouse.move(206,500);await page.mouse.down();await page.mouse.move(206,300,{steps:8});
  await expect(composer(page)).toBeVisible();
  await page.mouse.up();
  await expect(pill(page)).toBeVisible();
  expect(await appState(page)).toBe(before);
 });
 test('a long press outside the raised bar lowers it and opens no menu',async({page})=>{
  await raiseInNotes(page);
  const before=await appState(page);
  await page.mouse.click(206,300,{button:'right'});
  await expect(pill(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
  expect(await appState(page)).toBe(before);
 });
 test('with the keyboard up on Home the first tap only closes it; the next opens the app',async({page})=>{
  await open(page);
  await composer(page).click();
  await expect(composer(page)).toBeFocused();
  await expect(guard(page)).toHaveCSS('pointer-events','auto');
  const icon=(await page.getByRole('button',{name:'Calendar',exact:true}).boundingBox())!;
  await page.mouse.click(icon.x+icon.width/2,icon.y+icon.height/2);
  await expect(composer(page)).not.toBeFocused();
  await expect(guard(page)).toHaveCSS('pointer-events','none');
  await page.waitForTimeout(300);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
  await page.mouse.click(icon.x+icon.width/2,icon.y+icon.height/2);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 });
 test('when the keyboard closes by itself the composer lets go and Home taps work again',async({page})=>{
  await open(page);
  await composer(page).click();
  await expect(guard(page)).toHaveCSS('pointer-events','auto');
  // adjustResize: the window shrinks with the keyboard and grows back when it closes.
  const size=page.viewportSize()!;
  await page.setViewportSize({width:size.width,height:size.height-320});await page.waitForTimeout(300);
  await expect(composer(page)).toBeFocused();
  await page.setViewportSize(size);
  await expect(composer(page)).not.toBeFocused();
  await expect(guard(page)).toHaveCSS('pointer-events','none');
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
 test.describe('touch',()=>{
  test.use({hasTouch:true});
  test('the first tap outside the raised bar lowers it; the next tap reaches the app',async({page})=>{
   await raiseInNotes(page);
   await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
   await expect(pill(page)).toBeVisible();
   await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
   await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
   await composer(page).click();
   await expect(guard(page)).toHaveCSS('pointer-events','auto');
   const icon=(await page.getByRole('button',{name:'Calendar',exact:true}).boundingBox())!,x=icon.x+icon.width/2,y=icon.y+icon.height/2;
   await page.touchscreen.tap(x,y);
   await expect(composer(page)).not.toBeFocused();
   await page.waitForTimeout(400);
   await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
   await page.touchscreen.tap(x,y);
   await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
  });
  // Android sends a tap's click as a separate gesture-tap input after touchend, so other
  // tasks can run between pointerup and click. The guard must still be the click's target.
  test('a click that arrives well after pointerup still lands on the guard, not the app',async({page})=>{
   await raiseInNotes(page);
   const before=await appState(page);
   const hit=await page.evaluate(async()=>{
    const x=206,y=300,el=document.elementFromPoint(x,y) as HTMLElement;
    const init={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,pointerId:7,pointerType:'touch',isPrimary:true};
    el.dispatchEvent(new PointerEvent('pointerdown',init));
    el.dispatchEvent(new PointerEvent('pointerup',init));
    await new Promise(r=>setTimeout(r,120));
    const target=document.elementFromPoint(x,y) as HTMLElement;
    const guarded=target.hasAttribute('data-alpha-dock-guard');
    target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y,detail:1}));
    return {first:el.hasAttribute('data-alpha-dock-guard'),guarded};
   });
   expect(hit).toEqual({first:true,guarded:true});
   await expect(pill(page)).toBeVisible();
   await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
   expect(await appState(page)).toBe(before);
  });
  test('a released press that sends no click still lowers the dock',async({page})=>{
   await raiseInNotes(page);
   await page.evaluate(()=>{
    const el=document.elementFromPoint(206,300) as HTMLElement;
    const init={bubbles:true,cancelable:true,composed:true,clientX:206,clientY:300,pointerId:8,pointerType:'touch',isPrimary:true};
    el.dispatchEvent(new PointerEvent('pointerdown',init));
    el.dispatchEvent(new PointerEvent('pointerup',init));
   });
   await expect(pill(page)).toBeVisible();
   await expect(guard(page)).toHaveCSS('pointer-events','none');
  });
 });
 test.describe('landscape',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:915,height:412}});
  test('the dock sits beside Home, so a focused composer guards nothing',async({page})=>{
   await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
   await page.goto('/?shell=launcher&tools=1');
   await composer(page).click();
   await expect(composer(page)).toBeFocused();
   await expect(guard(page)).toHaveCSS('pointer-events','none');
  });
 });
});
