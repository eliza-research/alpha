import {test,expect,type Page} from '@playwright/test';
// Runs in the `production` project: a flag-off build without mocks, fixtures or the
// browser development profile. A synthetic canvas stream stands in for the camera
// permission boundary only; capture, IndexedDB storage, search, the file picker and
// the reviewed question flow are the shipped code. Nothing is uploaded or sent.

const offline=()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
// Records CSP violations in each loaded document, so a blocked fetch or image is caught.
const recordViolations=()=>{const seen:string[]=[];(window as unknown as {cspViolations:string[]}).cspViolations=seen;document.addEventListener('securitypolicyviolation',event=>seen.push(event.violatedDirective+' '+event.blockedURI.slice(0,40)));};
const violations=(page:Page)=>page.evaluate(()=>(window as unknown as {cspViolations:string[]}).cspViolations);
const fakeCamera=()=>{
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d')!;
 const paint=()=>{context.fillStyle='white';context.fillRect(0,0,640,480);context.fillStyle='black';context.font='64px sans-serif';context.fillText('ALPHA',150,260);};paint();setInterval(paint,50);
 const devices=navigator.mediaDevices;devices.getUserMedia=async()=>canvas.captureStream(20);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
};

test('a camera capture persists and Ask Alpha attaches it locally without the development profile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(recordViolations);await page.addInitScript(offline);await page.addInitScript(fakeCamera);
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 await page.getByRole('button',{name:'Camera',exact:true}).click();
 await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 // The header is Back and Flash only: no title, image import, scan or ask button.
 for(const name of ['Ask Alpha about this','Choose image','Scan document','Scan mode'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(page.locator('[data-alpha-camera-root] [data-alpha-app-title]')).toHaveCount(0);
 // Camera frame question (mainline #815's check, reached by asking in chat): an unsaved frame, reviewed text only.
 await page.getByRole('button',{name:'Type',exact:true}).click();
 const ask=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
 await ask.fill('What am I looking at?');await ask.press('Enter');
 const frame=page.getByRole('dialog',{name:'Ask about selected content'});
 await expect(frame.getByRole('img',{name:'Image for question review'})).toBeVisible();
 await expect(frame.getByRole('button',{name:'Extract text locally'})).toBeEnabled();
 await frame.getByRole('button',{name:'Cancel',exact:true}).click();await expect(frame).toHaveCount(0);
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open last photo',exact:true})).toBeVisible();

 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 // No search box: the agent filters Photos. The capture opens from the day-grouped grid.
 await expect(page.getByRole('button',{name:'Search photos',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Photo, /}).click();

 await page.getByLabel('Photo actions',{exact:true}).click();
 await page.getByRole('button',{name:'Ask Alpha',exact:true}).click();
 // Saved photos are compact chat attachments. Selecting one does not dispatch a question.
 await expect(page.getByRole('dialog',{name:'Ask about selected content'})).toHaveCount(0);
 const savedPreview=page.getByRole('button',{name:'Preview attached photo',exact:true}).getByRole('img',{name:'Captured photo',exact:true});
 await expect(savedPreview).toBeVisible();
 await expect.poll(()=>savedPreview.evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('');
 await expect(page.getByRole('button',{name:'Remove photo',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
 expect(await violations(page)).toEqual([]);
});

test('Files browses real storage: categories, Internal storage and Trash, with no picker, search or Recents',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(offline);await page.goto('/');
 await page.getByRole('button',{name:'Files',exact:true}).click();
 for(const name of ['Downloads','Images','Videos','Audio','Documents','Internal storage','Recently deleted'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 for(const gone of ['Search files','Receipts','Photos','App files','Import folder'])await expect(page.getByRole('button',{name:gone,exact:true})).toHaveCount(0);
 await expect(page.locator('[data-screen]')).not.toContainText('No recent files');
 const documents=page.getByRole('button',{name:'Documents',exact:true});
 let chooser=false;page.on('filechooser',()=>{chooser=true;});
 await documents.click();await expect(page.getByRole('heading',{name:'Documents',exact:true})).toBeVisible();expect(chooser).toBe(false);
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Files options',exact:true}).click();
 await page.getByRole('button',{name:'New folder',exact:true}).click();
 await page.getByRole('textbox',{name:'Name'}).fill('Taxes');await page.getByRole('button',{name:'Create',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Taxes',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
