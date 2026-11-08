import {test,expect,type Page} from '@playwright/test';
const journal=(page:Page)=>page.evaluate(()=>(Object.values(JSON.parse(localStorage.getItem('alpha.dev.app.workflows')!).localRuns) as any[])[0]);
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:()=>{throw Error('Host location must not be requested');},clearWatch:()=>{}}});});await page.goto('/?mode=dev&tools=1');});
async function configure(page:Page,latitude=0,accuracy=5){await page.evaluate(async({latitude,accuracy})=>{const {SavedPlaces}=await import('/src/maps/saved-places.ts');const home=new SavedPlaces().save({label:'My home',coordinate:{latitude:0,longitude:0}});const {saveLocationSimulation}=await import('/src/browser/location-simulation.ts');saveLocationSimulation({mode:'coordinates',latitude,longitude:0,accuracy,homeId:home.id,radius:200});},{latitude,accuracy});}
async function workflow(page:Page){await page.evaluate(()=>localStorage.setItem('alpha.dev.app.workflows',JSON.stringify({flows:[{id:984,name:'Away test',on:true,trig:{kind:'time',days:'Every day',t:8},steps:[{k:'If',t:"I'm not at home",apps:['Location']},{k:'Do',t:'Turn on Do Not Disturb',apps:['Settings']}],runs:[]}],localRuns:{}})));await page.reload();await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByText('Away test',{exact:true}).click();await page.getByRole('button',{name:'Run now',exact:true}).click();}
for(const [latitude,status,cursor] of [[0,'skip',1],[.01,'ok',2]] as const)test(`home condition uses actual coordinate distance: ${status}`,async({page})=>{await configure(page,latitude);await workflow(page);await expect.poll(async()=>(await journal(page))?.status).toBe(status);expect((await journal(page)).cursor).toBe(cursor);expect(await page.evaluate(async()=>JSON.parse((await (await import('/src/browser/preference-documents.ts')).devicePreferencesDocument.readRaw())||'{}').doNotDisturb||false)).toBe(status==='ok');});
test('uncertain Home boundary cannot enable later actions',async({page})=>{await configure(page,.0018,100);await workflow(page);await expect.poll(async()=>(await journal(page))?.status).toBe('fail');expect((await journal(page)).sum).toContain('accuracy overlaps');expect((await journal(page)).cursor).toBe(0);});
test('location controls select a saved Home and persist validated coordinates',async({page},info)=>{await page.evaluate(async()=>{const {SavedPlaces}=await import('/src/maps/saved-places.ts');new SavedPlaces().save({label:'Home fixture',coordinate:{latitude:43.738,longitude:7.424}});});await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls'}).getByRole('button',{name:'Location',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Development location'});await dialog.getByLabel('Home place',{exact:true}).selectOption({label:'Home fixture'});await dialog.getByRole('button',{name:'Use Home coordinates'}).click();await expect(dialog.getByLabel('Latitude',{exact:true})).toHaveValue('43.738');await dialog.getByLabel('Latitude',{exact:true}).fill('100');await dialog.getByRole('button',{name:'Save location'}).click();await expect(dialog.getByRole('status')).not.toBeEmpty();expect(await page.evaluate(()=>localStorage.getItem('alpha.dev.location.v1'))).toBeNull();await dialog.getByLabel('Latitude',{exact:true}).fill('43.738');await page.screenshot({path:info.outputPath('location-controls.png')});await dialog.getByRole('button',{name:'Save location'}).click();await expect(dialog).toHaveCount(0);await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.location.v1')!))).toMatchObject({latitude:43.738,longitude:7.424,mode:'coordinates',radius:200});});
test('live coordinate updates drive location listeners and sensor off retires the watch',async({page})=>{await configure(page);const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const {saveLocationSimulation,readLocationSimulation}=await import('/src/browser/location-simulation.ts');const location=registerPlugin<any>('ElizaLocation'),events:any[]=[];const listener=await location.addListener('locationChange',(fix:any)=>events.push(fix));await location.watchPosition();await new Promise(r=>setTimeout(r,20));saveLocationSimulation({...readLocationSimulation(),latitude:.01});await new Promise(r=>setTimeout(r,20));await registerPlugin<any>('AlphaDevice').setSensor({field:'locationEnabled',enabled:false});const count=events.length;saveLocationSimulation({...readLocationSimulation(),latitude:.02});await new Promise(r=>setTimeout(r,1100));await listener.remove();return {latitudes:events.map(e=>e.coords.latitude),count,final:events.length,permission:await location.checkPermissions()};});expect(result.latitudes).toContain(0);expect(result.latitudes).toContain(.01);expect(result.final).toBe(result.count);expect(result.permission.location).toBe('denied');});
test('background prevents starting a coordinate watch',async({page})=>{await configure(page);const blocked=await page.evaluate(async()=>{document.documentElement.dataset.devBackground='true';const {registerPlugin}=await import('/src/platform-plugins.ts');try{await registerPlugin<any>('ElizaLocation').watchPosition();return false;}catch{return true;}});expect(blocked).toBe(true);});
test('normal browser profile ignores developer coordinates',async({page})=>{await configure(page);await page.goto('/?tools=1');const state=await page.evaluate(async()=>{const {readLocationSimulation}=await import('/src/browser/location-simulation.ts');return readLocationSimulation();});expect(state.mode).toBe('browser');});
test('a cancelled location condition retires a pending host fix without accepting it late',async({page})=>{await configure(page);const result=await page.evaluate(async()=>{const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');saveLocationSimulation({...readLocationSimulation(),mode:'browser'});let callback:Function|undefined,cleared=0;Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});Object.defineProperty(navigator,'geolocation',{value:{watchPosition:(fn:Function)=>{callback=fn;return 42;},clearWatch:()=>cleared++}});const {workflowAwayFromHome}=await import('/src/browser/workflow-location.ts');const abort=new AbortController(),pending=workflowAwayFromHome(abort.signal).then(()=>false,error=>error.name==='AbortError');while(!callback)await new Promise(r=>setTimeout(r,0));abort.abort();callback({coords:{latitude:1,longitude:1,accuracy:5},timestamp:Date.now()});return {cancelled:await pending,cleared};});expect(result.cancelled).toBe(true);expect(result.cleared).toBeGreaterThan(0);});
test('Maps Recenter displays the configured development coordinates',async({page})=>{await configure(page,.01);await page.getByRole('button',{name:'Maps',exact:true}).click();await page.getByRole('button',{name:'Recenter',exact:true}).click();await expect(page.getByText('Current location',{exact:true})).toBeVisible();await expect(page.getByText('0.01000, 0.00000',{exact:true})).toBeVisible();await expect(page.getByText('Location fix · accuracy ±5 m',{exact:true})).toBeVisible();});
test('another tab updates the active coordinate stream',async({page,context})=>{await configure(page);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const location=registerPlugin<any>('ElizaLocation');(window as any).positionEvents=[];(window as any).positionListener=await location.addListener('locationChange',(value:any)=>(window as any).positionEvents.push(value.coords.latitude));(window as any).positionWatch=await location.watchPosition();});const other=await context.newPage();await other.goto('/?mode=dev');await other.evaluate(async()=>{const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');saveLocationSimulation({...readLocationSimulation(),latitude:.02});});await expect.poll(()=>page.evaluate(()=>(window as any).positionEvents.includes(.02))).toBe(true);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('ElizaLocation').clearWatch((window as any).positionWatch);await (window as any).positionListener.remove();});await other.close();});
test('Home edits during a pending host fix reject the outdated boundary',async({page})=>{await configure(page);const error=await page.evaluate(async()=>{const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');saveLocationSimulation({...readLocationSimulation(),mode:'browser'});let callback:Function|undefined;Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});Object.defineProperty(navigator,'geolocation',{value:{watchPosition:(fn:Function)=>{callback=fn;return 42;},clearWatch:()=>{}}});const {workflowAwayFromHome}=await import('/src/browser/workflow-location.ts');const pending=workflowAwayFromHome(new AbortController().signal).then(()=>'',error=>error.message);while(!callback)await new Promise(r=>setTimeout(r,0));const {SavedPlaces}=await import('/src/maps/saved-places.ts');new SavedPlaces().rename(readLocationSimulation().homeId,'Edited Home');callback({coords:{latitude:1,longitude:1,accuracy:5},timestamp:Date.now()});return pending;});expect(error).toContain('Home changed');});

test('changing Home during a held fix rejects the old boundary',async({page})=>{
 await configure(page);const result=await page.evaluate(async()=>{const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');saveLocationSimulation({...readLocationSimulation(),mode:'browser'});let callback:Function|undefined;Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});Object.defineProperty(navigator,'geolocation',{value:{watchPosition:(fn:Function)=>{callback=fn;return 91;},clearWatch:()=>{}}});const {workflowAwayFromHome}=await import('/src/browser/workflow-location.ts');const pending=workflowAwayFromHome(new AbortController().signal).then(()=>'',error=>error.message);while(!callback)await new Promise(r=>setTimeout(r,0));saveLocationSimulation({...readLocationSimulation(),radius:500});callback({coords:{latitude:1,longitude:1,accuracy:5},timestamp:Date.now()});return pending;});expect(result).toContain('Home changed');
});

test('cancelling a pending permission request immediately clears its browser watch',async({page})=>{
 await configure(page);const result=await page.evaluate(async()=>{const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');saveLocationSimulation({...readLocationSimulation(),mode:'browser'});let called=false,cleared=0;Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'prompt'})}});Object.defineProperty(navigator,'geolocation',{value:{watchPosition:()=>{called=true;return 73;},clearWatch:(id:number)=>{if(id===73)cleared++;}}});const {workflowAwayFromHome}=await import('/src/browser/workflow-location.ts');const abort=new AbortController();const pending=workflowAwayFromHome(abort.signal).then(()=>false,error=>error.name==='AbortError');while(!called)await new Promise(r=>setTimeout(r,0));abort.abort();return {cancelled:await pending,cleared};});expect(result.cancelled).toBe(true);expect(result.cleared).toBe(1);
});

test('cancelling one permission request leaves another owner active',async({page})=>{
 const result=await page.evaluate(async()=>{const {BrowserLocation}=await import('/src/browser/location.ts');let next=0,ready!:()=>void;const started=new Promise<void>(resolve=>ready=resolve),callbacks:Function[]=[],cleared:number[]=[];Object.defineProperty(navigator,'geolocation',{value:{watchPosition:(fn:Function)=>{callbacks.push(fn);const id=++next;if(id===2)ready();return id;},clearWatch:(id:number)=>cleared.push(id)}});const location=new BrowserLocation();const a=location.requestPermissions({requestId:'first'}),b=location.requestPermissions({requestId:'second'});await started;await location.cancelPermissionRequest({requestId:'first'});const before=[...cleared];callbacks[1]();return {first:await a,second:await b,before,cleared};});expect(result.first.location).toBe('denied');expect(result.second.location).toBe('granted');expect(result.before).toEqual([1]);expect(result.cleared).toEqual([1,2]);
});

for(const change of ['same-tab','storage-event','clear'] as const)test(`location preference ${change} retires a pending permission request`,async({page})=>{
 const result=await page.evaluate(async change=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');
  const {saveLocationSimulation,readLocationSimulation,locationSimulationKey}=await import('/src/browser/location-simulation.ts');
  let callback!:()=>void,started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve),cleared:number[]=[];
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:(fn:()=>void)=>{callback=fn;started();return 92;},clearWatch:(id:number)=>cleared.push(id)}});
  const location=new BrowserLocation(),pending=location.requestPermissions({requestId:'old-source'});await ready;
  const value={...readLocationSimulation(),mode:'coordinates' as const};
  if(change==='same-tab')saveLocationSimulation(value);
  else {if(change==='storage-event')localStorage.setItem(locationSimulationKey,JSON.stringify(value));else localStorage.removeItem(locationSimulationKey);window.dispatchEvent(new StorageEvent('storage',{key:change==='clear'?null:locationSimulationKey}));}
  callback();return {permission:await pending,cleared};
 },change);expect(result).toEqual({permission:{location:'denied',accuracy:'none'},cleared:[92]});
});
test('malformed location settings retire a browser watch without accepting a late fix',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');const {locationSimulationKey}=await import('/src/browser/location-simulation.ts');
  let callback!:(value:any)=>void;const cleared:number[]=[],fixes:any[]=[],errors:any[]=[];
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:(fn:any)=>{callback=fn;return 93;},clearWatch:(id:number)=>cleared.push(id)}});
  const location=new BrowserLocation();await location.addListener('locationChange',fix=>fixes.push(fix));await location.addListener('error',error=>errors.push(error));await location.watchPosition();
  localStorage.setItem(locationSimulationKey,'broken exact bytes');window.dispatchEvent(new StorageEvent('storage',{key:locationSimulationKey}));callback({coords:{latitude:1,longitude:1,accuracy:5},timestamp:Date.now()});
  return {cleared,fixes,errors,raw:localStorage.getItem(locationSimulationKey)};
 });expect(result).toEqual({cleared:[93],fixes:[],errors:[{code:'UNAVAILABLE'}],raw:'broken exact bytes'});
});
test('location source change rejects a delayed permission status',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');
  let finish!:(value:any)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:()=>new Promise(resolve=>{finish=resolve;started();})}});
  const location=new BrowserLocation(),pending=location.checkPermissions();await ready;saveLocationSimulation({...readLocationSimulation(),mode:'coordinates'});finish({state:'granted'});return pending;
 });expect(result).toEqual({location:'denied',accuracy:'none'});
});

for(const retired of [false,true])test(`failed permission query preserves current ownership: retired=${retired}`,async({page})=>{
 const result=await page.evaluate(async retired=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');const {readLocationSimulation,saveLocationSimulation}=await import('/src/browser/location-simulation.ts');
  let reject!:(error:Error)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  // Startup may query permissions too. All callers must share the same outcome,
  // rather than replacing the rejection callback and stranding this request.
  const denied=new Promise<never>((_resolve,fail)=>{reject=fail;});
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:()=>{started();return denied;}}});
  const pending=new BrowserLocation().checkPermissions();await ready;if(retired)saveLocationSimulation({...readLocationSimulation(),mode:'coordinates'});reject(Error('Permission query unavailable'));return pending;
 },retired);expect(result).toEqual({location:retired?'denied':'prompt',accuracy:'none'});
});
test('another tab changing location cancels the first tab permission request',async({page,context})=>{
 await page.evaluate(async()=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');const state=(window as any).locationRace={cleared:[]};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:(fn:any)=>{state.callback=fn;return 94;},clearWatch:(id:number)=>state.cleared.push(id)}});
  state.pending=new BrowserLocation().requestPermissions({requestId:'tab-one'}).then(result=>state.result=result);
 });
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).locationRace.callback)).toBe('function');
 const other=await context.newPage();await other.goto('/?mode=dev');
 await other.evaluate(async()=>{const m=await import('/src/browser/location-simulation.ts');m.saveLocationSimulation({...m.readLocationSimulation(),mode:'coordinates',latitude:12});});
 await expect.poll(()=>page.evaluate(()=>(window as any).locationRace.result?.location)).toBe('denied');
 expect(await page.evaluate(async()=>{const state=(window as any).locationRace;state.callback();await state.pending;return {result:state.result,cleared:state.cleared};})).toEqual({result:{location:'denied',accuracy:'none'},cleared:[94]});
});

for(const code of [1,2,3])test(`browser location distinguishes permission denial from provider failure ${code}`,async({page})=>{
 const result=await page.evaluate(async code=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');const cleared:number[]=[];
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>{throw Error('Permissions API unsupported');}}});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:(_success:unknown,error:(value:{code:number})=>void)=>{queueMicrotask(()=>error({code}));return 97;},clearWatch:(id:number)=>cleared.push(id)}});
  try{return {permission:await new BrowserLocation().requestPermissions(),cleared};}catch(error){return {error:{code:(error as any).code,message:(error as Error).message},cleared};}
 },code);expect(result.cleared).toEqual([97]);
 if(code===1)expect(result.permission).toEqual({location:'denied',accuracy:'none'});
 else {expect(result.error?.code).toBe('unavailable');expect(result.error?.message).toContain(code===3?'timed out':'could not provide');}
});


for(const outcome of ['grant','cancel'] as const)test(`permission grant is independent of a timed-out fix: ${outcome}`,async({page})=>{
 const result=await page.evaluate(async outcome=>{
  const {BrowserLocation}=await import('/src/browser/location.ts');
  const status=Object.assign(new EventTarget(),{state:'prompt'});let removed=0;const remove=status.removeEventListener.bind(status);status.removeEventListener=(...args:Parameters<typeof status.removeEventListener>)=>{removed++;remove(...args);};
  let fail!: (e:{code:number})=>void,success!:()=>void;const started=Promise.withResolvers<void>(),cleared:number[]=[];
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>status}});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:(ok:()=>void,error:(e:{code:number})=>void)=>{success=ok;fail=error;started.resolve();return 198;},clearWatch:(id:number)=>cleared.push(id)}});
  const location=new BrowserLocation();let settled=false;
  const pending=location.requestPermissions({requestId:'permission-fix-race'}).then(result=>{settled=true;return result;});
  await started.promise;fail({code:3});await new Promise(resolve=>setTimeout(resolve,0));const settledWhilePrompt=settled;
  if(outcome==='cancel')await location.cancelPermissionRequest({requestId:'permission-fix-race'});
  status.state='granted';status.dispatchEvent(new Event('change'));
  const result=await pending;success();status.state='denied';status.dispatchEvent(new Event('change'));
  return {result,settledWhilePrompt,cleared,removed};
 },outcome);
 expect(result).toEqual({result:{location:outcome==='grant'?'granted':'denied',accuracy:outcome==='grant'?'precise':'none'},settledWhilePrompt:false,cleared:[198],removed:1});
});
