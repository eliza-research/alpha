import { test, expect } from '@playwright/test';
test.describe('explicit development build',()=>{
 test('development profile remains available without production sign-in gate',async({page})=>{await page.goto('/?mode=dev');await expect(page.getByRole('main',{name:'Sign in',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await expect(page.getByRole('heading',{name:'Development connections',exact:true})).toBeVisible();});
});
