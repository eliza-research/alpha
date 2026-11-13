import {test,expect,type Page} from '@playwright/test';

async function choose(page:Page,name:RegExp|string){
 await page.getByRole('button',{name:'Files options',exact:true}).click();
 await page.getByRole('dialog',{name:'Sort and more',exact:true}).getByRole('button',{name}).click();
}
test('All files exposes direct folder/view controls and all six sort directions without changing files',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts'),files=registerPlugin<any>('AlphaFiles');
  for(const [name,text]of [['Zulu.txt','1234567890'],['Alpha.txt','1'],['Middle.txt','12345']]){
   await files.importFile(new File([text],name,{type:'text/plain'}));
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 });
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await expect(page.getByRole('button',{name:'All files',exact:true})).toBeVisible();
 await page.getByLabel('Files tools',{exact:true}).click();
 const browse=page.locator('[data-alpha-subview="files-list"]');
 await expect(browse.getByRole('button',{name:'New folder',exact:true})).toBeVisible();
 for(const name of ['Sort files','Grid view'])await expect(browse.getByRole('button',{name,exact:true})).toHaveCount(0);
 await page.getByLabel('Files tools',{exact:true}).click();
 await page.getByRole('button',{name:'All files',exact:true}).click();
 await expect(page.getByRole('heading',{name:'All files',exact:true})).toBeVisible();
 const names=()=>page.locator('[data-alpha-subview="files-folder"] button[aria-label^="Open "]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')!.slice(5)).filter(n=>['Zulu.txt','Alpha.txt','Middle.txt'].includes(n)));
 // Choosing a different field returns to that field's conventional order.
 await choose(page,'Newest first');await choose(page,'Name A–Z');
 await expect.poll(names).toEqual(['Alpha.txt','Middle.txt','Zulu.txt']);
 await choose(page,'Name Z–A');await expect.poll(names).toEqual(['Zulu.txt','Middle.txt','Alpha.txt']);
 await choose(page,'Largest first');await expect.poll(names).toEqual(['Zulu.txt','Middle.txt','Alpha.txt']);
 await choose(page,'Smallest first');await expect.poll(names).toEqual(['Alpha.txt','Middle.txt','Zulu.txt']);
 await choose(page,'Newest first');await expect.poll(names).toEqual(['Middle.txt','Alpha.txt','Zulu.txt']);
 await choose(page,'Oldest first');await expect.poll(names).toEqual(['Zulu.txt','Alpha.txt','Middle.txt']);
 await page.getByRole('button',{name:'Files options',exact:true}).click();await page.getByRole('button',{name:'Grid view',exact:true}).click();
 await page.getByRole('button',{name:'Files options',exact:true}).click();await expect(page.getByRole('button',{name:'List view',exact:true})).toBeVisible();await page.getByRole('button',{name:'List view',exact:true}).click();
 await expect.poll(names).toEqual(['Zulu.txt','Alpha.txt','Middle.txt']);
});
