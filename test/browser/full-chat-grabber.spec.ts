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
const card=(page:Page)=>page.getByRole('button',{name:'Open your calendar',exact:true});
test('the first click outside collapses and is captured; the next one reaches the app',async({page})=>{
 await sheet(page);
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
  await sheet(page);
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
