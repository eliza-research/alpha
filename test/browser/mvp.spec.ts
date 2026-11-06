import {openLegacyNotes} from './helpers/legacy-notes';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const views = ['Inbox', 'Calendar', 'Browser', 'Camera', 'Photos', 'Maps', 'Notes', 'Files', 'Workflows', 'Settings'];
for (const theme of ['light', 'dark']) {
  for (const width of [360, 412, 1440]) {
    test(`${theme} ${width}: all MVP views remain accessible`, async ({ page }, info) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 915 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const name of views) {
        await page.goto(`/?theme=${theme}`);
        for (const deferred of ['Phone', 'Messages', 'Contacts', 'Wallet']) await expect(page.getByRole('button', {name: deferred, exact: true})).toHaveCount(0);
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-active-view', name.toLowerCase());
        const box = await page.locator('[data-screen]').boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(916);
        await expect(page.getByText('Reminders could not refresh.', { exact: false })).toHaveCount(0);
        if (width === 412) await page.screenshot({ path: info.outputPath(`${name}.png`) });
      }
      expect(errors).toEqual([]);
    });
  }
}
test('Notes create, edit, reload and delete to Recently deleted', async ({ page }) => {
  await page.goto('/');
  await openLegacyNotes(page);
  // Header: Record and New note only; no search pill, Trash icon or empty-state copy.
  await expect(page.getByRole('button', { name: 'Search notes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Trash', exact: true })).toHaveCount(0);
  await expect(page.getByText('No notes yet', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recently deleted', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Browser audit note');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('A real local draft.\nSecond line.');
  // Editor toolbar: Back · Checklist · Share · ⋯; Read aloud and Dictate are not on it.
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  await page.reload();
  await openLegacyNotes(page);
  // One-column row: title, then the date and a two-line preview.
  await expect(page.getByRole('button', { name: 'Open Browser audit note', exact: true })).toContainText('A real local draft.');
  await page.getByRole('button', { name: 'Open Browser audit note', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
  // Deletion is not immediate erasure: the note waits in Recently deleted for 30 days.
  await expect(page.getByText('Moved to Recently deleted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recently deleted', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Browser audit note, 30 days left', exact: true })).toBeVisible();
});
test('Notes folders: create, move via ⋯, filter by chip, persist, rename by long-press, and delete without losing notes', async ({ page }) => {
  await page.goto('/');
  await openLegacyNotes(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Browser audit note');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('A real local draft.');
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  // A new folder; the note moves into it via ⋯ → Move to…, and the chip filters the list.
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Work, folder options', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Open Browser audit note', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Open Browser audit note', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'Note actions' }).getByRole('button', { name: 'Move to…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Move to' }).getByRole('button', { name: /^Work/ }).click();
  await expect(page.getByText('Moved to Work', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Browser audit note', exact: true })).toBeVisible();
  // Folders persist across a restart, outside the notes collection.
  await page.reload();
  await openLegacyNotes(page);
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Browser audit note', exact: true })).toBeVisible();
  // Long-press a folder chip: Rename keeps the folder's notes and persists in the folder slot.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const chip = page.getByRole('button', { name: 'Work', exact: true });
  await chip.hover();await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
  await page.getByRole('dialog', { name: 'Work' }).getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Folder name', exact: true })).toHaveValue('Work');
  await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Office');
  await page.getByRole('dialog', { name: 'Rename folder' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await openLegacyNotes(page);
  await expect(page.getByRole('button', { name: /^Work/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Office', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Browser audit note', exact: true })).toBeVisible();
  // Deleting the folder keeps its note, now under no folder.
  await page.getByRole('button', { name: 'Office, folder options', exact: true }).click();
  await page.getByRole('dialog', { name: 'Office' }).getByRole('button', { name: 'Delete folder', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Office/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Browser audit note', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => JSON.parse(await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw()).records[0].folderId)).toBeUndefined();
});
for (const [label, text] of [['unicode CRLF', 'Local 🧪 file\r\nExact bytes\n'], ['UTF-8 BOM', '\ufeffLocal 🧪 file\r\nExact bytes\n'], ['empty', '']]) test(`Local text import and complete selected-note download: ${label}`, async ({ page }) => {
  await page.goto('/');
  await openLegacyNotes(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Import text note',exact:true}).click();
  await (await chooser).setFiles({ name:'Owned browser note.txt', mimeType:'text/plain', buffer:Buffer.from(text) });
  await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue(text.replaceAll('\r\n','\n'));
  await page.getByRole('button',{name:'Share note',exact:true}).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Save locally',exact:true}).click();
  const result=await download;
  expect(result.suggestedFilename()).toBe('Owned browser note.txt');
  expect(await readFile((await result.path())!)).toEqual(Buffer.from(['Owned browser note',text].filter(Boolean).join('\n\n'), 'utf8'));
});
test('Mock is explicit, its banner does not cover the phone, and exit restores live mode', async ({ page }) => {
  await page.goto('/?mode=mock');
  await expect(page.getByText('Mock mode · simulated data and actions')).toBeVisible();
  const banner=await page.locator('.mock-mode-banner').boundingBox();
  const phone=await page.locator('[data-screen]').boundingBox();
  expect(phone!.y).toBeGreaterThanOrEqual(banner!.y+banner!.height);
  await Promise.all([page.waitForURL(url=>!url.searchParams.has('mode')),page.getByRole('button',{name:'Exit mock mode',exact:true}).click()]);
  await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
});
test('Notes rejects invalid text and cancels an empty file selection without creating records', async ({page})=>{
  await page.goto('/');await openLegacyNotes(page);
  for(const files of [[{name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from([0xff,0xfe,0])}],[]]) {
    const chooser=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Import text note',exact:true}).click();
    await (await chooser).setFiles(files);
    await expect(page.locator('.notes-row')).toHaveCount(0);
    expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records.length)).toBe(0);
  }
});
test('Scheduled digests traps focus, closes on native Back, and restores the triggering control',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
  const trigger=page.getByRole('button',{name:'Scheduled digests',exact:true});
  await trigger.focus();await trigger.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Scheduled digests',exact:true});
  await expect(dialog).toBeVisible();await expect(dialog).toBeFocused();
  await expect(dialog.getByRole('button',{name:'Result notifications',exact:true})).toBeVisible();
  await expect(dialog).not.toContainText('Result link is waiting for a verified connection.');
  await expect(dialog).toContainText('Choose where your agent runs to set up scheduled digests.');
  await expect(page.locator('.os')).toHaveAttribute('inert','');
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
  await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
});
test('Unsigned recorder opens without a sign-in step and a refused microphone shows one line',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));(window as any).microphoneRequests=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{(window as any).microphoneRequests++;throw Error('Unexpected microphone request');}}});});
  await page.goto('/');await openLegacyNotes(page);
  await page.getByRole('button',{name:'Record and transcribe',exact:true}).click();
  const recorder=page.locator('[data-alpha-subview="notes-recorder"]');
  await expect(recorder).toHaveAttribute('data-recorder-state','failed');
  await expect(recorder.getByRole('alert')).toHaveText('The microphone isn’t available.');
  await expect(recorder.getByRole('button',{name:'Done',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:/Connect Eliza Cloud|Record without transcription|Start recording/})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).microphoneRequests)).toBe(1);
  await recorder.getByRole('button',{name:'Discard recording',exact:true}).click();
  await expect(recorder).toHaveCount(0);
});
test('Display theme survives reload and mock preview does not overwrite it',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Display',exact:true}).click();
  await page.getByRole('button',{name:'Theme: Dark',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('alpha.appearance.v1'))).toBe('dark');
  await page.reload();
  expect(await page.locator('.os').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim())).toBe('#000000');
  await page.goto('/?mode=mock&theme=light');
  expect(await page.evaluate(()=>localStorage.getItem('alpha.appearance.v1'))).toBe('dark');
  await page.goto('/');
  expect(await page.locator('.os').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim())).toBe('#000000');
});

test('MVP mock account and privacy journeys exclude Contacts controls', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?mode=mock&start=settings:privacy');
  await expect(page.getByRole('button',{name:'Microphone',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Contacts',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Microphone',exact:true}).click();
  await expect(page.getByRole('button',{name:'Alpha microphone',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^(Phone|Messages) microphone$/})).toHaveCount(0);
  await page.goto('/?mode=mock&start=settings:accounts');
  await page.getByRole('button',{name:'you@gmail.example',exact:true}).click();
  await expect(page.getByRole('button',{name:'Calendar: Act',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Contacts:/})).toHaveCount(0);
  await page.goto('/?mode=mock&start=settings:adding');
  await expect(page.getByText('Gmail, Calendar',{exact:true})).toBeVisible();
  await expect(page.getByText(/CardDAV|Gmail, Calendar, Contacts/)).toHaveCount(0);
  await page.getByRole('button',{name:'Google',exact:true}).click();
  // Fixture credentials stay in the explicitly labelled mock; no account call occurs.
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('mvp-fixture@example.test');
  await page.getByRole('textbox',{name:'Password',exact:true}).fill('mock-only');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Mail: Act',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Contacts:/})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('MVP mock digest and fallback advertise only retained views', async ({page}) => {
  await page.goto('/?mode=mock');
  const attention=page.getByRole('button',{name:'1 item needs your attention',exact:true});
  await expect(attention).toHaveText('JP');
  await expect(attention).not.toContainText(/MC|PN/);
  await attention.click();
  await expect(page.getByText('1 item needs your attention.',{exact:true})).toBeVisible();
  await page.goto('/?mode=mock&start=sheet');
  const composer=page.getByRole('textbox',{name:'Message Alpha',exact:true});
  await composer.fill('zzzzzz unknown request');await composer.press('Enter');
  await expect(page.getByText(/I can't do that yet. Try opening Inbox/)).toBeVisible();
  await expect(page.getByText(/I can message, call|navigate, pay/)).toHaveCount(0);
  await composer.fill('catch me up');await composer.press('Enter');
  await expect(page.getByText('1 item needs your attention.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Still on for 3|Sent you the photos from Saturday/})).toHaveCount(0);
  await page.getByRole('button',{name:/JP Jordan Park Revised term sheet attached/}).click();
  await expect(page.getByRole('heading',{name:'Revised term sheet',exact:true})).toBeVisible();
});

test('MVP Notes sharing keeps email and export without a deferred SMS dead end',async({page})=>{
  await page.goto('/');await openLegacyNotes(page);
  await page.getByRole('button',{name:'New note',exact:true}).click();
  await page.getByRole('textbox',{name:'Title',exact:true}).fill('MVP share scope');
  await page.getByRole('textbox',{name:'Note',exact:true}).fill('Local test note');
  await page.getByRole('button',{name:'Share note',exact:true}).click();
  await expect(page.getByRole('button',{name:'Share to email',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save locally',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share externally',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share in Messages',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Local test note');
});
test('the notes:rec deep link no longer opens the old simulated clip recorder', async ({ page }) => {
  await page.goto('/?mode=mock&start=notes:rec');
  await expect(page.getByText('Recording isn’t available in this preview.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-alpha-subview="notes-recording"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop and save', exact: true })).toHaveCount(0);
});
