import {openBrowserCalendar} from './helpers/browser-calendar';
import {returnToApps} from './app-navigation';
import {test,expect} from '@playwright/test';

test('Camera Scan opens a reviewed event draft and persists only after Calendar Save',async({page},info)=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const mediaDevices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:mediaDevices});
    mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=700;const c=canvas.getContext('2d')!;const draw=()=>{c.fillStyle='white';c.fillRect(0,0,1000,700);c.fillStyle='black';c.font='58px Arial';c.fillText('Open studio',60,140);c.fillText('October 10, 2026',60,260);c.fillText('Time: 6:30 PM - 8:00 PM',60,380);c.fillText('Venue: Main hall',60,500);};draw();const stream=canvas.captureStream(10);const timer=setInterval(draw,100);stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;};
 });
 await page.goto('/?mode=dev');await openBrowserCalendar(page);await returnToApps(page);await page.getByRole('button',{name:'Camera',exact:true}).click();const video=page.locator('[aria-label^="Viewfinder."] video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);await page.getByRole('button',{name:'Type',exact:true}).click();{const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();await input.fill('Scan this');await input.press('Enter');}
 const dialog=page.getByRole('dialog',{name:'Review scanned text'}),text=dialog.getByRole('textbox',{name:'Scanned text'});await expect(text).toBeEnabled({timeout:60000});await expect(text).toHaveValue(/October 10, 2026/);await expect(text).toHaveValue(/6:30 PM/);await text.fill('Open studio\nOctober 10, 2026\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall');await dialog.locator('summary').filter({hasText:'Create event draft'}).click();
 await expect(dialog.getByLabel('Event title',{exact:true})).toHaveValue('Open studio');await expect(dialog.getByLabel('Event date',{exact:true})).toHaveValue('2026-10-10');await expect(dialog.getByLabel('Event start time',{exact:true})).toHaveValue('18:30');
 await expect(dialog.getByLabel('Event location',{exact:true})).toHaveValue('Main hall');await expect(dialog).toContainText('Duration starts at 60 minutes');await dialog.getByLabel('Event title',{exact:true}).fill('Reviewed studio visit');await dialog.getByLabel('Event location',{exact:true}).fill('Main hall');await expect(dialog.getByLabel('Event duration in minutes',{exact:true})).toHaveValue('90');
 const rows=()=>page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())||'{"events":[]}').events);expect(await rows()).toHaveLength(0);
 await dialog.getByRole('button',{name:'Review in Calendar',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Reviewed studio visit');await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('Main hall');expect(await rows()).toHaveLength(0);await expect(page.getByLabel('Selected event date',{exact:true})).toHaveText('Saturday, October 10, 2026');await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Open studio\nOctober 10, 2026\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall');
 await page.screenshot({path:info.outputPath('calendar-draft.png'),animations:'disabled'});await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(async()=>(await rows()).length).toBe(1);const saved=(await rows())[0];expect(saved.title).toBe('Reviewed studio visit');expect(saved.body).toBe('Open studio\nOctober 10, 2026\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall');expect(saved.end-saved.begin).toBe(90*60000);await page.reload();expect(await rows()).toHaveLength(1);
});

test('event review rejects nonexistent DST time and can be corrected before handoff',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {createScanEventReview}=await import('/src/prototype/scan-event-review.ts');(window as any).drafts=[];const details=createScanEventReview(()=>'Clock change event',()=>true,draft=>{(window as any).drafts.push(draft);return true;});const dialog=document.createElement('dialog');dialog.append(details);document.body.append(dialog);dialog.showModal();details.open=true;});
 await expect(page.getByLabel('Event title',{exact:true})).toHaveValue('Clock change event');await page.getByLabel('Event date',{exact:true}).fill('2026-03-08');await page.getByLabel('Event start time',{exact:true}).fill('02:30');await page.getByRole('button',{name:'Review in Calendar',exact:true}).click();await expect(page.getByRole('status',{name:'Event draft status'})).toContainText('does not exist');expect(await page.evaluate(()=>(window as any).drafts)).toHaveLength(0);
 await page.getByLabel('Event start time',{exact:true}).fill('03:30');await page.getByRole('button',{name:'Review in Calendar',exact:true}).click();expect(await page.evaluate(()=>(window as any).drafts)).toHaveLength(1);
});

// Uncertain OCR dates stay blank in the rendered review, the notes say why, and nothing reaches
// Calendar until the user enters the date (and, since the time was left blank too, the time).
for(const [name,poster,reasons] of [
 ['ambiguous numeric date with a zone abbreviation','Open studio\n10/11/2026 7 PM EST\nVenue: Main hall',['A numeric date such as 10/11 can mean different days in different regions. Enter the date yourself.','Time zone “EST” is ambiguous. Enter the local start time yourself.']],
 ['weekday that conflicts with the printed date','Open studio\nFriday, October 10, 2026\n7 PM\nVenue: Main hall',['“Friday” does not match the printed date. Enter the date yourself.']],
] as const)test(`OCR ${name} leaves the date and time blank and writes no draft until they are entered`,async({page})=>{
 await page.goto('/');await page.evaluate(async poster=>{const {createScanEventReview}=await import('/src/prototype/scan-event-review.ts');(window as any).drafts=[];const details=createScanEventReview(()=>poster,()=>true,draft=>{(window as any).drafts.push(draft);return true;},()=>new Date('2026-10-03T15:00:00Z'));const dialog=document.createElement('dialog');dialog.append(details);document.body.append(dialog);dialog.showModal();details.open=true;},poster);
 const drafts=()=>page.evaluate(()=>(window as any).drafts.length),review=page.getByRole('button',{name:'Review in Calendar',exact:true});
 await expect(page.getByLabel('Event title',{exact:true})).toHaveValue('Open studio');await expect(page.getByLabel('Event location',{exact:true})).toHaveValue('Main hall');
 await expect(page.getByLabel('Event date',{exact:true})).toHaveValue('');await expect(page.getByLabel('Event start time',{exact:true})).toHaveValue('');
 const notes=page.getByRole('list',{name:'Suggestion notes'});await expect(notes).toBeVisible();for(const reason of reasons)await expect(notes.getByRole('listitem').filter({hasText:reason})).toHaveCount(1);
 await expect(page.getByRole('region',{name:'Printed time zone'})).toHaveCount(0);await expect(page.getByLabel('Printed time zone')).toBeHidden();
 await review.click();expect(await drafts()).toBe(0);
 await page.getByLabel('Event date',{exact:true}).fill('2026-10-11');await review.click();expect(await drafts()).toBe(0);
 await page.getByLabel('Event start time',{exact:true}).fill('19:00');await review.click();await expect.poll(drafts).toBe(1);
 const draft=await page.evaluate(()=>(window as any).drafts[0]);expect(draft).toMatchObject({title:'Open studio',where:'Main hall',t:19,id:null,separateCreation:false});expect(draft.creationId).toMatch(/^[0-9a-f-]{36}$/);
});

test.use({timezoneId:'America/New_York'});
