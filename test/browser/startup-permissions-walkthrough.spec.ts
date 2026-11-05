import {test,expect,type Page} from '@playwright/test';
async function open(page:Page,deny=false,theme='light'){
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(({deny})=>{
  const prior=JSON.parse(sessionStorage.getItem('required-proof-permissions')||'null');
  const proof=(window as any).requiredProof={states:prior||{notifications:'default',microphone:'prompt',camera:'prompt',location:'prompt'},requests:[],stops:0};
  const persist=()=>sessionStorage.setItem('required-proof-permissions',JSON.stringify(proof.states));
  Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return proof.states.notifications;},async requestPermission(){proof.requests.push({kind:'notifications'});proof.states.notifications=deny?'denied':'granted';persist();return proof.states.notifications;}}});
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{async query({name}){return {state:proof.states[name==='geolocation'?'location':name]};}}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(input){const kind=input.video?'camera':'microphone';proof.requests.push({kind,input});proof.states[kind]='granted';persist();return {getTracks:()=>[{readyState:'live',stop(){proof.stops++;}}]};}}});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(_ok,fail){proof.requests.push({kind:'location'});proof.states.location='granted';persist();fail({code:2});}}});
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'none'}));
 },{deny});
 await page.goto('/?theme='+theme);await page.evaluate(async()=>{(await import('/src/runtime/connection-ui.tsx')).connectionController.close();window.dispatchEvent(new Event('alpha:setup-permissions'));});
 await expect(page.locator('dialog.alpha-startup-permissions')).toBeVisible();
}
for(const viewport of [{width:412,height:915,theme:'light'},{width:1280,height:800,theme:'light'},{width:842,height:390,theme:'dark'}])test(`recovered original required design/order and Ready ${viewport.width}`,async({page},info)=>{
 await page.setViewportSize({width:viewport.width,height:viewport.height});await open(page,false,viewport.theme);const panel=page.locator('dialog.alpha-startup-permissions');await page.evaluate(()=>document.fonts.ready);
 await expect(panel.locator('[data-alpha-dialog-toast]')).toHaveCount(1);
 const layout=await panel.evaluate(dialog=>{
  const content=dialog.querySelector('.alpha-permission-content')!.getBoundingClientRect();
  const center=dialog.getBoundingClientRect().left+dialog.clientWidth/2;
  return {offset:Math.abs(content.left+content.width/2-center),overflow:dialog.scrollWidth-dialog.clientWidth};
 });
 expect(layout.offset).toBeLessThanOrEqual(1);
 expect(layout.overflow).toBe(0);
 await expect(panel.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();await expect(panel.getByRole('button')).toHaveCount(1);const contrast=await panel.locator('.alpha-permission-primary').evaluate(el=>{const style=getComputedStyle(el),rgb=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number),luma=(value:number[])=>value.map(x=>{const s=x/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0),a=luma(rgb(style.color)),b=luma(rgb(style.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});expect(contrast).toBeGreaterThanOrEqual(4.5);expect(await page.evaluate(()=>(window as any).requiredProof.requests)).toEqual([]);
 if(!process.env.REQUIRED_NO_SCREENSHOTS)await page.screenshot({path:info.outputPath(`original-notifications-${viewport.width}.png`),animations:'disabled'});
 await page.keyboard.press('Escape');await expect(panel).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(panel.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();
 for(const name of ['Notifications','Microphone','Camera','Location']){await expect(panel.getByRole('heading',{name,exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:/Skip|Not now|Back/})).toHaveCount(0);await panel.getByRole('button',{name:'Allow',exact:true}).click();}
 await expect(panel.getByRole('heading',{name:'You’re all set',exact:true})).toBeVisible();await page.evaluate(async()=>{const icon=new Image();icon.src='/icons/lucide/check.svg';await icon.decode();});expect(await page.evaluate(()=>(window as any).requiredProof.requests.map((x:any)=>x.kind))).toEqual(['notifications','microphone','camera','location']);expect(await page.evaluate(()=>(window as any).requiredProof.requests.find((x:any)=>x.kind==='camera').input)).toEqual({video:true,audio:false});expect(await page.evaluate(()=>(window as any).requiredProof.stops)).toBe(2);
 if(!process.env.REQUIRED_NO_SCREENSHOTS)await page.screenshot({path:info.outputPath(`original-ready-${viewport.width}.png`),animations:'disabled'});
 await panel.getByRole('button',{name:'Go to Alpha'}).click();await expect(panel).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')!))).toEqual({version:1,status:'completed',step:4});await page.reload();await expect(panel).toHaveCount(0);
});
test('required browser denial and cold return expose Settings/check access without another prompt',async({page})=>{
 await open(page,true);const panel=page.locator('dialog.alpha-startup-permissions');await panel.getByRole('button',{name:'Allow',exact:true}).click();await expect(panel.getByRole('button',{name:'Check access',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Check access',exact:true}).click();expect(await page.evaluate(()=>(window as any).requiredProof.requests)).toEqual([{kind:'notifications'}]);await expect(panel.getByRole('button',{name:/Skip|Not now|Back/})).toHaveCount(0);await page.reload();await page.evaluate(async()=>{(await import('/src/runtime/connection-ui.tsx')).connectionController.close();window.dispatchEvent(new Event('alpha:setup-permissions'));});await expect(panel.getByRole('button',{name:'Check access',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).requiredProof.requests)).toEqual([]);
});

// Browser-rendered recovery with controlled permission APIs, not proof of an OS grant.
test('a pending notification prompt releases Checking at its deadline while required setup stays gated',async({page})=>{
 await open(page);
 await page.evaluate(()=>{
  Notification.requestPermission=()=>{
   (window as any).requiredProof.requests.push({kind:'notifications'});
   return new Promise<NotificationPermission>(resolve=>{(window as any).completeRequiredNotification=resolve;});
  };
 });
 const panel=page.locator('dialog.alpha-startup-permissions');
 await panel.getByRole('button',{name:'Allow',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Checking…',exact:true})).toBeDisabled();
 await expect(panel.getByRole('button',{name:'Check access',exact:true})).toBeEnabled({timeout:17000});
 await expect(panel.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:/Skip|Not now|Back|Go to Alpha/})).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')!))).toEqual({version:1,status:'pending',step:0});
 expect(await page.evaluate(()=>(window as any).requiredProof.requests)).toEqual([{kind:'notifications'}]);
 // A late promise result is not permission authority; the fixture's actual status stays default.
 await page.evaluate(()=>(window as any).completeRequiredNotification('granted'));
 await panel.getByRole('button',{name:'Check access',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Check access',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).requiredProof.requests)).toEqual([{kind:'notifications'}]);
 expect(await page.evaluate(()=>Notification.permission)).toBe('default');
});

test('existing Google panel owns the modal and returning resumes the same required permission',async({page})=>{
 await open(page);const panel=page.locator('dialog.alpha-startup-permissions');await panel.getByRole('button',{name:'Allow',exact:true}).click();await expect(panel.getByRole('heading',{name:'Microphone',exact:true})).toBeVisible();await page.evaluate(async()=>(await import('/src/runtime/google-connection-ui.tsx')).googleConnectionController.open());await expect(panel).toHaveCount(0);await page.evaluate(async()=>(await import('/src/runtime/google-connection-ui.tsx')).googleConnectionController.close());await expect(panel.getByRole('heading',{name:'Microphone',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).requiredProof.requests)).toEqual([{kind:'notifications'}]);
});
