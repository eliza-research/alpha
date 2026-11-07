import {openBrowserCalendar} from './helpers/browser-calendar';
import {returnToApps} from './app-navigation';
/*
 * Journey J01: Poster -> Calendar, driven start to finish through rendered controls in the
 * browser build (development profile, no agent needed).
 *
 * What is real: the Camera view, a scan requested in chat, the local English OCR engine (the same
 * path scan-event.spec.ts exercises), the suggestion review, the hand-off into the Calendar
 * form, the retained-form store that keeps that unsaved form across a reload, Calendar Save,
 * browser Calendar storage, the Home agenda card and the Calendar day view.
 *
 * Synthetic fixtures (external boundaries only):
 *  - Camera: getUserMedia returns a canvas stream that draws the poster text. No physical camera.
 *  - Clock: Date is fixed to 2026-10-09T15:00Z and the time zone to America/New_York so the
 *    poster date (October 10, 2026) is "tomorrow" and inside the Home agenda range.
 *
 * Native-only / not provable here:
 *  - A physical camera capture of a real printed poster (focus, glare, skew, handwriting).
 *  - Android Calendar provider accounts, calendar selection and scope denial ("Open in Android
 *    Calendar"); this journey saves to the in-app browser calendar only.
 *  - OS-level agenda surfaces outside the app.
 *
 * A pass is source/test evidence only. It is not APK, emulator, AOSP image, device or
 * real-integration evidence.
 */
import {test,expect,type Page} from '@playwright/test';

test.use({timezoneId:'America/New_York'});
test.setTimeout(300_000);

const poster='Open studio\nOctober 10, 2026\nTime: 6:30 PM - 8:00 PM\nVenue: Main hall';
// READ-ONLY view of the persisted browser calendar document.
const events=(page:Page)=>page.evaluate(async()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())||'{"events":[]}').events as any[]);
const ready=(page:Page)=>expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible({timeout:90_000});

/** Ask Alpha to scan the poster, correct the recognized text and open the event suggestions. */
async function scanPoster(page:Page){
 const dialog=page.getByRole('dialog',{name:'Review scanned text'}),text=dialog.getByRole('textbox',{name:'Scanned text'});
 await page.getByRole('button',{name:'Type',exact:true}).click();{const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();await input.fill('Scan this');await input.press('Enter');}
 await expect(text).toBeEnabled({timeout:120_000});
 // The real local OCR result must already contain the poster's date and time.
 await expect(text).toHaveValue(/Open studio/);await expect(text).toHaveValue(/October 10, 2026/);await expect(text).toHaveValue(/6:30 PM/);
 await text.fill(poster);
 await dialog.locator('summary').filter({hasText:'Create event draft'}).click();
 await expect(dialog.getByLabel('Event title',{exact:true})).toHaveValue('Open studio');
 await expect(dialog.getByLabel('Event date',{exact:true})).toHaveValue('2026-10-10');
 await expect(dialog.getByLabel('Event start time',{exact:true})).toHaveValue('18:30');
 await expect(dialog.getByLabel('Event duration in minutes',{exact:true})).toHaveValue('90');
 await expect(dialog.getByLabel('Event location',{exact:true})).toHaveValue('Main hall');
 return dialog;
}
async function openScanMode(page:Page){
 await page.getByRole('button',{name:'Camera',exact:true}).click();
 const video=page.locator('[aria-label^="Viewfinder."] video');
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState),{timeout:60_000}).toBeGreaterThanOrEqual(2);
}

test('J01 poster scan becomes exactly one reviewed Calendar event; suggestions and drafts never save by themselves',async({page})=>{
 // No step of this journey asks a question: any confirm(), alert() or prompt() is a failure.
 const dialogs:string[]=[];
 page.on('dialog',d=>{dialogs.push(d.type()+': '+d.message());void d.dismiss();});
 await page.clock.setFixedTime(new Date('2026-10-09T15:00:00Z'));
 await page.addInitScript(()=>{
  // Synthetic camera: a canvas stream drawing the poster. Everything after getUserMedia is real.
  const mediaDevices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:mediaDevices});
  mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=700;const c=canvas.getContext('2d')!;const draw=()=>{c.fillStyle='white';c.fillRect(0,0,1000,700);c.fillStyle='black';c.font='58px Arial';c.fillText('Open studio',60,140);c.fillText('October 10, 2026',60,260);c.fillText('Time: 6:30 PM - 8:00 PM',60,380);c.fillText('Venue: Main hall',60,500);};draw();const stream=canvas.captureStream(10);const timer=setInterval(draw,100);stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;};
 });
 await page.goto('/?mode=dev');await ready(page);await openBrowserCalendar(page);await returnToApps(page);
 // Home's agenda reads the calendar chosen in Calendar (docs/daily-overview.md): the empty browser calendar.
 const homeAgenda=page.getByRole('region',{name:'Home',exact:true}).locator('[data-alpha-home-calendar]');
 await expect(homeAgenda).toHaveCount(0);
 expect(await events(page)).toHaveLength(0);

 // 1. Scan, review suggestions, then cancel from the scan review: nothing is saved.
 await openScanMode(page);
 let dialog=await scanPoster(page);
 expect(await events(page)).toHaveLength(0);
 await dialog.getByRole('button',{name:'Close scan',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await events(page)).toHaveLength(0);

 // 2. Scan again, edit the suggestion, hand off to the separate Calendar review, then leave
 //    the Calendar form without Save: still nothing saved, also after reload.
 dialog=await scanPoster(page);
 await dialog.getByLabel('Event title',{exact:true}).fill('Reviewed studio visit');
 await dialog.getByRole('button',{name:'Review in Calendar',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Reviewed studio visit');
 await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('Main hall');
 await expect(page.getByLabel('Selected event date',{exact:true})).toHaveText('Saturday, October 10, 2026');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue(poster);
 expect(await events(page)).toHaveLength(0);
 await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);
 expect(await events(page)).toHaveLength(0);
 await page.reload();await ready(page);
 expect(await events(page)).toHaveLength(0);
 await expect(page.getByRole('button',{name:'Open Agent Calendar',exact:true})).toBeVisible();

 // 3. The scan draft carries a creationId, so Calendar retained the reviewed form across the
 //    reload: New event restores it through form recovery, still unsaved, and Save writes one event.
 await openBrowserCalendar(page);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Reviewed studio visit');
 await expect(page.getByRole('textbox',{name:'Location',exact:true})).toHaveValue('Main hall');
 await expect(page.getByLabel('Selected event date',{exact:true})).toHaveText('Saturday, October 10, 2026');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue(poster);
 expect(await events(page)).toHaveLength(0);
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect.poll(async()=>(await events(page)).length).toBe(1);
 await expect(page.getByRole('heading',{name:'Reviewed studio visit',level:1})).toBeVisible();

 // 4. Persisted exactly once after reload, with the reviewed fields.
 await page.reload();await ready(page);
 const saved=await events(page);
 expect(saved).toHaveLength(1);
 expect(saved[0]).toMatchObject({calendarId:'local',title:'Reviewed studio visit',location:'Main hall',body:poster,begin:Date.parse('2026-10-10T18:30:00-04:00'),end:Date.parse('2026-10-10T20:00:00-04:00')});

 // 5. Agent Calendar on Home does not silently read the retained browser source.
 // Reopen that explicitly selected source and choose the exact saved event.
 await expect(page.getByRole('region',{name:'Home',exact:true})).not.toContainText('Reviewed studio visit');
 await openBrowserCalendar(page);
 await page.getByRole('button',{name:'Day 10',exact:true}).click();
 await page.getByRole('button',{name:/^Reviewed studio visit,/}).click();
 await expect(page.getByRole('heading',{name:'Reviewed studio visit',level:1})).toBeVisible();
 await expect(page.getByRole('button',{name:'Main hall',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to calendar',exact:true}).last().click();

 // 6. Calendar's day view lists it exactly once on October 10.
 await page.getByRole('button',{name:'Day 10',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Reviewed studio visit,/})).toHaveCount(1);
 expect(await events(page)).toHaveLength(1);
 expect(dialogs).toEqual([]);
});
