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

test('a camera capture is searchable and Ask Alpha reviews it locally without the development profile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(recordViolations);await page.addInitScript(offline);await page.addInitScript(fakeCamera);
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 await page.getByRole('button',{name:'Camera',exact:true}).click();
 await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 // Camera frame question: an unsaved frame, reviewed text only.
 await page.getByRole('button',{name:'Ask Alpha about this',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Ask about selected content'});
 await expect(review.getByRole('img',{name:'Image for question review'})).toBeVisible();
 await expect(review.getByRole('button',{name:'Extract text locally'})).toBeEnabled();
 await review.getByRole('button',{name:'Cancel',exact:true}).click();await expect(review).toHaveCount(0);
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open last photo',exact:true})).toBeVisible();

 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await page.getByRole('button',{name:'Search photos',exact:true}).click();
 const search=page.getByRole('textbox',{name:'Search photos'});
 await search.fill('today photo');
 await expect(page.getByText('Captured on this device · 1 match',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(1);
 await search.fill('video');
 await expect(page.getByRole('button',{name:/^Captured photo /})).toHaveCount(0);
 await search.fill(new Date().toLocaleDateString('en-US',{weekday:'long'}));
 await page.getByRole('button',{name:/^Captured photo /}).click();

 await page.getByRole('button',{name:'Ask Alpha about this photo',exact:true}).click();
 // The saved photo is read back from its stored data: URL; the preview must decode and
 // local text extraction must be offered, not just an empty image element.
 const savedPreview=review.getByRole('img',{name:'Image for question review'});
 await expect(savedPreview).toBeVisible();
 await expect.poll(()=>savedPreview.evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
 await expect(review.getByRole('button',{name:'Extract text locally'})).toBeEnabled();
 await expect(page.getByText('image analysis is not connected')).toHaveCount(0);
 await review.getByRole('textbox',{name:'Content excerpt'}).fill('A white page that says ALPHA');
 await review.getByRole('button',{name:'Use in conversation'}).click();
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('What does this mean?\n\nSource: Selected photo\n\nA white page that says ALPHA');
 expect(errors).toEqual([]);
 expect(await violations(page)).toEqual([]);
});

test('a selected document is listed in Recent, found by search and reopened from Recent',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(offline);await page.goto('/');
 await page.getByRole('button',{name:'Files',exact:true}).click();
 const documents=page.getByRole('button',{name:'Documents',exact:true});
 await expect(documents).toContainText('Choose a document · PDF or Office');await expect(documents).not.toContainText('items');
 const chooser=page.waitForEvent('filechooser');await documents.click();
 await (await chooser).setFiles({name:'Trip plan.txt',mimeType:'text/plain',buffer:Buffer.from('Pack the blue folder\nTrain at 9')});
 await expect(page.locator('[data-screen]')).toContainText('Pack the blue folder');
 await page.getByRole('button',{name:'Back',exact:true}).click();
 const recent=page.getByRole('button',{name:'Open Trip plan.txt',exact:true});
 await expect(recent).toBeVisible();await expect(recent).toContainText('Text · selected on this device');
 await page.getByRole('button',{name:'Search files',exact:true}).click();
 await page.getByRole('textbox',{name:'Search files'}).fill('trip');
 await expect(page.getByRole('button',{name:'Open Trip plan.txt',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close search',exact:true}).click();
 await page.getByRole('button',{name:'Open Trip plan.txt',exact:true}).click();
 await expect(page.locator('[data-screen]')).toContainText('Train at 9');
 // Forget releases the selection and removes the Recent row.
 await page.getByRole('button',{name:'Forget selected file',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Trip plan.txt',exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});
