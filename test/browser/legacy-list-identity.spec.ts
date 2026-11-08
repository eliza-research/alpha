import {test,expect} from '@playwright/test';

const offline = () => localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));

test('duplicate legacy bookmark URLs render once and retain stored values',async({page})=>{
  const first='https://legacy-list.example/one',second='https://legacy-list.example/two';
  await page.addInitScript(({first,second})=>{
    localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
    localStorage.setItem('alpha.browser.bookmarks.v1',JSON.stringify([first,second,first]));
  },{first,second});
  await page.goto('/');
  await page.getByRole('button',{name:'Browser',exact:true}).click();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('button',{name:'Bookmarks and history',exact:true}).click();
  await expect(page.getByRole('button',{name:first,exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:second,exact:true})).toHaveCount(1);
  const stored=await page.evaluate(async()=>{
    const {registerPlugin}=await import('/src/platform-plugins.ts');
    return (await registerPlugin<any>('AlphaBrowser').bookmarks()).urls;
  });
  expect(stored).toEqual([first,second,first]);
});

test('duplicate legacy Recent IDs render newest metadata and retain stored records',async({page})=>{
  await page.addInitScript(offline);
  await page.goto('/');
  await page.evaluate(async()=>{
    const {registerPlugin}=await import('/src/platform-plugins.ts');
    const {filesIndex,filesIndexKey}=await import('/src/prototype/files-index.ts');
    const selected=await registerPlugin<any>('AlphaFiles').importFile(new File(['one'],'one.txt',{type:'text/plain'}));
    filesIndex.record({kind:'selected',name:selected.name,mimeType:selected.mimeType,selectionId:selected.selectionId});
    const row=filesIndex.list()[0];
    localStorage.setItem(filesIndexKey,JSON.stringify([{...row,name:'Older label.txt',openedAt:row.openedAt-1},row]));
  });
  await page.getByRole('button',{name:'Files',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open one.txt',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Open Older label.txt',exact:true})).toHaveCount(0);
  expect(await page.evaluate(async()=>{
    const {filesIndex}=await import('/src/prototype/files-index.ts');return filesIndex.list().length;
  })).toBe(2);
});
