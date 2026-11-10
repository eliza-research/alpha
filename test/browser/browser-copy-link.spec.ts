import {test,expect} from '@playwright/test';

test('Copy link follows committed Back navigation rather than the address draft',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const copied:string[]=[];(window as any).copiedBrowserLinks=copied;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{copied.push(value);}}});
 });
 await page.route('https://copy.example/**',route=>route.fulfill({contentType:'text/html',body:`<h1>${new URL(route.request().url()).pathname}</h1>`}));
 await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();
 const menu=()=>page.getByRole('button',{name:'Menu',exact:true}).click();
 await menu();await expect(page.getByRole('button',{name:'Copy link',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 const visit=async(path:string)=>{
  await page.getByRole('button',{name:'Edit address',exact:true}).click();
  const address=page.getByRole('textbox',{name:'Address',exact:true});await address.fill('https://copy.example'+path);await address.press('Enter');
  await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:path,exact:true})).toBeVisible();
 };
 await visit('/first');await visit('/second');await page.getByRole('button',{name:'Previous page',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:'/first',exact:true})).toBeVisible();
 await menu();await page.getByRole('button',{name:'Copy link',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).copiedBrowserLinks)).toEqual(['https://copy.example/first']);
 await expect(page.getByRole('dialog',{name:'Browser menu',exact:true})).toHaveCount(0);
});

test('Address editing uses local visits without network suggestions and keeps URL keyboard hints',async({page})=>{
 const requests:string[]=[];
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.route('https://local-suggestions.example/page',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<h1>Local page</h1>'});});
 await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();await page.getByRole('button',{name:'Edit address',exact:true}).click();
 const address=page.getByRole('textbox',{name:'Address',exact:true});
 for(const [name,value] of [['enterkeyhint','go'],['autocapitalize','none'],['autocorrect','off'],['spellcheck','false'],['autocomplete','off']])await expect(address).toHaveAttribute(name,value);
 await address.fill('https://local-suggestions.example/page');await address.press('Enter');await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:'Local page'})).toBeVisible();
 await page.getByRole('button',{name:'Edit address',exact:true}).click();await page.getByRole('button',{name:'Clear address',exact:true}).click();await expect(address).toHaveValue('');await expect(address).toBeFocused();
 const suggestion=page.getByRole('button',{name:'local-suggestions.example /page',exact:true});await expect(suggestion).toBeVisible();await address.fill('local-suggestions');await expect(suggestion).toBeVisible();expect(requests).toHaveLength(1);await suggestion.click();await expect.poll(()=>requests.length).toBe(2);
});

for(const query of ['@nasa','meet @ noon','john@gmail.com'])test(`Address search accepts ${query}`,async({page})=>{
 const searches:string[]=[];
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.route('https://www.google.com/search?**',route=>{searches.push(new URL(route.request().url()).searchParams.get('q')||'');return route.fulfill({contentType:'text/html',body:'<h1>Explicit search</h1>'});});
 await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();await page.getByRole('button',{name:'Edit address',exact:true}).click();const address=page.getByRole('textbox',{name:'Address',exact:true});await address.fill(query);await address.press('Enter');await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:'Explicit search'})).toBeVisible();expect(searches).toEqual([query]);
});

test('Slow page loads show progress and can be stopped from the toolbar',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.route('https://loading.example/slow',async route=>{requests++;await pending;await route.fulfill({contentType:'text/html',body:'<h1>Late page</h1>'}).catch(()=>{});});
 try{await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();await page.getByRole('button',{name:'Edit address',exact:true}).click();const address=page.getByRole('textbox',{name:'Address',exact:true});await address.fill('https://loading.example/slow');await address.press('Enter');await expect.poll(()=>requests).toBe(1);await expect(page.getByRole('progressbar',{name:'Loading website'})).toBeVisible();await page.getByRole('button',{name:'Stop loading',exact:true}).click();await expect(page.getByText('Loading stopped. Reload to open this page.',{exact:true})).toBeVisible();await expect(page.getByRole('progressbar',{name:'Loading website'})).toHaveCount(0);}finally{release();}
});
