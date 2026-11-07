import {test,expect} from '@playwright/test';
// Files agent filter (design/view-refresh-2026-11 PLAN.md section 4; spec files-browser FilterIsReadOnly).
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test('an agent filter started from another view while Files reloads leaves its results usable',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['%PDF-1.4'],'bank statement.pdf',{type:'application/pdf'}));});
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await expect(page.getByRole('button',{name:'Internal storage',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();
 await expect(page.getByRole('button',{name:'Internal storage',exact:true})).toHaveCount(0);
 // Opening Files starts a reload; the filter runs while it is still in flight.
 const summary=await page.evaluate(async()=>{const {filesAgent}=await import('/src/runtime/files-agent-contract.ts');return (await filesAgent()!.run({type:'files_filter',text:'statement'} as any)).summary;});
 expect(summary).toBe('Showing 1 item in Files.');
 const row=page.getByRole('button',{name:'Open bank statement.pdf',exact:true});
 await expect(row).toBeVisible();
 // Not stuck busy: the row opens the file.
 await row.click();
 await expect(page.getByRole('region',{name:'Files'}).getByRole('button',{name:'Rename',exact:true})).toHaveText('bank statement.pdf');
});
