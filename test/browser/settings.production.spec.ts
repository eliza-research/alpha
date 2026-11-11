import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,fenceNetwork} from './flag-off-android';
import {residentStub} from './resident-stub';

// The flag-off product exposes grouped Settings. Native diagnostics stay absent, and app-specific
// controls are reached through Apps rather than added to the top-level list.
const current=(page:Page)=>page.locator('[data-settings-page]:not([inert])').last();
const offline=()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
test.describe.configure({timeout:240_000});
test.beforeEach(async({page},info)=>{
 test.skip(info.project.name!=='production','Production lane only');
 await page.addInitScript(offline);
});
async function openSettings(page:Page,...route:string[]){
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 for(const label of route)await current(page).getByRole('button',{name:label,exact:true}).click();
}
const absent=['Wi-Fi','Bluetooth','Mobile data','Battery','Sound & vibration','Models','Privacy & data','Voice and agent settings','Developer','Home app','Load images in email'];

test('production Settings opens every category and its app settings through the displayed controls',async({page})=>{
 for(const category of ['General','Privacy','Apps','About']){
  await openSettings(page);await current(page).getByRole('button',{name:category,exact:true}).click();
  await expect(current(page).getByRole('heading',{name:category,exact:true})).toBeVisible();
  await expect(current(page).getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
 }
 for(const app of ['Browser','Calendar','Camera','Files','Inbox','Maps','Notes','Passwords','Photos','Workflows']){
  await openSettings(page,'Apps',app);
  // An app with nothing to set here opens the app itself (no one-row pages); Photos too off Android.
  if(['Browser','Files','Photos'].includes(app)){await expect(page.locator('html')).toHaveAttribute('data-active-view',app.toLowerCase());continue;}
  await expect(current(page).getByRole('heading',{name:app==='Passwords'?'Password manager':app,exact:true})).toBeVisible();
  await expect(current(page).getByRole('button',{name:'Back to Apps',exact:true})).toBeVisible();
 }
 await openSettings(page,'General','Display');
 const dark=current(page).getByRole('button',{name:'Theme: Dark',exact:true});await dark.click();
 await expect(dark).toHaveAttribute('aria-pressed','true');
 await current(page).getByRole('button',{name:'Theme: Light',exact:true}).click();
 await expect(current(page).getByRole('button',{name:'Theme: Light',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('production Settings excludes developer and removed rows for every requested entry mode',async({page})=>{
 for(const query of ['/','/?tools=1','/?mode=dev&tools=1']){
  await page.goto(query);await page.getByRole('button',{name:'Settings',exact:true}).click();
  for(const label of absent)await expect(current(page).getByRole('button',{name:label,exact:true})).toHaveCount(0);
  for(const category of ['General','Privacy','Apps','About'])await expect(current(page).getByRole('button',{name:category,exact:true})).toBeVisible();
  await current(page).getByRole('button',{name:'About',exact:true}).click();
  for(const label of ['Problem log','Export diagnostics','Developer'])await expect(current(page).getByRole('button',{name:label,exact:true})).toHaveCount(0);
  await expect(current(page).getByRole('button',{name:'Licenses',exact:true})).toBeVisible();
 }
});

test('production Google account entry opens and dismisses its owned dialog',async({page})=>{
 const foreign=await fenceNetwork(page);await flagOffAndroid(page);await residentStub(page);
 await openSettings(page,'Account');
 await page.getByRole('dialog',{name:'Account',exact:true}).getByRole('button',{name:'Google & email',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Google accounts',exact:true});
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('button',{name:'Connect Google account',exact:true})).toBeVisible();
 await expect(panel.getByText('Gmail notification settings',{exact:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'Close Google accounts',exact:true}).click();
 await expect(panel).toHaveCount(0);
 await expect(current(page).getByRole('button',{name:'Account',exact:true})).toBeVisible();
 expect(foreign).toEqual([]);
});

test('production About exposes licenses without fabricated device facts or diagnostic controls',async({page})=>{
 await openSettings(page,'About');
 const about=(await current(page).innerText()).replace(/\s+/g,' ');
 expect(about).not.toMatch(/\bNPU\b|Uptime|Inference model|Not reported by agent|Problem log|Export diagnostics|Security patch/);
 await current(page).getByRole('button',{name:'Licenses',exact:true}).click();
 await expect(current(page).getByRole('heading',{name:'Licenses',exact:true})).toBeVisible();
 await expect(current(page).getByRole('button',{name:'Back to About',exact:true})).toBeVisible();
 // A missing native role plugin is not a successful refusal.
 for(const method of ['getStatus','requestRole'])expect(await page.evaluate(async method=>{
  const plugin=(window as any).Capacitor?.Plugins?.ElizaSystem;if(typeof plugin?.[method]!=='function')return 'missing';
  try{await plugin[method]({role:'home'});return 'resolved';}catch(error){return error instanceof Error?error.message:'non-error';}
 },method)).toBe('Device roles are managed by the operating system, not this browser.');
});
