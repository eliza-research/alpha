import {test,expect} from '@playwright/test';

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
