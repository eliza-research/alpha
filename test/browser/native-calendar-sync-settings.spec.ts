import {test,expect} from '@playwright/test';
import {calendarSyncFixture} from './calendar-sync-fixture';
// Renderer integration through a synthetic native boundary. This is not an Android/Google run.
test('native Settings requires native consent, links its exact source, pulls edits and pauses both boundaries',async({page})=>{
 const dialog=await calendarSyncFixture(page,true);
 await dialog.getByRole('switch',{name:'Sync',exact:true}).click();
 await expect(dialog.getByText(/owner@example.invalid.*Personal.*1 event/)).toBeVisible();
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.consents)).toBe(0);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.writes)).toBe(0);
 await dialog.getByRole('switch',{name:'Confirm sync',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/1 sent to Google/);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.consents)).toBe(1);
 await page.evaluate(()=>{const f=(window as any).calendarSyncFixture;f.remote.event.title='Updated at Google';f.remote.etag='"2"';});
 await dialog.getByRole('button',{name:'Sync now',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/1 received/);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.event.title)).toBe('Updated at Google');
 await dialog.getByRole('switch',{name:'Sync',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/Sync is off/);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.enabled)).toBe(false);
});
test('native consent cancellation keeps both the local event and Google untouched',async({page})=>{
 const dialog=await calendarSyncFixture(page,true);await dialog.getByRole('switch',{name:'Sync',exact:true}).click();await expect(dialog.getByRole('switch',{name:'Confirm sync',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).calendarSyncFixture.native.deny=true);await dialog.getByRole('switch',{name:'Confirm sync',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/not enabled/);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.writes)).toBe(0);expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.enabled)).toBe(false);
});
test('only Review sync may request a missing device Calendar permission',async({page})=>{
 const dialog=await calendarSyncFixture(page,true);await page.evaluate(()=>(window as any).calendarSyncFixture.native.permission=false);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.requests)).toBe(0);
 await dialog.getByRole('switch',{name:'Sync',exact:true}).click();await expect(dialog.getByRole('switch',{name:'Confirm sync',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.requests)).toBe(1);expect(await page.evaluate(()=>(window as any).calendarSyncFixture.writes)).toBe(0);
});
test('Undo keeps the native event and pauses only its link without deleting it on the next sync',async({page})=>{
 const dialog=await calendarSyncFixture(page,true);await dialog.getByRole('switch',{name:'Sync',exact:true}).click();await expect(dialog.getByRole('switch',{name:'Confirm sync',exact:true})).toBeEnabled();await dialog.getByRole('switch',{name:'Confirm sync',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/1 sent to Google/);
 await page.evaluate(()=>{const f=(window as any).calendarSyncFixture;f.remote=null;f.native.phase='undone';});
 await dialog.getByRole('button',{name:'Sync now',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/1 links paused/);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.event.title)).toBe('Local appointment');
 await dialog.getByRole('button',{name:'Sync now',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(/1 links paused/);
 expect(await page.evaluate(()=>(window as any).calendarSyncFixture.native.calls.filter((call:any)=>call.kind==='delete').length)).toBe(1);expect(await page.evaluate(()=>(window as any).calendarSyncFixture.writes)).toBe(1);
});
