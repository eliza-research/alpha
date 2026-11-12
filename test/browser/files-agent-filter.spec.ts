import {test,expect,type Page} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route(/\/src\/runtime\/connection-ui\.tsx(\?.*)?$/,async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text())+'\nwindow.__filesTestExecutor=(...args)=>deviceExecutor(...args);\n'});
 });
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
});
const execute=(page:Page,operation:Record<string,string>)=>page.evaluate(async operation=>{
 const {alphaClient}=await import('/src/runtime/alpha-client.ts');
 return (window as any).__filesTestExecutor(operation,'11111111-1111-4111-8111-111111111111',structuredClone(alphaClient.getState().context),new AbortController().signal);
},operation);

test('an agent filter from Home opens Files on its first visit and leaves the result usable',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['%PDF-1.4'],'bank statement.pdf',{type:'application/pdf'}));});
 expect(await execute(page,{type:'files_filter',text:'statement'})).toEqual({status:'succeeded',summary:'Showing 1 item in Files.'});
 const row=page.getByRole('button',{name:'Open bank statement.pdf',exact:true});
 await expect(row).toBeVisible();
 await expect(page.getByText('No results to show',{exact:true})).toHaveCount(0);
 // Not stuck busy: the row opens the file.
 await row.click();
 await expect(page.getByRole('region',{name:'Files'}).getByRole('button',{name:'Rename',exact:true})).toHaveText('bank statement.pdf');
});

test('a zero-match Files filter shows an accessible empty result that clears with the filter',async({page})=>{
 expect(await execute(page,{type:'files_filter',text:'no-fixture-match'})).toEqual({status:'succeeded',summary:'Showing 0 items in Files.'});
 const empty=page.locator('[data-alpha-subview="files-list"]').getByRole('status').filter({hasText:'No results to show'});
 await expect(empty).toBeVisible();
 await page.getByRole('button',{name:'Clear filter',exact:true}).click();
 await expect(empty).toHaveCount(0);
 await expect(page.getByRole('button',{name:'All files',exact:true})).toBeVisible();
});
test('a held or failed Files query does not report an empty result',async({page})=>{
 await page.evaluate(async()=>{
  const {BrowserFiles}=await import('/src/browser/files.ts');
  const query=Promise.withResolvers<void>();
  Object.assign(window,{filesQueryStarted:false,finishFilesQuery:query.resolve});
  BrowserFiles.prototype.storageQuery=async()=>{
   Object.assign(window,{filesQueryStarted:true});
   await query.promise;
   return {status:'unavailable'};
  };
 });
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await expect(page.getByRole('button',{name:'All files',exact:true})).toBeVisible();
 const results=page.locator('[data-alpha-subview="files-list"]');
 const empty=results.getByRole('status').filter({hasText:'No results to show'});
 const pending=execute(page,{type:'files_filter',text:'held-query'});
 try {
  await expect.poll(()=>page.evaluate(()=>(window as any).filesQueryStarted)).toBe(true);
  await expect(results.getByRole('status').filter({hasText:'Searching…'})).toBeVisible();
  await expect(empty).toHaveCount(0);
 } finally {
  await page.evaluate(()=>(window as any).finishFilesQuery());
  await pending;
 }
 expect((await pending).status).toBe('failed');
 await expect(results.getByRole('status').filter({hasText:'Files could not read this filter.'})).toBeVisible();
 await expect(empty).toHaveCount(0);
});
test('an agent open waits for the first Files render and opens the requested file',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['Review this text'],'notice.txt',{type:'text/plain'}));});
 expect(await execute(page,{type:'files_open',path:'notice.txt'})).toEqual({status:'succeeded',summary:'Opened the file in Files.'});
 await expect(page.getByRole('region',{name:'Files'}).getByRole('button',{name:'Rename',exact:true})).toHaveText('notice.txt');
 await expect(page.getByText('Review this text',{exact:true})).toBeVisible();
});

test('a folder mutation submitted from Home cannot open Files or create a folder',async({page})=>{
 expect((await execute(page,{type:'files_folder_create',parent:'',name:'Unexpected'})).status).toBe('failed');
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 const names=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').storageList({path:''})).entries.map((entry:any)=>entry.name);});
 expect(names).not.toContain('Unexpected');
});
