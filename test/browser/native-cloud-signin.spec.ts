import {fenceNetwork,seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
import {entitlements,startNativeCloudSignInFixture,USER} from './helpers/native-cloud-signin.ts';

let composition:Awaited<ReturnType<typeof startNativeCloudSignInFixture>>;
test.beforeAll(async()=>{composition=await startNativeCloudSignInFixture();});
test.afterAll(async()=>{await composition?.close();});
const boot=async(...args:Parameters<typeof composition.boot>)=>{await fenceNetwork(args[0]);return composition.boot(...args);};

type Call={refreshNegative?:boolean;plugin:string;method:string;path?:string;email?:string;phone?:string;environment?:string};
const calls=(page:Page)=>page.evaluate(()=>(window as any).signInFixture.calls as Call[]);
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).planController.getSnapshot());
const fixture=(page:Page)=>page.evaluate(()=>{const f=(window as any).signInFixture;return {saved:f.saved,bound:f.bound,running:f.running};});
async function agent(page:Page,inference:'cloud'|'unavailable'){
 await expect.poll(async()=>{const s=await snapshot(page);return {kind:s.kind,session:!!s.session,inference:s.residentInference};},{timeout:15000}).toEqual({kind:'resident',session:true,inference});
}
async function noHandOff(page:Page){
 const all=await calls(page);
 expect(all.filter(c=>c.method==='openExternal')).toEqual([]);
 expect(all.filter(c=>c.path?.startsWith('/api/auth/cli-session')||c.path?.startsWith('/steward/')||c.path?.startsWith('/api/v1/app-auth/'))).toEqual([]);
}
// The same sign-in surface keeps its identity as its heading changes for codes and legal text.
const signInDialog=(page:Page)=>page.locator('.alpha-cloud-sign-in');
async function readySignIn(page:Page){
 await expect.poll(async()=>(await snapshot(page)).signIn?.step).toBe('choose');
 await expect(signInDialog(page)).toBeVisible();
}

/** Email and text message share one entry; the phone field is one explicit switch away. */
async function usePhone(page:Page){
 const toggle=signInDialog(page).getByRole('button',{name:'Use phone number instead',exact:true});
 if(await toggle.isVisible())await toggle.click();
}

test.describe('in-app Eliza Cloud sign-in on the production Android composition',()=>{
 test('email code sign-in stays in Alpha, retries a wrong code, waits out resend and binds Cloud AI',async({page},info)=>{
  await boot(page,await entitlements());
  await expect(signInDialog(page).getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
  await expect(dialog.getByText(/in your browser/)).toHaveCount(0);
  // Google, then email; text message is one switch away (no "Other sign-in methods" disclosure).
  await expect(dialog.getByRole('button',{name:'Other sign-in methods',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('textbox',{name:'Email',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Use phone number instead',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-choose.png'),animations:'disabled'});
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('not-an-address');await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  expect((await calls(page)).filter(c=>c.method==='startEmail')).toHaveLength(0);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('  synthetic-signin@example.invalid ');
  await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByRole('form',{name:'Enter your email code'})).toBeVisible();
  await expect(dialog.getByText('synthetic-signin@example.invalid',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/^Resend code in \d+s$/})).toBeDisabled();
  expect((await calls(page)).find(c=>c.method==='startEmail')).toMatchObject({email:'synthetic-signin@example.invalid',environment:'production'});
  await dialog.getByLabel('Six-digit code').fill('000000');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('That code didn’t work');
  // A rejected code stays editable for correction; it is never stored as a credential.
  await expect(dialog.getByLabel('Six-digit code')).toHaveValue('000000');
  await expect(dialog.getByLabel('Six-digit code')).toBeFocused();
  expect((await fixture(page)).saved).toBe(false);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-code.png'),animations:'disabled'});
  await dialog.getByLabel('Six-digit code').fill('123 456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await agent(page,'cloud');
  await expect.poll(async()=>(await fixture(page)).bound).toBe(true);
  await expect(signInDialog(page)).toHaveCount(0);
  await noHandOff(page);
  const snap=await snapshot(page);expect(snap.cloudAccount?.userId).toBe(USER);expect(JSON.stringify(snap)).not.toContain('synthetic-mobile-key');
 });

 test('email cooldown starts when the host sends the code, even after time spent entering an address',async({page})=>{
  await page.clock.install();
  await boot(page,await entitlements());
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  // Change wall time without a timer tick: the host's new cooldown must not use panel-mount time.
  const later=await page.evaluate(()=>Date.now()+120000);
  await page.clock.setSystemTime(later);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');
  await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Resend code in 60s',exact:true})).toBeDisabled();
  await page.clock.runFor(60000);
  await expect(dialog.getByRole('button',{name:'Resend code',exact:true})).toBeEnabled();
  await noHandOff(page);
 });

 test('Google readiness can be retried after Android finishes verifying the return link',async({page})=>{
  await boot(page,{...await entitlements(),methods:{email:true,phone:true,google:false}});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  // An unavailable Google entry is not a dead button; a quiet retry re-checks it.
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
  const retry=dialog.getByRole('button',{name:'Retry Google sign-in',exact:true});
  await expect(retry).toBeEnabled();
  await page.evaluate(()=>{(window as any).signInFixture.methods.google=true;});
  await retry.click();
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  expect((await calls(page)).filter(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='status').at(-1)?.refreshNegative).toBe(true);
  await noHandOff(page);
 });

 test('a slow sign-in readiness check keeps the screen white until the chooser is ready',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await boot(page,{...await entitlements(),signIn:'readiness-hold'});
  await agent(page,'unavailable');
  const welcome=signInDialog(page);
  const google=welcome.getByRole('button',{name:'Continue with Google',exact:true});
  await expect(welcome.getByRole('status',{name:'Loading Alpha',exact:true})).toBeVisible();
  await expect(welcome).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(welcome.locator('.alpha-auth-mark')).toHaveCount(0);
  await expect(welcome.getByRole('heading')).toHaveCount(0);
  await expect(welcome.getByText(/Checking.*sign-in/)).toHaveCount(0);
  await expect(google).toHaveCount(0);
  await expect(welcome.getByRole('form',{name:'Sign in with email',exact:true})).toHaveCount(0);
  // The required page's own readiness check is not an attempt the owner started: nothing to go Back from.
  await expect(welcome.getByRole('button',{name:/^(Back|Cancel sign-in)$/})).toHaveCount(0);
  const ownKeys=welcome.getByRole('button',{name:'Use my own API keys',exact:true});
  await expect(ownKeys).toHaveCount(0);
  // The check ends by itself (6 s cap): email stays usable in Alpha, and a late answer adopts Google.
  await expect(welcome.getByRole('button',{name:'Email me a code',exact:true})).toBeEnabled({timeout:10_000});
  const heading=welcome.getByRole('heading',{name:'Welcome to Alpha.',exact:true});
  await expect(heading.locator('..')).toHaveCSS('animation-name','alpha-auth-reveal');
  await expect(welcome.locator('.alpha-auth-brand')).toHaveCSS('animation-name','alpha-auth-reveal');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(heading.locator('..')).toHaveCSS('animation-name','none');
  await expect(ownKeys).toBeEnabled();
  await page.evaluate(()=>(window as any).signInFixture.releaseReadiness());
  await expect(google).toBeEnabled();
  expect((await calls(page)).filter(c=>c.method==='status'&&c.plugin==='AlphaCloudSignIn')).toHaveLength(1);
  await noHandOff(page);
  await agent(page,'unavailable');
 });

 test('a plan ending during readiness still rebinds inference and keeps the requested sign-in screen',async({page})=>{
  await boot(page,{...await entitlements(),keyLifetimeMs:3600000});
  await agent(page,'unavailable');
  await readySignIn(page);
  await signInDialog(page).getByRole('button',{name:'Continue with Google',exact:true}).click();
  await agent(page,'cloud');
  await page.evaluate(()=>{(window as any).signInFixture.signIn='readiness-hold';(window as any).planController.openPlan();});
  await page.getByRole('button',{name:'Approve this phone again',exact:true}).click();
  await expect(page.getByText('Checking Eliza Cloud sign-in…',{exact:true})).toBeVisible();
  await page.evaluate(()=>{(window as any).signInFixture.entitlementStatus='none';(window as any).planController.recheckPlanAfterRefusal();});
  await expect.poll(async()=>(await snapshot(page)).residentPlanNotice).toBe('needs-plan');
  expect((await snapshot(page)).busy).toBe(true);
  await page.evaluate(()=>(window as any).signInFixture.releaseReadiness());
  await agent(page,'unavailable');
  await expect(signInDialog(page)).toBeVisible();
  await expect(signInDialog(page).getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  expect(await fixture(page)).toMatchObject({saved:true,bound:false,running:true});
  expect((await calls(page)).filter(c=>c.method==='startGoogle')).toHaveLength(1);
  await noHandOff(page);
 });

 for(const mode of ['not-ready','readiness-hold'] as const){
  test(`${mode==='not-ready'?'Unavailable':'Timed-out'} readiness keeps email sign-in in Alpha without Google`,async({page})=>{
   if(mode==='readiness-hold')await page.clock.install();
   await boot(page,{...await entitlements(),signIn:mode});
   await agent(page,'unavailable');
   if(mode==='readiness-hold'){
    await expect(page.getByRole('status',{name:'Loading Alpha',exact:true})).toBeVisible();
    await page.clock.runFor(6000);
   }
   await readySignIn(page);
   const dialog=signInDialog(page);
   await expect(dialog).toBeVisible();
   // Google is not offered as a dead button while readiness is unknown; email stays usable.
   await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
   expect(await fixture(page)).toMatchObject({saved:false,bound:false,running:true});
   if(mode==='readiness-hold'){
    // A validated late answer updates only the same still-current chooser (cloud-sign-in-late-readiness).
    await page.evaluate(()=>(window as any).signInFixture.releaseReadiness());
    await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
   }else await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
   await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');
   await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
   await dialog.getByLabel('Six-digit code').fill('123456');
   await dialog.getByRole('button',{name:'Verify',exact:true}).click();
   await agent(page,'cloud');
   expect(await fixture(page)).toMatchObject({saved:true,bound:true,running:true});
   await noHandOff(page);
  });
 }

 test('Continue with Google returns through the native host and an unexpected new account is said out loud',async({page},info)=>{
  await boot(page,{...await entitlements(),signIn:'created'});
  await agent(page,'unavailable');
  await readySignIn(page);
  await signInDialog(page).getByRole('button',{name:'Continue with Google',exact:true}).click();
  await agent(page,'cloud');
  await expect(page.getByText('Account created: synthetic-signin@example.invalid.',{exact:true})).toBeVisible();
  expect((await calls(page)).filter(c=>c.method==='startGoogle').map(c=>c.environment)).toEqual(['production']);
  await noHandOff(page);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-account-created.png'),animations:'disabled'});
 });

 test('cancelling a Google sign-in burns the pending attempt, stores nothing and keeps the agent running',async({page})=>{
  await boot(page,{...await entitlements(),signIn:'hold'});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  await dialog.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Finish in your browser.',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  await expect.poll(async()=>(await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='cancel')).toBe(true);
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  expect(await fixture(page)).toMatchObject({saved:false,bound:false});
  await agent(page,'unavailable');
  // Required sign-in returns to the usable chooser and still cannot be dismissed.
  await expect(dialog.getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await noHandOff(page);
 });

 test('a second verification step is completed in Alpha',async({page},info)=>{
  await boot(page,{...await entitlements(),signIn:'mfa'});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await dialog.getByLabel('Six-digit code').fill('123456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await expect(dialog.getByRole('form',{name:'Enter your verification code'})).toBeVisible();
  await expect(dialog.getByText('Enter your authenticator code.',{exact:true})).toBeVisible();
  await expectButtonSystem(page);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('08-mfa.png'),animations:'disabled'});
  expect((await fixture(page)).saved).toBe(false);
  await dialog.getByLabel('Six-digit code').fill('654321');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await agent(page,'cloud');
  await noHandOff(page);
 });

 test('offline sign-in explains itself and stores nothing',async({page})=>{
  await boot(page,{...await entitlements(),signIn:'offline'});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Alpha could not reach Eliza Cloud');
  await expect(dialog.getByRole('form',{name:'Sign in with email'})).toBeVisible();
  expect(await fixture(page)).toMatchObject({saved:false,bound:false});
  await noHandOff(page);
 });
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));

for (const mode of ['ok','mfa'] as const) test(`phone code stays inside Alpha through ${mode === 'mfa' ? 'MFA' : 'verification'}`,async({page})=>{
 await boot(page,{...await entitlements(),signIn:mode});
 await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await usePhone(page);
 await dialog.getByLabel('Phone number',{exact:true}).fill('+14155550100');
 await dialog.getByRole('button',{name:'Text me a code',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your phone code'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:/Resend code in/})).toBeDisabled();
 await dialog.getByLabel('Six-digit code').fill('000000');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('That code didn’t work');
 // A rejected code stays editable for correction; it is never stored as a credential.
  await expect(dialog.getByLabel('Six-digit code')).toHaveValue('000000');
 expect((await fixture(page)).saved).toBe(false);
 await dialog.getByLabel('Six-digit code').fill('123456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 if(mode==='mfa'){
  await expect(dialog.getByRole('form',{name:'Enter your verification code'})).toBeVisible();
  expect((await fixture(page)).saved).toBe(false);
  await dialog.getByLabel('Six-digit code').fill('654321');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 }
 await agent(page,'cloud');await noHandOff(page);
 expect((await calls(page)).filter(c=>c.method==='startPhone')).toMatchObject([{phone:'+14155550100',environment:'production'}]);
 expect((await calls(page)).filter(c=>c.method==='verifyEmail'||c.method==='startEmail')).toEqual([]);
});

test('phone code cancellation discards the in-app step without a credential',async({page})=>{
 await boot(page,await entitlements());await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await usePhone(page);
 await dialog.getByLabel('Phone number',{exact:true}).fill('+14155550100');
 await dialog.getByRole('button',{name:'Text me a code',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your phone code'})).toBeVisible();
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your phone code'})).toHaveCount(0);
 // Back returns to the phone entry with the number kept, so a typo is a one-field fix.
 await expect(dialog.getByLabel('Phone number',{exact:true})).toHaveValue('+14155550100');
 await expect(dialog.getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
 expect((await fixture(page)).saved).toBe(false);
 expect((await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='cancel')).toBe(true);
 await noHandOff(page);
});

for(const phone of [true,false]) test(`tenant method discovery ${phone?'offers phone without email':'offers no supported method'}`,async({page})=>{
 await boot(page,{...await entitlements(),methods:{phone,email:false,google:false}});await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Email me a code',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Text me a code',exact:true})).toHaveCount(phone?1:0);
 if(!phone)await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
 if(!phone)await expect(dialog.getByText('Sign-in is unavailable.')).toBeVisible();
 expect((await calls(page)).filter(c=>['startPhone','startEmail','startGoogle'].includes(c.method))).toEqual([]);
 await noHandOff(page);
});

test('sign-in has no provider documents or explainer and keeps phone entry and the code attempt',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await boot(page,{...await entitlements(),serviceName:'Example Service'});await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await usePhone(page);
 await expect(dialog.getByRole('button',{name:/Terms of Service|Privacy Policy/})).toHaveCount(0);
 await expect(dialog.locator('details,.alpha-cloud-legal,[role="note"]')).toHaveCount(0);
 await expect(dialog).not.toContainText('Example Service');
 await dialog.getByLabel('Phone number',{exact:true}).fill('+14155550100');
 await dialog.getByRole('button',{name:'Text me a code',exact:true}).click();
 await expect(dialog.getByText(/^Code sent to/)).toContainText('+14155550100');
 await dialog.getByLabel('Six-digit code').fill('123');
 await expect(dialog.getByLabel('Six-digit code')).toHaveValue('123');
 expect((await calls(page)).filter(c=>c.method==='serviceInfo')).toEqual([]);
 expect((await calls(page)).filter(c=>c.method==='startPhone')).toHaveLength(1);
 expect((await calls(page)).filter(c=>c.method==='verifyPhone')).toHaveLength(0);
 await noHandOff(page);
});

/** Every sign-in control on one step uses the shared button system: equal heights and radii for
 * filled and outlined actions, centred labels, and visible space between consecutive controls. */
async function expectButtonSystem(page:Page){
 const boxes=await signInDialog(page).locator('.alpha-auth-methods > *, .alpha-auth-methods form > *, .alpha-own-keys > *, .alpha-own-keys .alpha-form-actions > *, .alpha-cloud-sign-in-code > *').evaluateAll(nodes=>nodes.filter(node=>(node as HTMLElement).offsetParent).map(node=>{const r=node.getBoundingClientRect(),style=getComputedStyle(node);return {tag:node.tagName,cls:node.className,top:r.top,bottom:r.bottom,height:r.height,radius:style.borderRadius,align:style.textAlign,justify:style.justifyContent};}));
 const filled=boxes.filter(box=>/alpha-btn--(primary|secondary)/.test(String(box.cls)));
 expect(filled.length).toBeGreaterThan(0);
 expect(new Set(filled.map(box=>Math.round(box.height))).size,'filled and outlined actions share one height').toBe(1);
 expect(new Set(filled.map(box=>box.radius)).size,'one radius').toBe(1);
 for(const box of filled){expect(box.align).toBe('center');expect(box.justify).toBe('center');}
 const sorted=boxes.filter(box=>box.height>0).sort((a,b)=>a.top-b.top);
 for(let i=1;i<sorted.length;i++)if(sorted[i].top>=sorted[i-1].top+1&&sorted[i].top<sorted[i-1].bottom+1)expect(sorted[i].top-sorted[i-1].bottom,`space above ${sorted[i].cls||sorted[i].tag}`).toBeGreaterThanOrEqual(-0.5);
}
test('sign-in screens keep one button hierarchy and even spacing at each step',async({page},info)=>{
 const shot=async(name:string)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath(`${name}.png`),animations:'disabled'});};
 await boot(page,await entitlements());await agent(page,'unavailable');await readySignIn(page);
 const dialog=signInDialog(page);
 await expectButtonSystem(page);await shot('01-choose');
 await dialog.getByRole('button',{name:'Use phone number instead',exact:true}).click();
 await expect(dialog.getByLabel('Phone number',{exact:true})).toBeFocused();await expectButtonSystem(page);await shot('02-choose-phone');
 await dialog.getByRole('button',{name:'Use email instead',exact:true}).click();
 await dialog.getByRole('button',{name:'Use my own API keys',exact:true}).click();
 await expect(dialog.getByLabel('Text API key',{exact:true})).toBeFocused();await expectButtonSystem(page);await shot('03-own-keys');
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');
 await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your email code'})).toBeVisible();await expectButtonSystem(page);await shot('04-code');
 await dialog.getByLabel('Six-digit code').fill('000000');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('That code didn’t work');await shot('05-code-wrong');
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 await expect(dialog.getByRole('textbox',{name:'Email',exact:true})).toHaveValue('synthetic-signin@example.invalid');await shot('06-back-address-kept');
 await noHandOff(page);
});
test('Google waiting: one heading, a way to reopen the Google page, and Back',async({page},info)=>{
 const shot=async(name:string)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath(`${name}.png`),animations:'disabled'});};
 await boot(page,{...await entitlements(),signIn:'hold'});await agent(page,'unavailable');await readySignIn(page);
 const dialog=signInDialog(page);
 await dialog.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Finish in your browser.',exact:true})).toBeVisible();
 await expect(dialog.getByRole('button')).toHaveText(['Open Google again','Back']);await expectButtonSystem(page);await shot('07-google-waiting');
 // A closed Custom Tab is not a dead end: the waiting attempt is cancelled and a fresh one opens.
 await dialog.getByRole('button',{name:'Open Google again',exact:true}).click();
 await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='startGoogle').length).toBe(2);
 expect((await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='cancel')).toBe(true);
 await expect(dialog.getByRole('heading',{name:'Finish in your browser.',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
});
