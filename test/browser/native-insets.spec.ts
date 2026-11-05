import {test,expect} from '@playwright/test';

async function nativeContent(page:any,url:string,insets:{top:number;bottom:number;left:number;right:number},width=412,height=915,launcher=false,residualInsets={top:0,bottom:0}){
 await page.addInitScript(({launcher,residualInsets})=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const w=window as any;w.androidBridge={};
  const names=['DailyApps','AlphaBrowser','AlphaConnection','AlphaDevice','AlphaLocalAgent','AlphaHostedResults','AlphaVoiceCloud','AlphaNotifications','ElizaSystem','AlphaCalendar','AlphaNoteDocuments','AlphaNoteAudio','AlphaFiles','AlphaPhotos','DeviceApps','ElizaLocation','AlphaActionJournal','AlphaDeletions'];
  const methods=['addListener','removeListener','surfaceInfo','readPending','readPendingResult','readDelegationCallback','readSecret','secureRead','secureWrite','secureRemove','get','status','getStatus','getState','state','permissionState','permissions','list','listCalendars','listEvents','listReminders','listBookmarks','getBookmarks','bookmarks','settings','getSettings','buildInfo','capabilities','query','read','readJournal','getPending','readSelection','pending'];
  w.Capacitor={Plugins:{},PluginHeaders:names.map(name=>({name,methods:methods.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),nativeCallback:()=> 'fixture-callback',nativePromise:async(_plugin:string,method:string)=>{
   // Standalone bars are outside the WebView; launcher bars remain inside it.
   if(method==='surfaceInfo')return {topInset:residualInsets.top,bottomInset:residualInsets.bottom};
   if(method==='buildInfo')return {launcher};
   if(_plugin==='AlphaDeletions'&&method==='pending')return {deletions:[],deletedOrigins:[]};
   if(['secureRead','readSecret'].includes(method))return {value:null};
   return {apps:[],events:[],calendars:[],reminders:[],bookmarks:[],results:[],items:[],entries:[],pending:[],capabilities:[],available:false};
  }};
 },{launcher,residualInsets});
 await page.setViewportSize({width,height});
 await page.route('**/__native-insets-fixture',route=>route.fulfill({contentType:'text/html',body:'<!DOCTYPE html><html><body style="margin:0"></body></html>'}));
 await page.goto(new URL('/__native-insets-fixture',url).href);
 // An iframe is the WebView's usable native rectangle. It does not emulate Android framework dispatch.
 await page.setContent(`<iframe title="Standalone WebView" src="${url}" style="position:absolute;border:0;left:${insets.left}px;top:${insets.top}px;width:${width-insets.left-insets.right}px;height:${height-insets.top-insets.bottom}px"></iframe>`);
 const frame=page.frameLocator('iframe');
 await expect(frame.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
 return frame;
}

test('fitted standalone navigation stays below native bars and returns to apps by pointer and keyboard',async({page},testInfo)=>{
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:28,bottom:48,left:0,right:0});
 await frame.getByRole('button',{name:'Notes',exact:true}).click();
 const back=frame.getByRole('button',{name:'Back to apps',exact:true});await expect(back).toBeVisible();
 expect((await back.boundingBox())!.y).toBeGreaterThanOrEqual(28);
 await back.click();await expect(frame.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
 await frame.getByRole('button',{name:'Notes',exact:true}).click();
 await back.focus();await back.press('Enter');await expect(frame.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
});

for(const width of [412,360])test(`native launcher chat clears three-button navigation at ${width}px and preserves its draft through keyboard resizing`,async({page},testInfo)=>{
 const height=915,navigation=48;
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:0,bottom:0,left:0,right:0},width,height,true,{top:28,bottom:navigation});
 const floating=frame.locator('[data-alpha-input-bar]');
 const panel=frame.locator('[data-alpha-layer="conversation"]');
 const panelComposer=panel.locator('.alpha-chat-composer');
 const clearOfBottom=async(control:any,safeBottom:number)=>{
  await expect(control).toBeVisible();
  await expect.poll(async()=>{const box=await control.boundingBox();return box?box.y+box.height:Infinity;}).toBeLessThanOrEqual(safeBottom-10);
 };
 await clearOfBottom(floating,height-navigation);
 await floating.locator('textarea').fill('Keep this draft');
 await floating.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(frame.locator('[data-screen]')).toHaveAttribute('data-alpha-chat-half','true');
 await clearOfBottom(panelComposer,height-navigation);
 await expect(panelComposer.locator('textarea')).toHaveValue('Keep this draft');
 await panel.getByRole('button',{name:'Expand chat',exact:true}).click();
 await clearOfBottom(panelComposer,height-navigation);
 await panelComposer.locator('textarea').fill('Keep this draft\nwhile the keyboard opens');
 // MainActivity fits the visible IME natively and clears the residual CSS inset.
 // This models the resulting WebView rectangle, not Android keyboard dispatch.
 await frame.locator('html').evaluate(node=>node.style.setProperty('--native-bottom-inset','0px'));
 await page.locator('iframe').evaluate((node:any)=>node.style.height='420px');
 await clearOfBottom(panelComposer,420);
 await expect(panelComposer.locator('textarea')).toHaveValue('Keep this draft\nwhile the keyboard opens');
 await page.locator('iframe').evaluate((node:any)=>node.style.height='915px');
 await frame.locator('html').evaluate(node=>node.style.setProperty('--native-bottom-inset','48px'));
 await clearOfBottom(panelComposer,height-navigation);
 await expect(panelComposer.locator('textarea')).toHaveValue('Keep this draft\nwhile the keyboard opens');
});

test('native standalone chat uses its fitted WebView without reserving the system bar twice',async({page},testInfo)=>{
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:28,bottom:48,left:0,right:0});
 await frame.getByRole('button',{name:'Open conversation',exact:true}).click();
 const composer=frame.locator('[data-alpha-layer="conversation"] .alpha-chat-composer');
 await expect(composer).toBeVisible();
 await expect.poll(async()=>{const box=(await composer.boundingBox())!;return 915-48-box.y-box.height;}).toBeGreaterThanOrEqual(20);
 await expect.poll(async()=>{const box=(await composer.boundingBox())!;return 915-48-box.y-box.height;}).toBeLessThan(48);
});

test('native launcher keeps a long actionable notice scrollable above a multiline composer',async({page},testInfo)=>{
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:0,bottom:0,left:0,right:0},360,420,true,{top:28,bottom:48});
 await frame.getByRole('button',{name:'Open conversation',exact:true}).click();
 await frame.getByRole('button',{name:'Expand chat',exact:true}).click();
 await frame.locator('html').evaluate(async()=>{
  const {Component}=await import('/src/prototype/model.js');
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  const render=Component.prototype.renderVals;
  Component.prototype.renderVals=function(){(window as any).noticeLayoutShell=this;return render.call(this);};
  connectionController.close();
 });
 await expect.poll(()=>frame.locator('html').evaluate(()=>!!(window as any).noticeLayoutShell)).toBe(true);
 const composer=frame.locator('[data-alpha-layer="conversation"] .alpha-chat-composer');
 await composer.locator('textarea').fill('First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\nSeventh line\nEighth line');
 await expect.poll(()=>composer.locator('textarea').evaluate(node=>node.clientHeight)).toBeGreaterThan(60);
 await frame.locator('html').evaluate(()=>{
  const shell=(window as any).noticeLayoutShell;
  shell.toast('Unable to save the item. Review the account and try again. '.repeat(20),{undo:()=>{(window as any).noticeUndoInvoked=true;}});
  shell.clear('t');
 });
 const notice=frame.locator('[data-alpha-toast]');
 await expect(notice).toContainText('Unable to save the item.');
 await expect.poll(()=>notice.evaluate(node=>{
  const header=document.querySelector('[data-alpha-layer="conversation"] [data-alpha-chat-header]')!;
  return node.getBoundingClientRect().top-header.getBoundingClientRect().bottom;
 })).toBeGreaterThanOrEqual(6);
 await expect.poll(()=>notice.evaluate(node=>{
  const input=document.querySelector('[data-alpha-layer="conversation"] .alpha-chat-composer')!;
  return input.getBoundingClientRect().top-node.getBoundingClientRect().bottom;
 })).toBeGreaterThanOrEqual(8);
 await expect.poll(()=>notice.evaluate(node=>node.scrollHeight-node.clientHeight)).toBeGreaterThan(0);
 // The start of a long message must not be centered above its scroll container.
 await expect.poll(()=>notice.evaluate(node=>node.querySelector('span')!.getBoundingClientRect().top-node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
 await page.screenshot({path:testInfo.outputPath('long-notice-multiline-composer.png'),animations:'disabled'});
 await notice.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>frame.locator('html').evaluate(()=>(window as any).noticeUndoInvoked)).toBe(true);
 await expect(composer.locator('textarea')).toHaveValue('First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\nSeventh line\nEighth line');
});

for(const width of [412,640])test(`a very short window with the keyboard open keeps an Undo notice visible and tappable at ${width}px`,async({page},testInfo)=>{
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:0,bottom:0,left:0,right:0},width,915,true,{top:24,bottom:0});
 await frame.locator('html').evaluate(async()=>{
  const {Component}=await import('/src/prototype/model.js');
  const render=Component.prototype.renderVals;
  Component.prototype.renderVals=function(){(window as any).noticeLayoutShell=this;return render.call(this);};
 });
 await expect.poll(()=>frame.locator('html').evaluate(()=>!!(window as any).noticeLayoutShell)).toBe(true);
 // The floating dock is up; the soft keyboard then leaves only about 150px of window.
 await page.locator('iframe').evaluate((node:any)=>node.style.height='150px');
 await frame.locator('html').evaluate(()=>{(window as any).noticeUndoInvoked=false;(window as any).noticeLayoutShell.toast('Note deleted',{undo:()=>{(window as any).noticeUndoInvoked=true;}});});
 const notice=frame.locator('[data-alpha-toast]'),undo=notice.getByRole('button',{name:'Undo',exact:true});
 await expect(undo).toBeVisible();
 await expect.poll(()=>notice.evaluate(node=>{
  const button=node.querySelector('button')!.getBoundingClientRect(),hit=document.elementFromPoint(button.left+button.width/2,button.top+button.height/2);
  return node.clientHeight>=40&&button.top>=0&&button.bottom<=innerHeight&&!!hit&&node.contains(hit);
 })).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`short-keyboard-undo-notice-${width}.png`),animations:'disabled'});
 await undo.click();
 await expect.poll(()=>frame.locator('html').evaluate(()=>(window as any).noticeUndoInvoked)).toBe(true);
});

test('native cutout and keyboard-sized resizes preserve reachable large-text standalone navigation',async({page},testInfo)=>{
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:28,bottom:48,left:0,right:0});
 await frame.getByRole('button',{name:'Notes',exact:true}).click();
 const back=frame.getByRole('button',{name:'Back to apps',exact:true});
 await page.setViewportSize({width:700,height:420});
 await page.locator('iframe').evaluate((node:any)=>Object.assign(node.style,{left:'42px',top:'0px',width:'658px',height:'396px'}));
 await expect.poll(async()=>{const b=(await back.boundingBox())!;return b.x>=42&&b.y>=0&&b.x+b.width<=700&&b.y+b.height<=396;}).toBe(true);
 await page.setViewportSize({width:360,height:640});
 await page.locator('iframe').evaluate((node:any)=>Object.assign(node.style,{left:'0px',top:'32px',width:'360px',height:'288px'}));
 await back.evaluate((node:any)=>{node.style.fontSize='28px';});
 await expect.poll(async()=>{const b=(await back.boundingBox())!;return b.y>=32&&b.y+b.height<=320&&b.x+b.width<=360;}).toBe(true);
 await back.focus();await back.press('Enter');await expect(frame.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
});

test('wide native standalone keeps a usable transcript and touch navigation at normal density',async({browser},testInfo)=>{
 const context=await browser.newContext({viewport:{width:890,height:400},hasTouch:true,isMobile:true,recordVideo:{dir:testInfo.outputPath('video')}});
 const page=await context.newPage();
 try{
  const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:0,bottom:24,left:0,right:0},890,400);
  await frame.locator('[data-screen]').evaluate(screen=>{
   const events:any[]=[];(window as any).touchEvents=events;
   for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click'])screen.addEventListener(type,event=>{const e=event as PointerEvent;events.push({type,label:(e.target as Element)?.closest('button')?.getAttribute('aria-label'),x:e.clientX,y:e.clientY,pointerType:e.pointerType,half:screen.getAttribute('data-alpha-chat-half')});},true);
  });
  const open=frame.getByRole('button',{name:'Open conversation',exact:true});
  // Cancellation must retire the exact native listener before a later touch.
  await open.dispatchEvent('pointerdown',{pointerId:91,pointerType:'touch',isPrimary:true,button:0,clientX:47,clientY:311});
  await open.dispatchEvent('pointercancel',{pointerId:91,pointerType:'touch',isPrimary:true});
  expect(await open.evaluate(node=>{const event=new TouchEvent('touchstart',{bubbles:true,cancelable:true});node.dispatchEvent(event);return event.defaultPrevented;})).toBe(false);
  await open.tap();
  try{await expect(frame.locator('[data-screen]')).toHaveAttribute('data-alpha-chat-half','true');}
  finally{await testInfo.attach('native-touch-events',{body:JSON.stringify(await frame.locator('[data-screen]').evaluate(()=>(window as any).touchEvents)),contentType:'application/json'});}
  await frame.getByRole('button',{name:'Expand chat',exact:true}).tap();
  const transcript=frame.locator('[data-alpha-transcript]');
  await expect.poll(()=>transcript.evaluate(e=>e.clientHeight)).toBeGreaterThanOrEqual(80);
  const screen=await frame.locator('[data-screen]').boundingBox();
  expect(screen!.width).toBeGreaterThanOrEqual(880);
  // Measure both edges in one animation frame; separate browser calls can sample different sheet positions.
  await expect.poll(()=>transcript.evaluate(node=>{
   const header=node.closest('[data-screen]')!.querySelector('[aria-label="Go Home"]')!;
   return node.getBoundingClientRect().top-header.getBoundingClientRect().bottom;
  })).toBeGreaterThanOrEqual(0);
  await page.screenshot({path:testInfo.outputPath('native-wide-chat.png'),animations:'disabled'});
  await frame.getByRole('button',{name:'Minimize chat',exact:true}).tap();
  await open.tap();
  await expect(frame.locator('[data-screen]')).toHaveAttribute('data-alpha-chat-half','true');
 }finally{await context.close();}
});

for(const launcher of [false,true])test(`native ${launcher?'launcher':'standalone'} ignores an overflow-expanded viewport after rotation`,async({page},testInfo)=>{
 const frame=await nativeContent(page,testInfo.project.use.baseURL as string,{top:0,bottom:0,left:0,right:0},412,839,launcher);
 await page.setViewportSize({width:839,height:412});
 await page.locator('iframe').evaluate((node:any)=>Object.assign(node.style,{width:'839px',height:'412px'}));
 await page.setViewportSize({width:412,height:839});
 await page.locator('iframe').evaluate((node:any)=>Object.assign(node.style,{width:'412px',height:'839px'}));
 // WebView 124 observed these inflated dimensions while its CSS root stayed 412x839.
 // Reproduce that measurement mismatch without claiming this browser emulates Android rotation.
 await frame.locator('html').evaluate(()=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:863});
  Object.defineProperty(window,'innerHeight',{configurable:true,value:1757});
  Object.defineProperty(window.visualViewport!,'height',{configurable:true,value:1757});
  window.dispatchEvent(new Event('resize'));
 });
 await expect.poll(()=>frame.locator('.alpha-phone').evaluate(node=>{
  const box=node.getBoundingClientRect(),root=document.documentElement;
  return box.width<=root.clientWidth+1&&box.height<=root.clientHeight+1;
 })).toBe(true);
 // A real smaller visual viewport must still make room for the keyboard.
 await frame.locator('html').evaluate(()=>{
  Object.defineProperty(window.visualViewport!,'height',{configurable:true,value:390});
  window.visualViewport!.dispatchEvent(new Event('resize'));
 });
 await expect.poll(()=>frame.locator('.alpha-phone').evaluate(node=>node.getBoundingClientRect().height)).toBeLessThanOrEqual(391);
});
