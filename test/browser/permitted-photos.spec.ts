import {test,expect} from '@playwright/test';
import {photosBridge} from './helpers/photos-bridge';
test('permitted library requests no permission automatically and searches through the provider',async({page})=>{
 await photosBridge(page);await expect(page.getByRole('button',{name:'Photo access settings',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose photo access',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(0);
 await page.getByRole('button',{name:'Search photos',exact:true}).click();await page.getByRole('textbox',{name:'Search photos'}).fill('unmatched');
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).mediaFixture.calls.some((c:any)=>c.method==='listPermitted'&&c.input.query==='unmatched'))).toBe(true);
});
test('selected access is explicit and only the choice control requests more access',async({page})=>{
 await photosBridge(page,'selected');await expect(page.getByRole('button',{name:'Choose photo access',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByText('Selected photos and videos',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Choose photo access',exact:true}).click();await expect(page.getByText('All photos and videos',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(1);
});
test('denied Photos keeps an explicit permission request and loads the library after approval',async({page})=>{
 await photosBridge(page,'denied');
 const choose=page.getByRole('button',{name:'Choose photo access',exact:true});
 await expect(choose).toBeVisible();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(0);
 await choose.click();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await expect(choose).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(1);
});
test('revocation clears already rendered Favorites and returns to the owned-only scope',async({page})=>{
 await photosBridge(page,'full',true,false,true);await page.getByRole('button',{name:'Albums',exact:true}).click();await page.getByRole('button',{name:'Favorites',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(2);
 const owned=await page.evaluate(()=>'Captured photo '+new Date((window as any).mediaFixture.ownedRow.date).toLocaleTimeString());
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.scope='denied';f.emit();});
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await expect(page.getByRole('button',{name:owned,exact:true})).toBeVisible();
});
