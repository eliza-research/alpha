import { test, expect, type Page } from '@playwright/test';

const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));
const current = (page: Page) => page.locator('[data-settings-page]:not([inert])').last();

async function openSettings(page:Page){
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
}
test('production Google account entry opens and dismisses its owned dialog',async({page})=>{
 await page.addInitScript(offline);
 await openSettings(page);
 await current(page).getByRole('button',{name:'Google',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Google accounts',exact:true});
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('button',{name:'Sign in to Eliza Cloud',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Close Google accounts',exact:true}).click();
 await expect(panel).toHaveCount(0);
 await expect(current(page).getByRole('button',{name:'Ask before acting',exact:true})).toBeVisible();
});
// Settings holds controls, not device facts Alpha cannot change (docs/ui-refresh-2026-11).
test('production Settings shows no device facts and About keeps its diagnostics',async({page})=>{
 await page.addInitScript(offline);
 await page.addInitScript(()=>{Object.defineProperty(Navigator.prototype,'getBattery',{value:undefined,configurable:true});});
 await openSettings(page);
 const top=(await current(page).innerText()).replace(/\s+/g,' ');
 for(const gone of ['Wi-Fi','Bluetooth','Mobile data','Battery','Sound & vibration','Models','Privacy & data','Voice and agent settings','Developer','Home app'])expect(top).not.toContain(gone);
 expect(top).not.toMatch(/\bNPU\b|Uptime|Inference model|Not reported by agent/);
 for(const label of ['Eliza Cloud','Google','Ask before acting','Agent','Scheduled digests','Calendars','Load images in email','Theme','About'])await expect(current(page).getByRole('button',{name:label,exact:true}).or(current(page).getByText(label,{exact:true})).first()).toBeVisible();
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
 const about=(await current(page).innerText()).replace(/\s+/g,' ');
 expect(about).toMatch(/Problem log/);expect(about).toMatch(/Export diagnostics/);expect(about).toMatch(/Open source licenses/);
 expect(about).not.toMatch(/Updates|Runtime|Agent execution|Inference model/);
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
