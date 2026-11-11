import {expect,test} from '@playwright/test';
import {openLegacyNotes} from './helpers/legacy-notes';

test('Previous notes Trash names both actions and keeps confirmation above the dock',async({page})=>{
 const title='Reviewed deleted note';
 await page.goto('/');
 await openLegacyNotes(page,[{id:'trash-dialog-fixture',kind:'text',title,body:'Synthetic note.'}]);
 await page.getByRole('button',{name:`Open ${title}`,exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('dialog',{name:'Note actions',exact:true}).getByRole('button',{name:'Delete',exact:true}).click();
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await trash.getByRole('button',{name:`${title}, 30 days left`,exact:true}).click();
 const review=page.getByRole('dialog',{name:title});
 await expect(review).toBeVisible();
 await expect.soft(review).toHaveAccessibleName(`Recover or delete “${title}”?`);
 const dockReserve=await review.evaluate(element=>getComputedStyle(element).bottom);
 expect(parseFloat(dockReserve)).toBeGreaterThan(0);
 await review.getByRole('button',{name:'Delete now',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:`Delete “${title}”?`,exact:true});
 await expect(confirm).toHaveCSS('bottom',dockReserve);
 await expect(confirm.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(confirm).toHaveCount(0);
 await expect(trash.getByRole('button',{name:`${title}, 30 days left`,exact:true})).toBeVisible();
});
