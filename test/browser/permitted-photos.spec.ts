import {test,expect} from '@playwright/test';
import {photosBridge} from './helpers/photos-bridge';
test('full access shows the library with no access row and requests no permission automatically',async({page})=>{
 await photosBridge(page);await expect(page.getByRole('button',{name:'Allow access to all photos',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(0);
 // One catalog: the grid pages AlphaPhotos.list; the search box and its provider query are gone.
 await expect(page.getByRole('button',{name:'Search photos',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.some((c:any)=>c.method==='listPermitted'))).toBe(false);
});
test('selected access shows one row that opens the system access sheet',async({page})=>{
 await photosBridge(page,'selected');
 const allow=page.getByRole('button',{name:'Allow access to all photos',exact:true});
 await expect(allow).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(0);
 await allow.click();await expect(allow).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(1);
});
test('Settings shows selected photo access and its choice control requests more access',async({page})=>{
 await photosBridge(page,'selected');
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByText('Selected photos and videos',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Choose photo access',exact:true}).click();await expect(page.getByText('All photos and videos',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(1);
});
test('denied Photos keeps an explicit permission request and loads the library after approval',async({page})=>{
 await photosBridge(page,'denied');
 const choose=page.getByRole('button',{name:'Allow access to all photos',exact:true});
 await expect(choose).toBeVisible();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(0);
 await choose.click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 await expect(choose).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='requestLibraryAccess').length)).toBe(1);
});
test('revocation clears already rendered Favorites and returns to the owned-only scope',async({page})=>{
 await photosBridge(page);await page.getByRole('button',{name:'Albums',exact:true}).click();await page.getByRole('button',{name:'Favorites',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 await page.evaluate(()=>{const f=(window as any).mediaFixture;f.scope='denied';f.emit();});
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(0);
});
