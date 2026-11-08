import {test,expect} from '@playwright/test';
// Photos review 6: an agent share or album review belongs to the Photos visit it opened in. Leaving
// Photos ends it, so it neither reappears on a later visit nor blocks the next agent review.
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
 await page.evaluate(async()=>{const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');const canvas=document.createElement('canvas');canvas.width=16;canvas.height=12;const ctx=canvas.getContext('2d')!;ctx.fillStyle='teal';ctx.fillRect(0,0,16,12);await importBrowserPhoto({original:new File([],'source.jpg'),image:canvas.toDataURL('image/jpeg'),width:16,height:12},new AbortController().signal);});
});
for(const kind of ['share','album'])test(`leaving Photos ends an open agent ${kind} review`,async({page})=>{
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const tile=page.locator('button[data-owned-media-id^="native-camera-"]');await expect(tile).toHaveCount(1);
 const id=(await tile.getAttribute('data-owned-media-id'))!.replace(/^native-camera-/,'');
 const ask=(operation:unknown)=>page.evaluate(async op=>{const {deviceLibraryAgent}=await import('/src/prototype/photo-library-adapter.ts');try{return await deviceLibraryAgent()!.runView(op as never,new AbortController().signal);}catch(error){return {refused:(error as Error).message};}},operation);
 const operation=kind==='share'?{type:'photos_share',ids:[id]}:{type:'photos_album_create',name:'Trip',ids:[id]};
 expect(await ask(operation)).toMatchObject({status:'review_opened',count:1});
 const card=page.getByText(kind==='share'?'Share 1 item?':/Trip/).first();await expect(card).toBeVisible();
 expect(await ask({type:'photos_open',id})).toEqual({refused:'Finish the open review first.'});
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await page.getByRole('button',{name:'Photos',exact:true}).click();await expect(tile).toHaveCount(1);
 await expect(page.getByText('Share 1 item?')).toHaveCount(0);
 expect(await ask({type:'photos_open',id})).toEqual({kind:'photos_open',opened:true});
});
