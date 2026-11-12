import type {Page} from '@playwright/test';
/** Account-local copies are normal entries in Drafts, separate from Gmail drafts. */
export async function localDraftRow(page:Page,name:string|RegExp=/^Draft,/){
 await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();
 return page.getByRole('button',{name}).first();
}
