import {openBrowserCalendar} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';

test.describe('Calendar detail accessibility', () => {
  // Layout fixtures use UTC civil dates independently of the runner locale.
  test.use({timezoneId:'UTC'});
  for(const theme of ['light','dark'])for(const kind of ['event','reminder'])test(`calendar detail keeps long text readable: ${kind} ${theme}`,async({page},info)=>{
   await page.setViewportSize({width:360,height:640});await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));
   const title='Reference-'+ 'abcdefghij'.repeat(6),body='First paragraph\n\nReference: '+ '0123456789'.repeat(12)+'\nLast paragraph';
   await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
   await page.goto('/?mode=dev&theme='+theme);
   await page.evaluate(async({kind,title,body})=>{const {registerPlugin}=await import('/src/platform-plugins.ts');if(kind==='event')await registerPlugin<any>('AlphaCalendar').save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title,body,location:'Building-'+ 'abcdef'.repeat(15),begin:Date.parse('2027-03-13T14:00Z'),end:Date.parse('2027-03-13T15:00Z')});else await registerPlugin<any>('DailyApps').scheduleReminder({id:'large-detail',title,body,at:Date.parse('2027-03-13T14:00Z')});const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});},{kind,title,body});
   await page.reload();await openBrowserCalendar(page);await page.getByRole('button',{name:'Day 13',exact:true}).click();await page.getByRole('button',{name:new RegExp('^Reference-')}).click();
   const heading=page.getByRole('heading',{name:title,exact:true});await expect(heading).toBeVisible();const detail=heading.locator('..');
   expect(await detail.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
   const notes=page.getByText(kind==='reminder'?body+'\nScheduled. Alerts may arrive a few minutes late.':body,{exact:true});await notes.scrollIntoViewIfNeeded();await expect(notes).toHaveCSS('white-space','pre-wrap');expect(await notes.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
   await page.screenshot({path:info.outputPath('description.png'),animations:'disabled'});
   if(kind==='reminder')for(const name of ['Complete reminder occurrence','Snooze reminder 10 minutes']){const action=page.getByRole('button',{name,exact:true});await action.scrollIntoViewIfNeeded();const box=await action.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);expect(box!.height).toBeGreaterThanOrEqual(44);await expect(action).toBeInViewport();}
   await heading.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('detail.png'),animations:'disabled'});await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await expect(heading).toHaveCount(0);
  });
});

test.describe('Calendar draft accessibility', () => {
  for(const theme of ['light','dark'])test(`calendar draft retains reachable fields and actions at large text: ${theme}`,async({page},info)=>{
   await page.setViewportSize({width:360,height:430});
   await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
   await page.goto('/?mode=dev&theme='+theme);
   await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});await page.reload();
   await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();
   const save=page.getByRole('button',{name:'Save event',exact:true});expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
   const fields=page.getByRole('region',{name:'Event details',exact:true});await expect(fields).toBeVisible();await fields.focus();await page.keyboard.press('End');
   const notes=page.getByRole('textbox',{name:'Notes',exact:true});await notes.fill('First paragraph\n\nLong reference '+'abc'.repeat(80));await notes.scrollIntoViewIfNeeded();await expect(notes).toBeInViewport();
   expect(await fields.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
   for(const name of ['In this app','Once','None','Add people']){const button=fields.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await expect(button).toBeInViewport();const box=(await button.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(360);}
   const video=fields.getByRole('switch',{name:'Video link',exact:true});await video.scrollIntoViewIfNeeded();await expect(video).toHaveAttribute('aria-checked','false');const target=(await video.boundingBox())!,track=(await video.locator('.calendar-video-track').boundingBox())!,thumb=(await video.locator('.calendar-video-thumb').boundingBox())!;expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);expect(await video.locator('.calendar-video-track').evaluate(el=>({width:getComputedStyle(el).width,height:getComputedStyle(el).height}))).toEqual({width:'52px',height:'32px'});expect(await video.locator('.calendar-video-thumb').evaluate(el=>({width:getComputedStyle(el).width,height:getComputedStyle(el).height}))).toEqual({width:'26px',height:'26px'});expect(track.width/track.height).toBeCloseTo(52/32,2);expect(thumb.width/track.width).toBeCloseTo(26/52,2);expect(thumb.width/thumb.height).toBeCloseTo(1,2);expect(await video.locator('.calendar-video-track').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('16px');await page.screenshot({path:info.outputPath('video-off.png'),animations:'disabled'});await video.focus();await page.keyboard.press('Space');await expect(video).toHaveAttribute('aria-checked','true');await expect(video.locator('.calendar-video-thumb')).toHaveCSS('transform','matrix(1, 0, 0, 1, 20, 0)');await page.screenshot({path:info.outputPath('video-on.png'),animations:'disabled'});await page.keyboard.press('Space');await expect(video).toHaveAttribute('aria-checked','false');
   await notes.scrollIntoViewIfNeeded();const notesBox=(await notes.boundingBox())!,dockBox=(await page.locator('[data-alpha-layer="pill"]').boundingBox())!;expect(notesBox.y+notesBox.height).toBeLessThanOrEqual(dockBox.y);await page.screenshot({path:info.outputPath('draft-notes.png'),animations:'disabled'});await expect(save).toBeInViewport();await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await expect(fields).toHaveCount(0);
  });

  for(const theme of ['light','dark'])test(`Calendar timeline fades only clipped content after scrolling: ${theme}`,async({page},info)=>{
   await page.setViewportSize({width:360,height:600});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?theme='+theme);await openBrowserCalendar(page);
   const timeline=page.getByRole('region',{name:'Calendar timeline',exact:true}),create=page.getByRole('button',{name:'New event',exact:true});await expect(timeline).toBeVisible();expect(await page.evaluate(()=>CSS.supports('animation-timeline','scroll()'))).toBe(true);await timeline.evaluate(el=>el.scrollTop=0);await expect.poll(()=>timeline.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-top')))).toBe(0);await expect(create).toBeVisible();expect(await create.evaluate(el=>getComputedStyle(el).maskImage)).toBe('none');await page.screenshot({path:info.outputPath('calendar-scroll-start.png'),animations:'disabled'});
   await timeline.evaluate(el=>el.scrollTop=96);await expect.poll(()=>timeline.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--calendar-scroll-fade-top')))).toBeGreaterThan(0);expect(await timeline.evaluate(el=>getComputedStyle(el).maskImage)).toContain('linear-gradient');await expect(create).toBeInViewport();expect(await create.evaluate(el=>getComputedStyle(el).maskImage)).toBe('none');await page.screenshot({path:info.outputPath('calendar-scroll-middle.png'),animations:'disabled'});
   await create.click();const save=page.getByRole('button',{name:'Save event',exact:true}),fields=page.getByRole('region',{name:'Event details',exact:true});await expect(save).toBeInViewport();expect(await save.evaluate(el=>getComputedStyle(el).maskImage)).toBe('none');expect(await fields.evaluate(el=>getComputedStyle(el).maskImage)).toBe('none');
  });
});

test.describe('Calendar editor accessibility', () => {
  for(const theme of ['light','dark'])for(const height of [640,360])test(`calendar editor preserves multiline text and reachable actions: ${theme} ${height}`,async({page},info)=>{
   await page.setViewportSize({width:360,height});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev&theme='+theme);
   await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
   const trigger=page.getByRole('button',{name:'Calendar',exact:true});await trigger.focus();
   await page.evaluate(async()=>{const {editCalendarEvent}=await import('/src/browser/calendar-editor.ts');(window as any).calendarDraftResult=editCalendarEvent({title:'Synthetic multiline event',body:'First line\n\nLast line',location:'Test location',begin:Date.parse('2026-10-04T16:00:00Z'),end:Date.parse('2026-10-04T17:00:00Z'),timeZone:'America/New_York',repeat:'weekly'},async next=>{(window as any).savedCalendarDraft=next;},[{id:'person',name:'Alexandra Montgomery'}]);});
   const dialog=page.getByRole('dialog',{name:'Edit calendar event'}),title=dialog.getByLabel('Event title',{exact:true}),description=dialog.getByLabel('Event description',{exact:true});
   await expect(title).toHaveCSS('font-size','24px');await expect(title).toHaveCSS('color-scheme',theme);await expect(description).toHaveValue('First line\n\nLast line');expect(await description.evaluate(el=>el.tagName)).toBe('TEXTAREA');
   await expect(title).toHaveCSS('color',theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');expect(await title.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
   const checkActions=async()=>{for(const name of ['Close calendar editor','Save event','Cancel']){const button=dialog.getByRole('button',{name,exact:true});await expect(button).toBeInViewport();const bounds=await button.boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);})).toBe(true);}};
   await checkActions();
   for(const control of await dialog.locator('input,textarea,select').all()){
    await control.scrollIntoViewIfNeeded();const [box,outer]=await Promise.all([control.boundingBox(),dialog.boundingBox()]);expect(box!.x).toBeGreaterThanOrEqual(outer!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(outer!.x+outer!.width);await checkActions();
   }
   for(const label of ['All day','Local meeting room','Alexandra Montgomery'])expect(await dialog.getByLabel(label,{exact:true}).evaluate(el=>el.closest('label')!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
   await dialog.getByRole('button',{name:'Cancel',exact:true}).focus();await title.focus();await title.fill('Edited multiline event');await expect.poll(()=>title.evaluate(el=>el.closest('label')!.getBoundingClientRect().top)).toBeGreaterThanOrEqual((await dialog.locator('header').boundingBox())!.y+(await dialog.locator('header').boundingBox())!.height-1);await page.screenshot({path:info.outputPath('calendar-editor-themed.png'),animations:'disabled'});await dialog.getByRole('button',{name:'Save event',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>(window as any).calendarDraftResult)).toEqual({status:'saved'});expect(await page.evaluate(()=>(window as any).savedCalendarDraft.body)).toBe('First line\n\nLast line');await expect(trigger).toBeFocused();
  });
  test('calendar editor exposes validation, keeps the draft and returns keyboard focus on close',async({page})=>{
   await page.goto('/?mode=dev');const trigger=page.getByRole('button',{name:'Calendar',exact:true});await trigger.focus();await page.evaluate(async()=>{const {editCalendarEvent}=await import('/src/browser/calendar-editor.ts');(window as any).calendarDraftResult=editCalendarEvent({title:'Draft',body:'Original\nDescription',location:'',begin:Date.now(),end:Date.now()+3600000},async()=>{throw Error('Synthetic save failure');});});
   const dialog=page.getByRole('dialog',{name:'Edit calendar event'});await dialog.getByLabel('Event description',{exact:true}).fill('Unsaved\n\nMultiline draft');await dialog.getByRole('button',{name:'Save event',exact:true}).click();await expect(dialog.getByRole('status',{name:'Calendar editor save status'})).toHaveText('Synthetic save failure');await expect(dialog.getByRole('status',{name:'Calendar editor save status'})).toBeInViewport();await expect(dialog.getByLabel('Event description',{exact:true})).toHaveValue('Unsaved\n\nMultiline draft');await dialog.getByRole('button',{name:'Close calendar editor',exact:true}).focus();await page.keyboard.press('Enter');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();expect(await page.evaluate(()=>(window as any).calendarDraftResult)).toEqual({status:'cancelled'});
  });
});

test.describe('Calendar meeting accessibility', () => {
  for(const theme of ['light','dark'])for(const height of [640,360])test(`local meeting preview supports large text: ${theme} ${height}`,async({page},info)=>{
   await page.setViewportSize({width:360,height});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev&theme='+theme);
   await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
   const trigger=page.getByRole('button',{name:'Calendar',exact:true});await trigger.focus();await page.evaluate(async()=>{const {openCalendarMeeting}=await import('/src/browser/calendar-meeting.ts');openCalendarMeeting('Planning'+'UnbrokenTitle'.repeat(25),['Alexandra'+'LongSurname'.repeat(25),'Maya']);});
   const room=page.getByRole('dialog',{name:'Calendar meeting'}),leave=room.getByRole('button',{name:'Leave meeting',exact:true});
   expect(await room.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   await expect(leave).toBeInViewport();expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);await expect(leave).toHaveCSS('font-size','24px');await expect(leave).toHaveCSS('color-scheme',theme);
   const heading=room.getByRole('heading');await heading.scrollIntoViewIfNeeded();await expect(leave).toBeInViewport();
   for(const [name,error] of [['Turn camera on','Camera could not start. Try again.'],['Unmute microphone','Microphone could not start. Try again.']]){
    const button=room.getByRole('button',{name,exact:true});await button.click();await expect(room.getByRole('status')).toHaveText(error);await expect(room.getByRole('status')).toBeInViewport();await expect(button).toBeEnabled();await expect(leave).toBeInViewport();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
   }
   await page.screenshot({path:info.outputPath('meeting-preview.png')});await leave.click();await expect(room).toHaveCount(0);await expect(trigger).toBeFocused();
  });
});

test.describe('Calendar response accessibility', () => {
  for(const theme of ['light','dark'])for(const height of [640,360])test(`guest response remains usable with large text: ${theme} ${height}`,async({page},info)=>{
   await page.setViewportSize({width:360,height});await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev&theme='+theme);
   await page.evaluate(async()=>{const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
   const trigger=page.getByRole('button',{name:'Calendar',exact:true});await trigger.focus();
   await page.evaluate(async()=>{const {editCalendarResponse}=await import('/src/browser/calendar-response.ts');(window as any).responseResult=editCalendarResponse('Alexandra'+ 'Montgomery'.repeat(30),'added',async()=>{throw Error('Could not save this response. Please retry.');});});
   const dialog=page.getByRole('dialog',{name:'Local guest response'}),select=dialog.getByLabel('Guest response',{exact:true});
   await expect(select).toHaveCSS('font-size','24px');await expect(select).toHaveCSS('color-scheme',theme);await expect(select).toHaveCSS('color',theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
   expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   for(const name of ['Save response','Cancel']){const button=dialog.getByRole('button',{name,exact:true});await expect(button).toBeInViewport();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
   await select.selectOption('yes');await dialog.getByRole('button',{name:'Save response',exact:true}).click();await expect(dialog.getByRole('status')).toBeInViewport();await expect(select).toHaveValue('yes');await page.screenshot({path:info.outputPath('guest-response.png')});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(trigger).toBeFocused();expect(await page.evaluate(()=>(window as any).responseResult)).toEqual({status:'cancelled'});
  });
});
