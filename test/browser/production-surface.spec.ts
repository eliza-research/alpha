import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {seedCompletedAccessSetup} from './flag-off-android';
import {completeAccessSetup, openYourAgent} from './flag-off-android';
import { test, expect, type Page } from '@playwright/test';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FORBIDDEN_ENGINE_PATH, engineFindings } from '../../scripts/audit-production-bundle.mjs';
import { openLegacyNotes } from './helpers/legacy-notes';
// Runs only in the `production` project: a flag-off `vite build` served by `vite preview`.
// It proves the shipped web bundle exposes no mock, fixture or developer surface.
// It does not prove Android packaging, which is audited separately per APK.

const fixtureNames = ['Maya Chen', 'Jordan Park', 'Priya Nair', 'Alex Kim', 'Ritual Coffee', 'Design review at', 'Unlock for details', 'you@gmail.example'];
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

async function trackCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', message => { if (/Content Security Policy|Refused to (load|execute|connect|create|apply|frame)/i.test(message.text())) violations.push(message.text()); });
  await page.addInitScript(() => {
    (window as any).cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => (window as any).cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return async () => [...violations, ...await page.evaluate(() => (window as any).cspViolations as string[])];
}

// Owner rule: speech runs only on the native libelizainference stack (on the phone, or the local
// agent on a computer). The built web bundle carries no speech model, worker or inference runtime.
test('the built bundle ships no in-browser speech engine, model or inference runtime', async ({ request }) => {
  const dir = path.resolve('test-results/production-web');
  const walk = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(current, entry.name)) : [path.relative(dir, path.join(current, entry.name)).split(path.sep).join('/')]);
  const files = walk(dir);
  expect(files.length).toBeGreaterThan(10);
  expect(files.filter(file => file.startsWith('browser-speech/'))).toEqual([]);
  const findings = files.flatMap(file => engineFindings(file, /\.(?:html?|js|mjs|css|json|txt)$/i.test(file) ? readFileSync(path.join(dir, file), 'utf8') : undefined));
  expect(findings).toEqual([]);
  // The removed model manifest is not served (the preview's SPA fallback answers with HTML, never JSON).
  const manifest = await request.get('/browser-speech/manifest.json');
  expect(manifest.headers()['content-type'] ?? '').not.toContain('application/json');
});

test('the bundle records production flags and ships a CSP', async ({ page, request }) => {
  expect(await (await request.get('/build-flags.json')).json()).toEqual({ testMocks: false });
  await page.goto('/?tools=1');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  for (const directive of ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "object-src 'none'", "base-uri 'none'"]) expect(policy).toContain(directive);
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});

for (const entry of ['/?mode=mock', '/?fixture=1&start=inbox', '/?mode=dev&start=wallet', '/?mode=dev&workflows=agent&start=workflows&theme=dark']) {
  test(`entry point ${entry} renders the live product`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(offline);
    await page.goto(entry);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
    await expect(page.locator('.alpha-dev-tools')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Device controls', exact: true })).toHaveCount(0);
    await expect(page.getByText(/mock mode/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('a stored mock selection on Android reads as the resident (P-43) and never enters mock mode', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any; w.androidBridge = {};
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'mock' })); }
    const calls: string[] = w.nativeCalls = [];
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaConnection', methods: methods(['pauseNotificationCollection', 'secureRead', 'secureWrite', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener']) },
        { name: 'AlphaHostedResults', methods: methods(['disableBackground', 'status', 'pendingResult', 'addListener', 'removeListener']) },
        { name: 'AlphaNotifications', methods: methods(['resumeCrossApp', 'status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'Agent', methods: methods(['getStatus']) }, { name: 'ElizaSystem', methods: methods(['getBuildInfo']) },
      ],
      nativePromise: async (plugin: string, method: string) => {
        calls.push(`${plugin}.${method}`);
        if (plugin === 'Agent') return { packaged: false, state: 'unavailable' };
        if (method === 'secureRead') return { value: null };
        if (plugin === 'ElizaSystem' && method === 'getBuildInfo') return { launcher: false, version: 'production-surface' };
        return {};
      },
    };
  });
  await page.goto('/?tools=1');
  const chooser = page.locator('.alpha-connection');
  // P-43: the resident is the selection (this stub has no packaged runtime). Signed out, the
  // Eliza Cloud sign-in dialog opens; no chooser, mock or pairing surface does.
  await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toBeVisible();
  await expect(chooser.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(chooser.getByText(/Mock mode|Pairing code|Remote agent/)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({ kind: 'resident' });
  const calls: string[] = await page.evaluate(() => (window as any).nativeCalls);
  // Neither the mock barrier nor any collector resume runs without an explicit choice.
  for (const call of ['AlphaConnection.pauseNotificationCollection', 'AlphaNotifications.resumeCrossApp']) expect(calls).not.toContain(call);
  await expect(page.getByText(/mock mode/i)).toHaveCount(0);
  await expect(page.getByText('Local development agent', { exact: true })).toHaveCount(0);
  await page.reload();
  // After a restart the resident is still the selection and only the sign-in dialog opens.
  await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toBeVisible();
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
});

test('the chooser and Settings offer only production connections', async ({ page }) => {
  await page.goto('/?tools=1');
  const chooser = page.locator('.alpha-connection');
  // The browser build explains its real options on first run.
  await expect(chooser.getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
  for (const summary of await chooser.locator('summary').all()) await summary.click();
  const text = await chooser.innerText();
  expect(text).not.toMatch(/mock mode/i);
  expect(text).not.toContain('Local development agent');
  expect(text).not.toMatch(/staging/i);
  expect(text).not.toContain('Development connections');
  await expect(chooser.getByLabel('Environment')).toHaveCount(0);
  await expect(chooser.getByRole('button', { name: 'Start local agent', exact: true })).toHaveCount(0);
  for (const name of ['Connect remote agent', 'Manage Cloud account']) await expect(chooser.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(chooser.getByRole('button',{name:'Open local apps',exact:true})).toBeVisible();
  // P-43: the web preview offers no offline mode by that name.
  await expect(chooser.getByRole('button', { name: 'Continue offline', exact: true })).toHaveCount(0);
  // Eliza Cloud refuses credentialed requests from this web origin, so no sign-in that always fails is offered.
  await expect(chooser.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toHaveCount(0);

  await chooser.getByRole('button', { name: 'Open local apps', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('[data-screen]');
  await expect(settings.getByText('Agent connection', { exact: true })).toBeVisible();
  const settingsText = await settings.innerText();
  expect(settingsText).not.toMatch(/mock mode/i);
  expect(settingsText).not.toMatch(/staging/i);
  await page.getByText('About', { exact: true }).click();
  // The About header names the web runtime; there is no separate Runtime row.
  await expect(settings.getByText('Web browser', { exact: true }).first()).toBeVisible();
  await expect(settings.getByText('Runtime', { exact: true })).toHaveCount(0);
  await expect(settings.getByText('Web app', { exact: true })).toHaveCount(0);
  await expect(settings.getByText('Development preview', { exact: true })).toHaveCount(0);
  await expect(settings.getByText(/^\d+\.\d+\.\d+/).first()).toBeVisible();
  await settings.getByText('Open source licenses', { exact: true }).click();
  await expect(settings.getByText('Open source licenses', { exact: true }).first()).toBeVisible();
  // Either the generated notices or the honest fallback, never an empty page.
  await expect(settings.getByText(/License notices unavailable|MIT|Apache|BSD|ISC|MPL/).first()).toBeVisible();
});

test('Settings shows the flags and obligations of flagged license entries, and nothing extra on unflagged ones', async ({ page }) => {
  const notices = [
    { name: 'plain-package', version: '1.0.0', license: 'MIT', source: 'https://example.test/plain', text: 'MIT terms', flags: [] },
    { name: 'copyleft-package', version: '2.0.0', license: 'AGPL-3.0-or-later', source: 'https://example.test/copyleft', text: 'AGPL terms',
      flags: ['copyleft-strong', 'network-copyleft', 'future-flag'],
      obligations: [{ flag: 'copyleft-strong', note: 'Corresponding source must be available at https://example.test/copyleft.' }, { flag: 'network-copyleft', note: 'The source offer extends to network use.' }] },
    { name: 'legacy-entry', version: '3.0.0', license: 'ISC', source: 'https://example.test/legacy', text: 'ISC terms' },
  ];
  await page.route('**/licenses/third-party-notices.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(notices) }));
  await page.goto('/?tools=1');
  await page.locator('.alpha-connection').getByRole('button', { name: 'Open local apps', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('[data-screen]');
  await page.getByText('About', { exact: true }).click();
  await settings.getByText('Open source licenses', { exact: true }).click();
  await expect(settings.getByText('copyleft-package', { exact: true })).toBeVisible();
  // Known flags are labelled; a flag this build does not know is shown as written, never dropped.
  await expect(settings.getByText('Copyleft (GPL family) · Network copyleft (AGPL) · future-flag', { exact: true })).toBeVisible();
  await expect(settings.getByText('Corresponding source must be available at https://example.test/copyleft.', { exact: true })).toBeVisible();
  await expect(settings.getByText('The source offer extends to network use.', { exact: true })).toBeVisible();
  // One flagged entry only: unflagged and pre-flag entries get no flag row.
  await expect(settings.getByText('Flagged', { exact: true })).toHaveCount(1);
  await expect(settings.getByText('Obligation', { exact: true })).toHaveCount(2);
  await expect(settings.getByText('plain-package', { exact: true })).toBeVisible();
  await expect(settings.getByText('legacy-entry', { exact: true })).toBeVisible();
});

test('Settings keeps the unavailable fallback when the license notices cannot be read', async ({ page }) => {
  await page.route('**/licenses/third-party-notices.json', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?tools=1');
  await page.locator('.alpha-connection').getByRole('button', { name: 'Open local apps', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('[data-screen]');
  await page.getByText('About', { exact: true }).click();
  await settings.getByText('Open source licenses', { exact: true }).click();
  await expect(settings.getByText('License notices unavailable', { exact: true })).toBeVisible();
  await expect(settings.getByText('Flagged', { exact: true })).toHaveCount(0);
});

test('deferred apps are absent and root views show honest unconnected states', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}}));
  await page.addInitScript(offline);
  await page.goto('/?tools=1');
  for (const deferred of ['Phone', 'Messages', 'Contacts', 'Wallet']) await expect(page.getByRole('button', { name: deferred, exact: true })).toHaveCount(0);
  const states: Record<string, RegExp> = {
    Inbox: /Connect Eliza Cloud/, Workflows: /Your agent runs on your phone, not here\. Open Alpha on your Android phone to use it\. Reminders on this phone stay available\./, Notes: /Notes is unavailable for this agent connection\. Check Settings › Agent connection\./,
    Photos: /No photos/, Maps: /Add a location/, Calendar: /\d/, Files: /Choose a document/, Settings: /Agent connection/,
  };
  for (const [view, expected] of Object.entries(states)) {
    await page.goto('/?tools=1');
    await page.getByRole('button', { name: view, exact: true }).and(page.locator('[data-mobile-shell-tile]')).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', view.toLowerCase());
    await expect(page.locator('[data-screen]')).toContainText(expected);
    const text = await page.locator('body').innerText();
    for (const name of fixtureNames) expect(text, `${view} shows fixture ${name}`).not.toContain(name);
  }
});

test('sending chat without a connection opens the chooser', async ({ page }) => {
  await page.goto('/?tools=1');
  const chooser = page.locator('.alpha-connection');
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
  await input.fill('What is on my calendar today?');
  await input.press('Enter');
  await expect(chooser).toBeVisible();
  await expect(page.getByText(/Development reply|emulator development agent/)).toHaveCount(0);
});

test('the CSP admits Home, Notes, Maps, Scan and PDF without violations', async ({ page }) => {
  test.setTimeout(120_000);
  const violations = await trackCsp(page);
  await page.addInitScript(offline);
  await page.addInitScript(() => {
    // Synthetic camera: a canvas stream with one line of text. Capture, scan review, OCR and PDF are the shipped code.
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600; const context = canvas.getContext('2d')!;
    const paint = () => { context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 600); context.fillStyle = 'black'; context.font = '60px Arial'; context.fillText('Alpha searchable document', 50, 120); };
    paint(); setInterval(paint, 50);
    const devices = navigator.mediaDevices; devices.getUserMedia = async () => canvas.captureStream(20); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
  });
  await page.goto('/?tools=1');
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  await openLegacyNotes(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('CSP note');
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open CSP note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await page.getByRole('button', { name: 'Maps', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect.poll(() => page.locator('[aria-label^="Viewfinder."] video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  // Scanning is reached by asking Alpha in Camera: one frame opens scan review, which builds the PDF.
  const scan = async () => {
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    const input = page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
    await input.fill('Scan this'); await input.press('Enter');
    await page.getByRole('button', { name: 'Build multi-page PDF', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Document page 1', exact: true })).toBeVisible();
  };
  await scan();
  const imagePdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download document PDF', exact: true }).click();
  expect((await imagePdf).suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole('button', { name: 'Close scan', exact: true }).or(page.getByRole('button', { name: /^Close/ }).last()).click();
  await page.getByRole('button', { name: 'Cancel scan', exact: true }).click();
  await scan();
  await page.getByRole('button', { name: 'Download searchable PDF', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review searchable PDF' });
  // Local OCR runs in a worker with WebAssembly: the policy must admit both.
  await expect(review.getByLabel('Page 1 line 1', { exact: true })).toHaveValue(/Alpha searchable/, { timeout: 90_000 });
  const searchable = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download reviewed searchable PDF', exact: true }).click();
  expect((await searchable).suggestedFilename()).toMatch(/\.pdf$/);
  expect(await violations()).toEqual([]);
});

test('production ignores the development render-failure hook', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/?tools=1');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
  await settings.click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agent connection', exact: true })).toBeVisible();
});

// Production speech is device-only (owner rule): the browser build has no on-device engine, so the
// Notes recorder records audio only, and no Cloud or network voice route is offered.
test('production signed-out voice stays on-device with no upload, engine or Cloud route under the shipped CSP', async ({ page }) => {
  const violations = await trackCsp(page);
  const foreign: string[] = [], uploads: string[] = [], engines: string[] = [];
  // Stop a regression before it can contact a provider or upload anything.
  await page.route('**/*', async route => {
    const request=route.request(),url=new URL(request.url());
    if (!['127.0.0.1','localhost'].includes(url.hostname) && !['data:','blob:'].includes(url.protocol)) { foreign.push(request.url()); await route.abort(); return; }
    if (['POST','PUT','PATCH'].includes(request.method())) { uploads.push(request.url()); await route.abort(); return; }
    if (FORBIDDEN_ENGINE_PATH.test(url.pathname) || /\.wasm$/.test(url.pathname)) engines.push(url.pathname);
    await route.continue();
  });
  await page.addInitScript(offline);
  await page.addInitScript(() => {
    const counts=(window as any).voiceGate={microphone:0,recorders:0,audio:0,workers:0,playback:0};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{counts.microphone++;throw Error('Unsigned voice must not capture');}}});
    for(const [name,key] of [['MediaRecorder','recorders'],['OfflineAudioContext','audio'],['Worker','workers']] as const){
      const Original=(window as any)[name];
      if(Original)Object.defineProperty(window,name,{configurable:true,value:new Proxy(Original,{construct(){counts[key]++;throw Error('Unsigned voice must not start a local engine');}})});
    }
    // Clock primes an alert context on user gestures independently of voice.
    // Keep that inert while counting any capture, decode or synthesis processing.
    const processing=()=>{counts.audio++;throw Error('Unsigned voice must not process audio');};
    Object.defineProperty(window,'AudioContext',{configurable:true,value:class {
      state='suspended';resume=async()=>{};close=async()=>{};
      createMediaStreamSource=processing;createMediaStreamDestination=processing;
      createBufferSource=processing;decodeAudioData=processing;createOscillator=processing;
    }});
    if(window.speechSynthesis)window.speechSynthesis.speak=()=>{counts.playback++;throw Error('Unsigned voice must not synthesize speech');};
    HTMLMediaElement.prototype.play=async function(){counts.playback++;throw Error('Unsigned voice must not play audio');};
  });
  await page.goto('/');
  await openLegacyNotes(page);
  await page.getByRole('button', { name: 'Record and transcribe', exact: true }).click();
  // The recorder asks for the microphone at once (refused here) and shows one line; no route choice exists.
  const recorder=page.locator('[data-alpha-subview="notes-recorder"]');
  await expect(recorder).toHaveAttribute('data-recorder-state','failed');
  await expect(recorder.getByRole('alert')).toHaveText('The microphone isn’t available.');
  for(const name of ['Connect Eliza Cloud','Transcribe with Eliza Cloud','Start recording','Record without transcription','Use development voice','Use browser voice','Use on-device voice','Transcribe on this device','Type transcript instead'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(page.getByText(/Sign in to|Record up to|Nothing is uploaded/)).toHaveCount(0);
  await recorder.getByRole('button',{name:'Discard recording',exact:true}).click();
  await expect(recorder).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).voiceGate)).toEqual({microphone:1,recorders:0,audio:0,workers:0,playback:0});
  expect(uploads).toEqual([]);expect(engines).toEqual([]);expect(foreign).toEqual([]);
  expect(await violations()).toEqual([]);
});
for (const mode of ['signed-out','empty','credits','unavailable','funded','replaced','unpackaged','legacy-offline'] as const) {
 test(`resident always present (P-43), Cloud admission only binds inference: ${mode}`,async({page})=>{
  await installResidentAgentPlugin(page);
  await page.addInitScript(mode=>{
   const w=window as any;w.androidBridge={};w.residentCalls=[];
   const id='9f1dc45a-4011-4e44-947a-30d999d24fa5';
   const resident=w.residentAgent=w.createResidentAgentPlugin({owner:()=>id,agentId:id});
   const values:Record<string,string>={};let credentialReads=0;
   // An older build's "Use local apps without AI" choice.
   if(mode==='legacy-offline')localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline',localApps:true}));
   if(mode!=='signed-out'&&mode!=='unpackaged'&&mode!=='legacy-offline')values['cloud:production']=JSON.stringify({token:'synthetic-cloud-key',credentialId:id,expiresAt:Date.now()+60000});
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[
    {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
    {name:'Agent',methods:resident.methods(['getStatus','start','stop','configureCloudProvider','clearProvider','providerStatus','request'])},
    {name:'AlphaCloudSignIn',methods:methods(['status'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureRemove','secureCompareExchange','request','cancel','openExternal'])},
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
   ],nativeCallback:resident.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
    w.residentCalls.push({plugin,method,path:input?.path,url:input?.url});
    if(plugin==='AlphaCloudSignIn'&&method==='status')return{active:false,inApp:true,email:true,google:false};
    if(plugin==='ElizaSystem'&&method==='getBuildInfo')return{launcher:false,version:'billing-fixture'};
    if(plugin==='AlphaNotifications')return{permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud')return{microphone:'granted'};
    if(plugin==='Agent'){
     const owned=resident.answer(method,input);if(owned)return owned;
     if(method==='getStatus')return{packaged:mode!=='unpackaged',state:'stopped',serviceActive:false,socketListening:false};
     if(method==='clearProvider')return{configured:false};
     if(method==='providerStatus')return{provider:'elizacloud',configured:false};
     if(method==='request'){
      const body=input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:
       input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:
       input.path==='/api/conversations'?{conversations:[]}:{};
      return {status:200,body:JSON.stringify(body)};
     }
     return {};
    }
    if(method==='secureRead'){if(input.slot==='cloud:production'&&++credentialReads===5&&mode==='replaced')values[input.slot]=JSON.stringify({token:'synthetic-replacement-key',credentialId:'f04d4d24-6978-42a2-a968-995d76debf77',expiresAt:Date.now()+60000});return{value:values[input.slot]??null};}
    if(method==='secureWrite'){values[input.slot]=input.value;return{};}
    if(method==='secureRemove'){delete values[input.slot];return{};}
    if(method==='request'){
     const path=new URL(input.url).pathname;
     if(path==='/api/v1/user')return{status:200,data:{success:true,data:{id}}};
     if(path==='/api/v1/subscription/entitlement')return { status: 404, data: {} }; // Entitlement route absent: the billing snapshot answers.
     if(path==='/api/v1/billing/limits')return mode==='unavailable'?{status:503,data:{error:'temporary'}}:{status:200,data:{success:true,data:{v2:{subscription:mode==='funded'||mode==='replaced'?{status:'available',value:{planKey:'plus_monthly',state:'active',currentPeriodEnd:'2099-01-01T00:00:00.000Z'}}:{status:'not_applicable',reason:mode==='credits'?'no_organization_subscription':'subscription_not_active'}}}}};
     throw Error('Unexpected Cloud route: '+path);
    }
    return {};
   }};
  },mode);
  await page.goto('/');
  // P-43: the resident starts at every app start; sign-in and plan state never withhold it.
  const agentCalls=async()=>((await page.evaluate(()=>(window as any).residentCalls)) as any[]).filter(c=>c.plugin==='Agent').map(c=>c.method);
  if(mode!=='unpackaged')await expect.poll(agentCalls).toContain('start');
  // Signed-in first use offers optional access; complete its real skip before the account checks.
  if(mode==='empty'||mode==='unavailable'||mode==='credits'||mode==='funded'||mode==='replaced')await completeAccessSetup(page);
  for(const retired of ['without AI','Continue offline','Connect an agent'])expect(await page.locator('body').innerText()).not.toContain(retired);
  // Every Alpha Phone needs an Eliza Cloud account for AI: signed out, the sign-in dialog opens
  // by itself and cannot be dismissed. Without an admissible plan a non-blocking notice beside the
  // running agent offers Redeem code and Choose a plan; its Redeem code opens the plan panel. A
  // sign-in that changed underneath admission is reported in the dialog. Otherwise nothing opens.
  // On the phone's own agent that plan panel is the resident account & plan panel; it carries the
  // approved Subscription controls, opened at the code field.
  const signedOut=mode==='signed-out'||mode==='legacy-offline'||mode==='unpackaged',needsPlan=mode==='empty'||mode==='unavailable';
  const dialog=signedOut?page.locator('[role="main"].alpha-cloud-sign-in'):needsPlan?page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true}):page.getByRole('region',{name:'Settings',exact:true});
  if(needsPlan){
   const notice=page.getByRole('region',{name:'Eliza Cloud plan notice'});
   await expect(notice).toContainText('Your agent is running on this device. AI replies aren’t available right now');
   await expect(page.getByRole('dialog')).toHaveCount(0);
   await expect(notice.getByRole('button',{name:'Choose a plan',exact:true})).toBeVisible();
   await notice.getByRole('button',{name:'Redeem code',exact:true}).click();
  }
  if(!signedOut&&!needsPlan){
   await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
   // A sign-in replaced underneath admission is not a refused sign-in: the account stays attached
   // and the required sign-in page never covers the running resident's Home.
   if(mode==='replaced')await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toHaveCount(0);
   await expect(page.getByRole('dialog')).toHaveCount(0);
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   if(mode==='replaced')await page.getByRole('button',{name:'Agent connection',exact:true}).click();
   else await openCloudPlanFromSettings(page);
  }
  await expect(dialog).toBeVisible();
  if(mode==='unpackaged'){
   // A developer build without the runtime says so and offers Retry; it never offers an offline mode.
   await expect(dialog.getByRole('button',{name:'Email me a code',exact:true})).toBeVisible();
   await expect(dialog.getByRole('status').filter({hasText:'This developer build does not include the on-device agent.'})).toHaveText('This developer build does not include the on-device agent.');
  }else if(needsPlan)await expect(dialog.getByRole('region',{name:'Subscription',exact:true})).toBeVisible();
  else if(!signedOut&&mode!=='replaced')await expect(dialog.getByText('On this device',{exact:true})).toBeVisible();
  if(signedOut){
   await expect(dialog.getByText(/Sign in to verify your account|review access/)).toHaveCount(0);
   await expect(dialog.getByRole('button',{name:'Email me a code',exact:true})).toBeVisible();
   await expect(dialog.getByRole('button',{name:'Close connection settings',exact:true})).toHaveCount(0);
   await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  }
  // No admissible plan (none, or one Cloud cannot confirm): Redeem code and Choose a plan beside the
  // running agent; nothing is bound. Cloud refuses AI requests without a plan.
  const admitted=mode==='funded'||mode==='credits';
  if(needsPlan){
   await expect(dialog.getByRole('textbox',{name:'Membership code',exact:true})).toBeFocused();
   await expect(dialog.getByRole('button',{name:'Redeem',exact:true})).toBeVisible();
   await expect(dialog.getByRole('button',{name:mode==='empty'?'Choose a monthly plan':'Manage subscription',exact:true})).toBeVisible();
   // The subscription component owns the single plan summary; the host never repeats it.
   await expect(dialog.getByRole('region',{name:'Eliza Cloud plan',exact:true})).toHaveCount(0);
   await expect(dialog.getByRole('region',{name:'Subscription',exact:true}).getByText(mode==='empty'?'No active subscription':'Subscription not confirmed',{exact:true})).toHaveCount(1);
   await expect(dialog).not.toContainText(/Available credits|Add credits|\$\d/);
  }
  if(mode==='replaced')await expect(dialog.getByText(/account changed/i)).toBeVisible();
  if(admitted)await expect(dialog.getByRole('button',{name:'Sign out of Eliza Cloud',exact:true})).toBeVisible();
  // Legacy credit admission keeps the subscription and membership-code options visible.
  if(mode==='credits'){await expect(dialog.getByText('No active subscription',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Redeem code',exact:true})).toBeVisible();}
  for(const retired of ['Use local apps without AI','Continue offline'])await expect(dialog.getByRole('button',{name:retired,exact:true})).toHaveCount(0);
  // Every dialog but the required sign-in closes; the agent keeps running.
  if(needsPlan){await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);}else if(!signedOut){await dialog.getByRole('button',{name:'Back to Settings',exact:true}).click();}
  if(mode==='legacy-offline'||mode==='signed-out')expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({kind:'resident'});
  const calls=await page.evaluate(()=>(window as any).residentCalls);
  expect(calls.some((c:any)=>c.url?.includes('/personal/')||c.url?.includes('/upgrade-tier')||c.url?.includes('/credits/'))).toBe(false);
  const native=await agentCalls();
  // Inference is bound only when Cloud admits the plan; the agent runs either way.
  if(admitted){expect(native.indexOf('stop')).toBeLessThan(native.indexOf('configureCloudProvider'));expect(native.indexOf('configureCloudProvider')).toBeLessThan(native.lastIndexOf('start'));}
  else if(mode!=='replaced')expect(native).not.toContain('configureCloudProvider');
  if(mode==='unpackaged')expect(native).not.toContain('start');
 });
}
test('resident always present (P-43): a kept local-apps choice and a saved sign-in with no network start the resident, AI off with no Cloud notice',async({page})=>{
 await installResidentAgentPlugin(page);
 await page.addInitScript(()=>{
  const w=window as any;w.androidBridge={};w.residentCalls=[];
  const id='9f1dc45a-4011-4e44-947a-30d999d24fa5';
  const resident=w.residentAgent=w.createResidentAgentPlugin({owner:()=>id,agentId:id});
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline',localApps:true}));
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[
   {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
   {name:'Agent',methods:resident.methods(['getStatus','start','stop','clearProvider','providerStatus','request'])},
   {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureRemove','secureCompareExchange','request','cancel','openExternal'])},
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
  ],nativeCallback:resident.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
   w.residentCalls.push({plugin,method,slot:input?.slot,url:input?.url});
   if(plugin==='Agent'){const owned=resident.answer(method,input);if(owned)return owned;}
   if(plugin==='AlphaVoiceCloud')return{microphone:'granted'};
   if(plugin==='ElizaSystem'&&method==='getBuildInfo')return{launcher:false,version:'resident-fixture'};
   if(plugin==='AlphaNotifications')return{permissionGranted:true,appEnabled:true};
   if(plugin==='Agent'&&method==='getStatus')return{packaged:true,state:'stopped',serviceActive:false,socketListening:false};
   if(plugin==='Agent'&&method==='clearProvider')return{configured:false};
   if(plugin==='Agent'&&method==='providerStatus')return{provider:'elizacloud',configured:false};
   if(plugin==='Agent'&&method==='request'){
    const body=input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:input.path==='/api/conversations'?{conversations:[]}:{};
    return {status:200,body:JSON.stringify(body)};
   }
   if(method==='secureRead')return{value:input?.slot==='cloud:production'?JSON.stringify({token:'synthetic-cloud-token',credentialId:'synthetic-credential'}):null};
   // Network is off: every Cloud request fails.
   if(plugin==='AlphaConnection'&&method==='request')throw Error('Connection request failed');
   return {};
  }};
 });
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
 await expect.poll(async()=>((await page.evaluate(()=>(window as any).residentCalls)) as any[]).filter(c=>c.plugin==='Agent').map(c=>c.method)).toContain('start');
 await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toHaveCount(0);
 // Owner, 2026-11-03: Cloud being unreachable shows no banner or status text, and asks for no sign-in.
 const settings=await openYourAgent(page);
 await expect(settings).toContainText('Running on this device');
 await expect(settings).not.toContainText('Sign in required');
 await expect(page.getByRole('region',{name:'Eliza Cloud plan notice',exact:true})).toHaveCount(0);
 await expect(page.getByText(/Cloud cannot be reached/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({kind:'resident'});
 const calls=await page.evaluate(()=>(window as any).residentCalls);
 expect(calls.filter((c:any)=>c.plugin==='Agent').map((c:any)=>c.method)).not.toContain('configureCloudProvider');
});


// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
