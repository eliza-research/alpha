import {test,expect} from '@playwright/test';
// Runs in the `production` project: a flag-off build without mocks, fixtures or the
// browser development profile. A synthetic canvas stream stands in for the camera
// permission boundary only; capture, IndexedDB storage, search, the file picker and
// the reviewed question flow are the shipped code. Nothing is uploaded or sent.

const offline=()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
const fakeCamera=()=>{
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d')!;
 const paint=()=>{context.fillStyle='white';context.fillRect(0,0,640,480);context.fillStyle='black';context.font='64px sans-serif';context.fillText('ALPHA',150,260);};paint();setInterval(paint,50);
 const devices=navigator.mediaDevices;devices.getUserMedia=async()=>canvas.captureStream(20);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
};

test('a camera capture is searchable and Ask Alpha reviews it locally without the development profile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(offline);await page.addInitScript(fakeCamera);
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-connection-mode','live');
 await page.getByRole('button',{name:'Camera',exact:true}).click();
 await expect.poll(()=>page.locator('[aria-label^="Viewfinder."] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 // The header is Back and Flash only: no title, image import, scan or ask button.
 for(const name of ['Ask Alpha about this','Choose image','Scan document','Scan mode'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(page.locator('[data-alpha-camera-root] [data-alpha-app-title]')).toHaveCount(0);
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open last photo',exact:true})).toBeVisible();

 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 // No search box: the agent filters Photos. The capture opens from the day-grouped grid.
 await expect(page.getByRole('button',{name:'Search photos',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Photo, /}).click();

 await page.getByRole('button',{name:'Ask Alpha about this photo',exact:true}).click();const review=page.getByRole('dialog',{name:'Ask about selected content'});
 await expect(review.getByRole('img',{name:'Image for question review'})).toBeVisible();
 await expect(page.getByText('image analysis is not connected')).toHaveCount(0);
 await review.getByRole('textbox',{name:'Content excerpt'}).fill('A white page that says ALPHA');
 await review.getByRole('button',{name:'Use in conversation'}).click();
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('What does this mean?\n\nSource: Selected photo\n\nA white page that says ALPHA');
 expect(errors).toEqual([]);
});

test('Files browses real storage: categories, Internal storage and Trash, with no picker, search or Recents',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(offline);await page.goto('/');
 await page.getByRole('button',{name:'Files',exact:true}).click();
 for(const name of ['Downloads','Images','Videos','Audio','Documents','Internal storage','Trash'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 for(const gone of ['Search files','Receipts','Photos','App files','Import folder'])await expect(page.getByRole('button',{name:gone,exact:true})).toHaveCount(0);
 await expect(page.locator('[data-screen]')).not.toContainText('No recent files');
 const documents=page.getByRole('button',{name:'Documents',exact:true});
 let chooser=false;page.on('filechooser',()=>{chooser=true;});
 await documents.click();await expect(page.getByRole('heading',{name:'Documents',exact:true})).toBeVisible();expect(chooser).toBe(false);
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Sort and more',exact:true}).click();await page.getByText('New folder',{exact:true}).click();
 await page.getByRole('textbox',{name:'Name'}).fill('Taxes');await page.getByRole('button',{name:'Create',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Taxes',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
