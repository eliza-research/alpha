import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])test(`Files aligns category, storage and Trash rows in ${theme}`,async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(`/?mode=dev&theme=${theme}`);
 await page.getByRole('button',{name:'Files',exact:true}).click();
 const list=page.locator('[data-alpha-app-scroll="files"]');
 await expect(list.getByRole('heading',{name:'Storage',exact:true})).toBeVisible();
 const labels=[];
 for(const name of ['Downloads','Images','Videos','Audio','Documents','Internal storage','Trash']){
  const row=list.getByRole('button',{name,exact:true});
  await expect(row).toBeVisible();
  const label=await row.getByText(name,{exact:true}).boundingBox();
  const box=await row.boundingBox();
  expect(label).not.toBeNull();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  labels.push(label!.x);
 }
 expect(Math.max(...labels)-Math.min(...labels)).toBeLessThan(1);
 await page.screenshot({path:info.outputPath('files-aligned.png'),animations:'disabled'});
});
