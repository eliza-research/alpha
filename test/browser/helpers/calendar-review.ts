import {expect,type Page} from '@playwright/test';
/** Operates the mounted accessible Calendar review, including its explicit Cancel path. */
export async function reviewCalendarAction(page:Page,action:()=>Promise<unknown>,accept=true){
 await action();const review=page.locator('dialog.alpha-operation-review');await expect(review).toBeVisible();
 await (accept?review.locator('footer button').last():review.getByRole('button',{name:'Cancel',exact:true})).click();
 await expect(review).toHaveCount(0);
}
