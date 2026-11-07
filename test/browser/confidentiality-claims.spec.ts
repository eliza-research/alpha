import { test, expect } from '@playwright/test';
// Outside labeled mock mode, no screen may assert sealing, attestation or data-locality the build cannot prove.
const forbidden = [/Redaction on/, /Identifiers replaced before/, /\bSealed\b/, /\bAttested\b/i, /attestation (passed|is green)/i, /stays? in the enclave/i, /(never|didn't|did not) le(ft|ave) (the|this|your) (device|phone|chip)/i, /keys in hardware/i, /synced into the enclave/i, /enclave attest/i, /on-device model[^\n]*loaded/i];
const states: Record<string,string[]> = {
  home:[''], inbox:['','mail','compose'], calendar:['','event','new','month','invite','add'],
  browser:['','book','tabs','agent'], camera:['','video','scan'], photos:['','viewer','albums','search'],
  maps:['','search','place','route','nav'], notes:['','editor','rec','voice'], files:['','folder','preview'],
  workflows:['','flow','run','failed','new'], settings:['','character','accounts','privacy','about','models','developer'],
  notifications:[''], reminders:[''],
};
const shell = ['boot','lock','shade','sheet','full','voice','heads'];
const targets = [...Object.entries(states).flatMap(([view,subs])=>subs.map(sub=>view+(sub?':'+sub:''))), ...shell];
for(const mode of ['', 'dev'])for(const view of ['Inbox','Calendar','Browser','Camera','Photos','Maps','Notes','Files','Workflows','Settings'])test(`visible ${mode||'production'} ${view} has no unverified confidentiality claim`,async({page})=>{
 await page.goto(mode?'/?mode=dev':'/');await page.getByRole('button',{name:view,exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view',view.toLowerCase());
 const text=await page.locator('body').innerText();for(const claim of forbidden)expect(text).not.toMatch(claim);
});
for(const mode of ['', 'dev'])for(const tab of ['Privacy & data','About','Models','Developer'])test(`visible ${mode||'production'} Settings ${tab} has no unverified confidentiality claim`,async({page},info)=>{
 // Developer sits behind the one Developer gate: the development server opened with ?tools=1.
 const query=[mode&&'mode=dev',tab==='Developer'&&'tools=1'].filter(Boolean).join('&');
 await page.goto(query?`/?${query}`:'/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:tab,exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 await expect(page.getByText(tab,{exact:true}).last()).toBeVisible();
 const text=await page.locator('body').innerText();for(const claim of forbidden)expect(text).not.toMatch(claim);
 expect(text).not.toContain('Privacy & Enclave');
 if(tab==='Privacy & data'){await expect(page.getByText('No remote agent connected; no hosted inference requests',{exact:true})).toBeVisible();expect(text).not.toContain('Pre-egress redaction is not connected');expect(text).not.toMatch(/Secret and contact identifiers are swapped/);expect(text).not.toMatch(/\b\d+ apps\b|2,418 items|6 today/);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));});await page.screenshot({path:info.outputPath('privacy.png')});}
});
// Mock mode is a labeled design vision; it may show planned redaction features but never sealing or attestation.
const mockForbidden = [/\bSealed\b/, /\bAttested\b/, /attestation passed/i, /stays? in the enclave/i, /keys? never left/i, /keys in hardware/i, /synced into the enclave/i, /enclave attest/i];
for (const start of targets) test(`mock mode shows no sealing or attestation claim: ${start}`, async ({ page }) => {
  await page.goto(`/?mode=mock&start=${start}`);
  await expect(page.locator('.mock-mode-banner')).toBeVisible();
  await page.waitForTimeout(500);
  const text = await page.locator('body').innerText();
  for (const claim of mockForbidden) expect(text, `${start} renders ${claim}`).not.toMatch(claim);
});

