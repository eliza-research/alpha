import {writeFileSync} from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
// Production lane only (flag-off build). Every Settings control must do something real: open a
// page, a dialog, a view or a file, change visible state, or state its verified authority guard.
// An unexplained toast-only affordance fails. Fixture device facts (NPU, uptime, seeded battery) must
// not appear.
const offline=()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
test.describe.configure({timeout:240_000});
// The development lane serves a flag-on build where simulated facts are expected; these
// assertions hold only for the flag-off production build.
test.beforeEach(async({},testInfo)=>{test.skip(testInfo.project.name!=='production','Production lane only (flag-off build)');});

const current=(page:Page)=>page.locator('[data-settings-page]:not([inert])').last();
async function snapshot(page:Page){
 return page.evaluate(()=>{
  const pages=[...document.querySelectorAll('[data-settings-page]')].map(e=>e.getAttribute('data-settings-page'));
  const live=[...document.querySelectorAll('[data-settings-page]:not([inert])')].pop() as HTMLElement|undefined;
  const toast=[...document.querySelectorAll('.drop span')].map(e=>e.textContent?.trim()).filter(Boolean).join(' | ');
  const dialogs=[...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],.alpha-connection-scrim')].length;
  return {view:document.documentElement.dataset.activeView||'',pages:pages.join('>'),dialogs,toast,text:(live?.innerText||'').replace(/\s+/g,' ')};
 });
}
async function closeOverlays(page:Page){
 for(let i=0;i<3;i++){
  const open=await page.evaluate(()=>{const d=[...document.querySelectorAll('dialog[open]')] as HTMLDialogElement[];d.forEach(x=>x.close());return d.length;});
  const panel=page.getByRole('button',{name:/^Close connection settings/}).first();
  if(await panel.isVisible().catch(()=>false))await panel.click();
  const google=page.getByRole('button',{name:'Close Google accounts',exact:true});
  if(await google.isVisible().catch(()=>false))await google.click();
  if(!open)break;
 }
}
async function openSettings(page:Page){
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
}
/** Labels whose effect is outside the page and verified by their own suites. */
const external=new Set(['Agent connection','Manage Cloud account','Open Inbox','Scheduled digests','Wipe memory']);

test('production Settings controls act or explain the current Calendar authority guard',async({page})=>{
 page.on('dialog',dialog=>void dialog.dismiss());
 await page.addInitScript(offline);
 const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
 await openSettings(page);
 const top=await current(page).getByRole('button').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||'').filter(Boolean));
 expect(top.length).toBeGreaterThan(8);
 const toastOnly:string[]=[],visited:string[]=[];
 for(const label of top){
  if(external.has(label))continue;
  await openSettings(page);
  const row=current(page).getByRole('button',{name:label,exact:true}).first();
  if(!await row.isVisible())continue;
  // Reset per control, so an earlier download never counts as this control's effect.
  downloads.length=0;
  const before=await snapshot(page);await row.click();await page.waitForTimeout(400);
  const after=await snapshot(page);visited.push(label);
  const effect=after.pages!==before.pages||after.view!==before.view||after.dialogs>before.dialogs||after.text!==before.text||downloads.length>0;
  if(!effect&&after.toast)toastOnly.push(`${label}: ${after.toast}`);
  if(after.pages===before.pages)continue;
  // A subpage opened: exercise each of its controls once from a fresh copy of that page.
  const sub=await current(page).getByRole('button').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||'').filter(Boolean));
  for(const control of sub){
   if(/^Back to /.test(control)||external.has(control))continue;
   await closeOverlays(page);
   if((await snapshot(page)).pages!==after.pages){await openSettings(page);await current(page).getByRole('button',{name:label,exact:true}).first().click();await page.waitForTimeout(300);}
   const target=current(page).getByRole('button',{name:control,exact:true}).first();
   if(!await target.isVisible().catch(()=>false))continue;
   const was=await snapshot(page);downloads.length=0;
   await target.click();await page.waitForTimeout(400);
   const now=await snapshot(page);visited.push(`${label} > ${control}`);
   // Google connection is intentionally refused while the signed-out Calendar
   // has no current owner/source scope. Its successful and interrupted flows are
   // exercised by calendar-sync-settings; this sweep must verify this guard,
   // not treat the expected safety refusal as a dead navigation control.
   if(label==='Calendar'&&control==='Google Calendar'){
    expect(now.toast).toContain('Return to Calendar and finish checking saved events before connecting Google.');
    expect(now.pages).toBe(was.pages);expect(now.dialogs).toBe(was.dialogs);
    continue;
   }
   const changed=now.pages!==was.pages||now.view!==was.view||now.dialogs>was.dialogs||now.text!==was.text||downloads.length>0;
   if(!changed&&now.toast)toastOnly.push(`${label} > ${control}: ${now.toast}`);
  }
 }
 await test.info().attach('visited-controls',{body:visited.join('\n'),contentType:'text/plain'});
 writeFileSync(test.info().outputPath('visited.txt'),visited.join('\n'));
 expect(visited.length).toBeGreaterThan(top.length);
 expect(toastOnly).toEqual([]);
});

/** Rows the Settings cleanup removed or put behind the Developer gate; a product build shows none of them. */
const removedRows:Record<string,RegExp[]>={
 '':[/^Developer$/,/^Try mock mode$/,/^Saved data needs recovery$/,/^Last change$/],
 'About':[/^Update channel \(development\)$/,/^Updates$/,/^Alpha does not check for updates$/,/^Runtime$/],
 'Calendar':[/^Calendar backups$/,/^Display only$/],
 'Connections':[/^Other connectors$/,/^Not available in this version$/,/^Last change$/],
 'Notifications':[/^Delivery timing$/],
 'Voice and agent settings':[/^Personality settings$/,/^Managed by your agent$/,/^Scheduled digests$/],
 'Privacy & data':[/^Workflow runs$/],
};
test('production Settings shows no developer or removed rows, even with ?tools=1',async({page})=>{
 await page.addInitScript(offline);
 for(const query of ['/','/?tools=1','/?mode=dev&tools=1']){
  for(const [label,rows] of Object.entries(removedRows)){
   await page.goto(query);await page.getByRole('button',{name:'Settings',exact:true}).click();
   await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
   if(label){await current(page).getByText(label,{exact:true}).first().click();await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();}
   for(const row of rows)await expect(current(page).getByText(row),`${query} ${label||'Settings'}: ${row}`).toHaveCount(0);
  }
 }
});

test('production Google account entry opens and dismisses its owned dialog',async({page})=>{
 await page.addInitScript(offline);
 await openSettings(page);
 await current(page).getByRole('button',{name:'Accounts',exact:true}).click();
 await current(page).getByRole('button',{name:'Google accounts',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Google accounts',exact:true});
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('button',{name:'Sign in to Eliza Cloud',exact:true})).toBeVisible();
 await expect(panel.getByText('Gmail notification settings',{exact:true})).toHaveCount(0);
 await closeOverlays(page);
 await expect(panel).toHaveCount(0);
 await expect(current(page).getByRole('button',{name:'System accounts',exact:true})).toBeVisible();
});
test('production Settings shows no fixture device facts and reports the model honestly',async({page})=>{
 await page.addInitScript(offline);
 // A browser without the Battery Status API must not show a seeded battery level.
 await page.addInitScript(()=>{Object.defineProperty(Navigator.prototype,'getBattery',{value:undefined,configurable:true});});
 await openSettings(page);
 const all:string[]=[];
 const pages=await current(page).getByRole('button').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||'').filter(Boolean));
 for(const label of ['Wi-Fi','Bluetooth','Mobile data','Battery','Models','Developer','About','Privacy & data'].filter(name=>pages.includes(name))){
  await openSettings(page);await current(page).getByRole('button',{name:label,exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  all.push(`${label}: ${(await current(page).innerText()).replace(/\s+/g,' ')}`);
 }
 const text=all.join('\n');
 expect(text).not.toMatch(/\bNPU\b|Device uptime|\bUptime\b/);
 expect(text).not.toMatch(/\b100%|Charging|Active connection/);
 expect(text).not.toContain('Contacts');
 expect(text).toMatch(/Calendar/);
 expect(text).toMatch(/Inference model\s*Not reported by agent/);
 expect(text).toMatch(/Problem log/);
 expect(text).toMatch(/Export diagnostics/);
 // Browsers have no Android roles: no role rows, and the role API rejects.
 await openSettings(page);
 await expect(current(page).getByText('Home app',{exact:true})).toHaveCount(0);
 // The registered web plugin itself must reject for this reason; a missing plugin is not a pass.
 for(const method of ['getStatus','requestRole'])expect(await page.evaluate(async(method)=>{const plugin=(window as any).Capacitor?.Plugins?.ElizaSystem;if(typeof plugin?.[method]!=='function')return 'missing';try{await plugin[method]({role:'home'});return 'resolved';}catch(error){return error instanceof Error?error.message:'non-error';}},method)).toBe('Device roles are managed by the operating system, not this browser.');
});

test('production Export diagnostics saves redacted JSON',async({page})=>{
 await page.addInitScript(offline);
 // One stored voice latency record, with a transcript field a valid record never has.
 await page.addInitScript(()=>localStorage.setItem('alphaphone:voice-timing:v1',JSON.stringify([{version:1,id:'0b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a5b',recordedAt:1760000000000,route:'eliza-cloud',cold:true,entry:'conversation',policy:'auto-send',marks:{'recording-end':0,'transcript-ready':640,send:640,'first-token':1210,'final-reply':2380},transcript:'Remind me about the dentist'}])));
 await openSettings(page);
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 const download=page.waitForEvent('download');
 await current(page).getByRole('button',{name:'Export diagnostics',exact:true}).click();
 const file=await download;
 expect(file.suggestedFilename()).toMatch(/^alpha-diagnostics-.*\.json$/);
 const text=await (await file.createReadStream()).toArray().then(chunks=>Buffer.concat(chunks).toString('utf8'));
 const report=JSON.parse(text);
 expect(report.format).toBe('alpha-diagnostics/v1');
 expect(report.platform).toBe('web');
 expect(report.app.testMocks).toBe(false);
 expect(report.connection).toEqual({kind:'offline',connected:false});
 expect(Object.keys(report).sort()).toEqual(['app','connection','crashes','format','generatedAt','nativeVoiceTiming','os','permissions','platform','roles','runtimeHashes','upstreamPin','voiceTiming']);
 // The voice timing section is an aggregator-ready document with timing fields only.
 expect(report.voiceTiming.format).toBe('alpha-voice-timing-v1');
 expect(report.voiceTiming.records).toEqual([{version:1,id:'0b0c7a52-6d5e-4e0f-9a43-5c1d2e3f4a5b',recordedAt:1760000000000,route:'eliza-cloud',cold:true,entry:'conversation',policy:'auto-send',marks:{'recording-end':0,'transcript-ready':640,send:640,'first-token':1210,'final-reply':2380}}]);
 expect(text).not.toMatch(/dentist|"transcript"/i);
});
