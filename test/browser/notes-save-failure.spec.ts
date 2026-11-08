import {openLegacyNotes} from './helpers/legacy-notes';
import { test, expect } from '@playwright/test';

for (const failure of ['quota', 'concurrent edit'] as const) {
  test(`Notes retains unsaved text after ${failure}`, async ({ page }) => {
    await page.goto('/');
    await openLegacyNotes(page);
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Recovery note');
    const body = page.getByRole('textbox', { name: 'Note', exact: true });
    await body.fill('Saved original');
    await expect.poll(()=>page.evaluate(async()=>JSON.parse(await(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records.find((note:any)=>note.title==='Recovery note')?.body)).toBe('Saved original');
    const stored = await page.evaluate(async failure => {
      const m=await import('/src/runtime/browser-notes-document.ts');
      if(failure==='concurrent edit'){
        const before=(await m.browserNotesPort.read())!,envelope=JSON.parse(before.raw);
        envelope.records.find((note:{title:string})=>note.title==='Recovery note').body='Saved in another view';
        await m.browserNotesPort.compareExchange(before,JSON.stringify(envelope));
      }else{
        const original=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.notes.v1')throw new DOMException('Storage full','QuotaExceededError');return original.call(this,value,key);};
      }
      return m.readBrowserNotesRaw();
    }, failure);
    await body.fill('Unsaved text that must not disappear');
    await expect(body).toHaveValue('Unsaved text that must not disappear');
    await expect(page.getByRole('status').filter({ hasText: 'Keep this screen open' })).toBeVisible();
    // A refused edit must neither overwrite the concurrent value nor repeat an uncertain write.
    expect(await page.evaluate(async () => (await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()))).toBe(stored);
    await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
    await page.getByRole('button', { name: 'Open Recovery note', exact: true }).click();
    await expect(body).toHaveValue('Unsaved text that must not disappear');
    await body.fill('Latest text typed after the failure');
    await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
    await page.getByRole('button', { name: 'Open Recovery note', exact: true }).click();
    await expect(body).toHaveValue('Latest text typed after the failure');
    const recovery=page.getByRole('button', { name: 'Recover browser Notes', exact: true });
    expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await recovery.click();
    const dialog=page.getByRole('dialog', { name: 'Browser Notes recovery' });
    const downloaded=page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download Notes backup', exact: true }).click();
    const stream=await(await downloaded).createReadStream(),chunks:Buffer[]=[];
    for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
    const backup=JSON.parse(Buffer.concat(chunks).toString());
    expect(JSON.parse(backup.saved).currentRaw).toBe(stored);
    expect(JSON.parse(backup.draft).records.find((note:any)=>note.title==='Recovery note').body).toBe('Latest text typed after the failure');
  });
}
