import {chromium} from '@playwright/test';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:412,height:915}});
p.on('console',m=>console.log('console',m.type(),m.text().slice(0,300)));p.on('pageerror',e=>console.log('pageerror',e.message.slice(0,300)));
await p.goto(process.argv[2]);await p.waitForTimeout(5000);
await p.screenshot({path:process.argv[3]});console.log((await p.locator('body').innerText()).slice(0,800));await b.close();
