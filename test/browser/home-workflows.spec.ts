import {installWorkflowListFixture,workflowCard} from './workflow-navigation';
import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});
const home=(page:Page)=>page.getByRole('region',{name:'Home',exact:true});
const tile=(page:Page)=>home(page).getByRole('button',{name:/Open workflows|Retry workflows|Connect agent for workflows/});
async function setup(page:Page,theme='light'){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev&workflows=agent&theme='+theme);await installWorkflowListFixture(page);
 await page.evaluate(async()=>{
  const f=(window as any).homeWorkflowFixture={listCalls:0,statusCalls:0,rows:[],hold:false,error:false,writeCalls:0};
  const {WorkflowProtocol:P}=await import('/src/runtime/workflow-protocol.ts');
  P.prototype.lifecycleSupported=async()=>{f.statusCalls++;return false;};
  P.prototype.list=async()=>{f.listCalls++;const rows=structuredClone(f.rows);if(f.hold)await new Promise<void>(resolve=>f.release=resolve);if(f.error)throw Error('Synthetic metadata outage');return rows;};
  P.prototype.detail=async id=>f.rows.find((row:any)=>row.id===id);P.prototype.executions=async()=>[];
  for(const method of ['activate','pause','run','lifecycle','updateMetadata'])(P.prototype as any)[method]=async()=>{f.writeCalls++;throw Error('Writes are not part of Home');};
 });
}
async function rows(page:Page,values:any[]){await page.evaluate(values=>{(window as any).homeWorkflowFixture.rows=values;},values);}
const flow=(id:string,name:string,active=true)=>({id,name,active,description:'',versionId:id+'-version',steps:[]});
async function connect(page:Page){await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');});}
async function back(page:Page){await page.getByRole('button',{name:'Back to apps',exact:true}).click();}
for(const theme of ['light','dark'])test(`Home shows actual workflow names and states, then opens the existing list: ${theme}`,async({page},info)=>{
 await setup(page,theme);await rows(page,[flow('morning','Morning brief'),flow('stretch','Stretch reminder',false),flow('notes','Weekly notes'),flow('plan','Plan tomorrow'),{...flow('removed','Removed routine'),removed:true}]);await connect(page);
 await expect(tile(page)).toContainText('Morning brief');await expect(tile(page)).toContainText('Stretch reminder');await expect(tile(page)).toContainText('Paused');await expect(tile(page)).toContainText('+2 more');await expect(tile(page)).not.toContainText('Routines and automations');await expect(tile(page)).not.toContainText('Review');await expect(tile(page)).not.toContainText('Removed routine');await expect(tile(page).locator('[aria-hidden="true"]')).toHaveCSS('mask-image',/lucide\/workflow\.svg/);await expect.poll(()=>tile(page).evaluate(element=>{const icon=element.querySelector('[aria-hidden="true"]')!.getBoundingClientRect(),box=element.getBoundingClientRect();return Math.round(box.right-icon.right);})).toBe(22);
 await tile(page).evaluate(element=>element.scrollIntoView({behavior:'instant',block:'nearest',inline:'start'}));await expect(tile(page)).toBeInViewport({ratio:1});await page.screenshot({path:info.outputPath('home-workflows-'+theme+'.png'),animations:'disabled'});await tile(page).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');await expect(workflowCard(page,'Morning brief')).toBeVisible();await expect(workflowCard(page,'Stretch reminder')).toContainText('Paused');expect(await page.evaluate(()=>(window as any).homeWorkflowFixture.writeCalls)).toBe(0);
});

const metadataReads=(page:Page)=>page.evaluate(()=>(window as any).workflowMetadataFixtureCalls.filter((call:any)=>call.path==='/api/automations').length);
test('empty Home opens unified metadata honestly and rerenders do not refetch it',async({page})=>{
 await setup(page);await connect(page);await expect(tile(page)).toHaveCount(0);expect(await metadataReads(page)).toBe(0);
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent draft');await page.locator('[data-alpha-dock-scrim="true"]').click({position:{x:12,y:12}});await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toHaveValue('Unsent draft');expect(await metadataReads(page)).toBe(0);
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(page.locator('[data-alpha-subview="workflows-list"]').getByText('No workflows yet',{exact:true})).toBeVisible();
 await back(page);await expect(tile(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Workflows',exact:true})).toBeVisible();const calls=await metadataReads(page);expect(calls).toBe(1);
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Still unsent');expect(await metadataReads(page)).toBe(calls);
});
test('Home retains the unified snapshot and a new list visit refreshes changed names',async({page})=>{
 await setup(page);await rows(page,[flow('morning','Morning brief')]);await connect(page);await expect(tile(page)).toContainText('Morning brief');
 await tile(page).click();await expect(workflowCard(page,'Morning brief')).toBeVisible();await back(page);await expect(tile(page)).toContainText('Morning brief');
 await rows(page,[flow('morning','Morning update',false)]);const before=await metadataReads(page);await expect(tile(page)).toContainText('Morning brief');
 await tile(page).click();await expect(workflowCard(page,'Morning update')).toBeVisible();expect(await metadataReads(page)).toBe(before+1);
 await back(page);await expect(tile(page)).toHaveCount(0);await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(workflowCard(page,'Morning update')).toContainText('Paused');
});
test('unified metadata loading and failure offer explicit refresh without running anything',async({page})=>{
 await setup(page);await connect(page);await expect.poll(()=>page.evaluate(()=>(window as any).homeWorkflowFixture.listCalls)).toBe(1);
 await page.evaluate(()=>{const f=(window as any).homeWorkflowFixture;f.hold=true;f.error=true;});await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Refreshing automations…'})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeWorkflowFixture.release)).toBe('function');await page.evaluate(()=>(window as any).homeWorkflowFixture.release());await expect(page.getByRole('alert').filter({hasText:'Automations could not refresh.'})).toContainText('Automations could not refresh. Retry to check the current records.');
 await page.evaluate(()=>{const f=(window as any).homeWorkflowFixture;f.hold=false;f.error=false;f.rows=[{id:'ready',name:'Recovered routine',active:true,description:'',versionId:'v1',steps:[]}];});
 await page.getByRole('button',{name:'Filter workflows',exact:true}).click();await page.getByRole('dialog',{name:'Filter workflows',exact:true}).getByRole('button',{name:'Refresh list',exact:true}).click();await expect(workflowCard(page,'Recovered routine')).toBeVisible();await back(page);await expect(tile(page)).toContainText('Recovered routine');expect(await page.evaluate(()=>(window as any).homeWorkflowFixture.writeCalls)).toBe(0);
});
test('disconnect retires names and a late old-account unified result cannot refill Home',async({page})=>{
 await setup(page);await rows(page,[flow('private','First owner routine')]);await connect(page);await expect(tile(page)).toContainText('First owner routine');
 await page.evaluate(()=>(window as any).homeWorkflowFixture.hold=true);await tile(page).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeWorkflowFixture.release)).toBe('function');
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});await back(page);await expect(tile(page)).toHaveCount(0);expect(await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().session)).toBeNull();
 await page.evaluate(()=>{const f=(window as any).homeWorkflowFixture;f.release();f.hold=false;f.rows=[{id:'second',name:'Second owner routine',active:false,description:'',versionId:'v2',steps:[]}];});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await expect(tile(page)).toHaveCount(0);await connect(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(workflowCard(page,'Second owner routine')).toContainText('Paused');await back(page);await expect(tile(page)).toHaveCount(0);
});
test('leaving foreground retires unified metadata and resumes through one fresh list',async({page})=>{
 await setup(page);await rows(page,[flow('morning','Morning brief')]);await connect(page);await tile(page).click();await expect(workflowCard(page,'Morning brief')).toBeVisible();const before=await metadataReads(page);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete(document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await expect(workflowCard(page,'Morning brief')).toBeVisible();await expect.poll(()=>metadataReads(page)).toBe(before+1);await back(page);await expect(tile(page)).toContainText('Morning brief');
});
