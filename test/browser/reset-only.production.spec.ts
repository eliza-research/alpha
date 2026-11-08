import {openLegacyNotes} from './helpers/legacy-notes';
import {test,expect} from '@playwright/test';

test('production retained Notes offers editing without import/export migration controls',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await openLegacyNotes(page);
 await expect(page.getByRole('button',{name:'Import text note',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Export text file',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/New note|Create note/}).first()).toBeVisible();
});

test('production damaged-data notice preserves bytes and has no backup or per-store reset',async({page})=>{
 const raw='{preserve damaged bookmarks';
 await page.addInitScript(raw=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.browser.bookmarks.v1',raw);},raw);
 await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
 await page.getByRole('button',{name:'Recover saved bookmarks',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Browser bookmark recovery'});await expect(dialog).toBeVisible();
 await expect(dialog.getByText(/Saved data and recoverable drafts are kept in Alpha/)).toBeVisible();
 await expect(dialog.getByRole('button')).toHaveText(['Close']);
 await expect(dialog.locator('input[type=file],a[download]')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.bookmarks.v1'))).toBe(raw);
});
