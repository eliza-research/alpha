import {type Page} from '@playwright/test';

/** Open recovery through the current Notes menu after its return transition settles. */
export async function openRecentlyDeletedNotes(page:Page){
 const menu=page.getByRole('dialog',{name:'Notes options',exact:true});
 if(!await menu.isVisible())await page.getByRole('button',{name:'Notes options',exact:true}).click();
 await menu.getByRole('button',{name:'Recently deleted',exact:true}).click();
}
