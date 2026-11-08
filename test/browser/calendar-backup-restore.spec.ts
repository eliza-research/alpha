import {holdDocumentsTransaction} from './helpers/calendar-storage-hold';
import {test,expect} from '@playwright/test';
const backup={events:[{id:'saved',calendarId:'local',revision:'saved-revision',title:'Restored appointment',body:'Bring notes',location:'Library',begin:1800000000000,end:1800003600000,timeZone:'UTC',repeat:'weekly',alert:5}]};
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!sessionStorage.getItem('restore-seeded')){localStorage.setItem('alpha.browser.calendar.v1','damaged original');sessionStorage.setItem('restore-seeded','1');}});await page.goto('/?tools=1');});
async function open(page:any){await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Calendar recovery',exact:true}).click();const d=page.getByRole('dialog',{name:'App calendar recovery'});await expect(d.getByRole('button',{name:'Download calendar backup',exact:true})).toBeEnabled();return d;}
async function choose(d:any,value:unknown){await d.getByLabel('Choose calendar backup',{exact:true}).setInputFiles({name:'calendar.txt',mimeType:'text/plain',buffer:Buffer.from(JSON.stringify(value))});}
async function raw(page:any){return page.evaluate(async()=>(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw());}
test('file selection and review do not write; confirmation restores events without replaying alerts',async({page},info)=>{
 const d=await open(page);await choose(d,backup);await expect(d.getByText('1 event record(s) in this backup.',{exact:false})).toBeVisible();expect(await raw(page)).toBe('damaged original');
 await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();expect(await raw(page)).toBe('damaged original');await expect(d.getByText('No invitations are sent;', {exact:false})).toBeVisible();await page.screenshot({path:info.outputPath('calendar-restore-review.png')});
 await d.getByRole('button',{name:'Confirm calendar restore',exact:true}).click();await expect(d).toHaveCount(0);const state=JSON.parse(await raw(page));expect(state.events).toHaveLength(1);expect(state.events[0].title).toBe('Restored appointment');expect(state.events[0].id).not.toBe('saved');expect(state.events[0].alert).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.calendar.v1'))).toBe('damaged original');
 await page.reload();expect(JSON.parse(await raw(page)).events[0].title).toBe('Restored appointment');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByText('Calendar backups',{exact:true}).click();await expect(page.getByRole('dialog',{name:'App calendar recovery'})).toBeVisible();
});
test('unsupported backup is visible and leaves original data intact',async({page})=>{
 const d=await open(page);await choose(d,{events:[{...backup.events[0],timeZone:'Not/AZone'}]});await expect(d.getByText('This is not a supported calendar backup. No events were changed.')).toBeVisible();await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeDisabled();expect(await raw(page)).toBe('damaged original');
});
test('a newer document prevents an old restore approval from replacing it',async({page})=>{
 const d=await open(page);await choose(d,backup);await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();
 await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.restore(await calendarDocument.capture(),JSON.stringify({sourceRevision:'newer',events:[]}));});
 await d.getByRole('button',{name:'Confirm calendar restore',exact:true}).click();await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeEnabled();expect(JSON.parse(await raw(page)).sourceRevision).toBe('newer');
});

test('closing recovery while a transaction holds storage cancels the queued restore',async({page})=>{
 const d=await open(page);await choose(d,backup);
 const hold=await holdDocumentsTransaction(page);
 await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();await d.getByRole('button',{name:'Confirm calendar restore',exact:true}).click();await expect(d.getByRole('button',{name:'Confirm calendar restore'})).toBeDisabled();await d.getByRole('button',{name:'Close recovery',exact:true}).click();
 await hold.release();
 expect(await page.evaluate(async()=>(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())).toBe('damaged original');
});

test('a coerced guest response cannot enter the reviewed calendar',async({page})=>{
 const d=await open(page);await choose(d,{events:[{...backup.events[0],who:['Guest'],responses:{Guest:['yes']}}]});await expect(d.getByText('This is not a supported calendar backup. No events were changed.')).toBeVisible();await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeDisabled();expect(await raw(page)).toBe('damaged original');
});

const partialLabel='Recover complete valid events and series from a partly damaged backup';
const partialBackup={events:[backup.events[0],{...backup.events[0],id:'broken',end:0}]};
test('partial recovery excludes a series when its exception reference is damaged',async({page})=>{
 const base=backup.events[0],occurrence=base.begin+7*86400000,d=await open(page);
 await choose(d,{events:[base,{...base,id:`saved:occ:${occurrence}`,seriesId:null,occurrenceBegin:occurrence,repeat:'none'},{...base,id:'safe',title:'Independent event'}]});
 await d.getByLabel(partialLabel,{exact:true}).check();
 await expect(d.getByText('1 event record(s) can be recovered; 2 record(s) will be skipped.',{exact:false})).toBeVisible();
 expect(await raw(page)).toBe('damaged original');await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();await d.getByRole('button',{name:'Confirm calendar restore',exact:true}).click();
 await expect(d).toHaveCount(0);expect(JSON.parse(await raw(page)).events.map((event:any)=>event.title)).toEqual(['Independent event']);
});
test('partial recovery requires opt-in, review and confirmation; changing mode retires approval',async({page},info)=>{
 const d=await open(page);await choose(d,partialBackup);
 await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeDisabled();
 await d.getByLabel(partialLabel,{exact:true}).check();
 await expect(d.getByText('1 event record(s) can be recovered; 1 record(s) will be skipped.',{exact:false})).toBeVisible();
 await expect(d.getByText('Skipped record 2:',{exact:false})).toBeVisible();expect(await raw(page)).toBe('damaged original');
 await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();
 await d.getByLabel(partialLabel,{exact:true}).uncheck();
 await expect(d.getByRole('button',{name:'Confirm calendar restore',exact:true})).toHaveCount(0);
 await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeDisabled();
 await d.getByLabel(partialLabel,{exact:true}).check();
 await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();
 await page.screenshot({path:info.outputPath('calendar-partial-review.png')});
 expect(await raw(page)).toBe('damaged original');await d.getByRole('button',{name:'Confirm calendar restore',exact:true}).click();
 await expect(d).toHaveCount(0);const state=JSON.parse(await raw(page));expect(state.events).toHaveLength(1);expect(state.events[0].alert).toBeNull();
 await page.reload();expect(JSON.parse(await raw(page)).events).toHaveLength(1);
});
test('closing a partial preview and wholly damaged backups preserve the original bytes',async({page})=>{
 let d=await open(page);await choose(d,partialBackup);await d.getByLabel(partialLabel,{exact:true}).check();
 await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeEnabled();await d.getByRole('button',{name:'Close recovery',exact:true}).click();expect(await raw(page)).toBe('damaged original');
 d=await open(page);await choose(d,{events:[partialBackup.events[1]]});await d.getByLabel(partialLabel,{exact:true}).check();
 await expect(d.getByText('No complete valid events or series could be recovered. No events were changed.',{exact:true})).toBeVisible();
 await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeDisabled();expect(await raw(page)).toBe('damaged original');
});
test('partial restore cannot replace a document changed after capture',async({page})=>{
 const d=await open(page);await choose(d,partialBackup);await d.getByLabel(partialLabel,{exact:true}).check();await d.getByRole('button',{name:'Review calendar restore',exact:true}).click();
 await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.restore(await calendarDocument.capture(),JSON.stringify({sourceRevision:'newer-partial',events:[]}));});
 await d.getByRole('button',{name:'Confirm calendar restore',exact:true}).click();await expect(d.getByRole('button',{name:'Review calendar restore',exact:true})).toBeEnabled();expect(JSON.parse(await raw(page)).sourceRevision).toBe('newer-partial');
});
test('Settings offers browser Calendar backups without presenting native provider export',async({page})=>{
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();await expect(page.getByText('Calendar backups',{exact:true})).toBeVisible();await page.screenshot({animations:'disabled',path:test.info().outputPath('settings-calendar-backups.png')});await page.getByText('Calendar backups',{exact:true}).click();await expect(page.getByRole('dialog',{name:'App calendar recovery'})).toBeVisible();await page.getByRole('dialog',{name:'App calendar recovery'}).getByRole('button',{name:'Close recovery',exact:true}).click();
 await page.reload();await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();await page.evaluate(()=>{(window as any).Capacitor.isNativePlatform=()=>true;});await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();await expect(page.getByText('Calendar backups',{exact:true})).toHaveCount(0);
});
