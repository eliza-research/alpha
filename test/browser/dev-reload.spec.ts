import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,rm,realpath,rename,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {browserFullReload} from '../../scripts/browser-full-reload';
for(const polling of [false,true]) for(const replacement of [false,true]) test(`source ${polling?'polled':'default-watched'} ${replacement?'atomic replacements':'edits'} reload bootstrap once and preserve browser-local state`,async({page})=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'alpha-reload-')));await mkdir(path.join(root,'src'));
 await writeFile(path.join(root,'index.html'),'<script type="module" src="/src/main.js"></script>');
 await writeFile(path.join(root,'src/value.js'),'export const value="before";');
 await writeFile(path.join(root,'src/main.js'),'import {value} from "./value.js"; const count=Number(localStorage.getItem("boots")||0)+1;localStorage.setItem("boots",String(count));document.body.textContent=value+":"+count;');
 const server=await createServer({configFile:false,root,plugins:[browserFullReload()],server:{host:'127.0.0.1',port:0,...(polling?{watch:{usePolling:true,interval:50}}:{})}});await server.listen();
 try{
  const connected=page.waitForEvent('console',message=>message.text().includes('[vite] connected'));const address=server.httpServer!.address() as {port:number};await page.goto(`http://127.0.0.1:${address.port}`);await expect(page.locator('body')).toHaveText('before:1');await connected;
  await expect.poll(()=>server.watcher.getWatched()[path.join(root,'src')]||[]).toContain('value.js');
  await page.evaluate(()=>localStorage.setItem('saved-note','Retain me'));
  const file=path.join(root,'src/value.js');
  if(replacement){
   const original=await stat(file),temporary=path.join(root,'src/value.js.next');
   await writeFile(temporary,'export const value="after";');await utimes(temporary,original.atime,original.mtime);await rename(temporary,file);
   // Native watchers can announce an existing path as added during replacement.
   if(!polling)server.watcher.emit('add',file);
  }else await writeFile(file,'export const value="after";');
  await expect(page.locator('body')).toHaveText('after:2');
  if(replacement&&!polling){await page.waitForTimeout(500);await expect(page.locator('body')).toHaveText('after:2');}
  expect(await page.evaluate(()=>localStorage.getItem('saved-note'))).toBe('Retain me');
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
test('delayed unchanged source and CSS notifications do not restart the document',async({page})=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'alpha-stale-reload-')));await mkdir(path.join(root,'src'));
 await writeFile(path.join(root,'index.html'),'<script type="module" src="/src/main.js"></script>');await writeFile(path.join(root,'src/theme.css'),'body{color:black}');await writeFile(path.join(root,'src/main.js'),'import "./theme.css";const n=Number(localStorage.getItem("boots")||0)+1;localStorage.setItem("boots",String(n));document.body.textContent="boot:"+n;');
 const server=await createServer({configFile:false,root,plugins:[browserFullReload()],server:{host:'127.0.0.1',port:0,watch:{usePolling:true,interval:50}}});await server.listen();
 try{const connected=page.waitForEvent('console',m=>m.text().includes('[vite] connected'));const address=server.httpServer!.address() as {port:number};await page.goto(`http://127.0.0.1:${address.port}`);await expect(page.locator('body')).toHaveText('boot:1');await connected;const sent:any[]=[],send=server.ws.send.bind(server.ws);server.ws.send=((...args:any[])=>{sent.push(args[0]);return(send as any)(...args);}) as typeof server.ws.send;
  server.watcher.emit('change',path.join(root,'src/main.js'));server.watcher.emit('change',path.join(root,'src/theme.css'));await page.waitForTimeout(500);expect(sent.filter(x=>x?.type==='full-reload'||x?.type==='update')).toEqual([]);await expect(page.locator('body')).toHaveText('boot:1');
  await writeFile(path.join(root,'src/theme.css'),'body{color:rgb(12,34,56)}');await expect(page.locator('body')).toHaveCSS('color','rgb(12, 34, 56)');await expect(page.locator('body')).toHaveText('boot:1');
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
