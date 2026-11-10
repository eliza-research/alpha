import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {chromium,expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin,repositoryRoot as root,sha256} from '../../../../scripts/quint-lib.mjs';
import {seedCompletedAccessSetup} from '../../../../test/browser/flag-off-android.ts';
import {entitlements,installNativeCloudPlanPorts,USER} from '../../../../test/browser/helpers/native-cloud-plan-fixture.ts';
import {captureInputs,checkTraces,qset} from '../check-traces.mjs';

const driver=fileURLToPath(import.meta.url),product='apps/app/src/runtime/connection-ui.tsx';
const expect=baseExpect.configure({timeout:20000});
const panel=page=>page.locator('[data-alpha-membership-panel]');

async function nativeFixture(page,input){
 const initializers=[],collector={addInitScript:async(fn,arg)=>initializers.push('('+fn.toString()+')('+(JSON.stringify(arg)??'undefined')+');')};
 await seedCompletedAccessSetup(collector);await installNativeCloudPlanPorts(collector,input);
 initializers.push(`(()=>{
  const f=window.accountFixture={mode:'cloud',bound:true,revision:0,keys:{text:'synthetic-text-key',voice:'synthetic-voice-key'},removed:[],authorized:[],owner:0};
  const original=window.Capacitor.nativePromise;
  const status=()=>({mode:f.mode,provider:f.mode==='own'?'cerebras':'elizacloud',configured:f.mode==='own'?!!f.keys.text:f.bound,selected:f.mode==='own',voiceConfigured:f.mode==='own'&&!!f.keys.voice,model:'qwen-3.8-27b',revision:'account-'+f.revision,persistence:'native-secure-store',keys:{text:{configured:!!f.keys.text},voice:{configured:!!f.keys.voice}}});
  const header=window.Capacitor.PluginHeaders.find(p=>p.name==='Agent');
  for(const name of ['prepareProviderConfiguration','cancelProviderConfiguration','selectProvider','removeProviderKey'])header.methods.push({name,rtype:'promise'});
  window.Capacitor.nativePromise=async(plugin,method,input)=>{
   if(plugin==='Agent'){
    if(method==='providerStatus')return status();
    if(method==='prepareProviderConfiguration')return {requestId:'account-selection-lease'};
    if(method==='cancelProviderConfiguration')return {};
    if(method==='selectProvider'){if(input.requestId!=='account-selection-lease'||input.expectedRevision!==status().revision)throw Error('Unreviewed native provider selection');f.mode=input.mode;f.revision++;return status();}
    if(method==='removeProviderKey'){delete f.keys[input.key];f.revision++;return status();}
    if(method==='clearProvider'){f.bound=false;f.revision++;return status();}
    if(method==='configureCloudProvider')f.bound=true;
   }
   const result=await original(plugin,method,input);
   if(plugin==='AlphaConnection'&&method==='secureRemove'&&input.slot==='cloud:production')f.removed.push(0);
   return result;
  };
 })();`);
 return 'const __name=(value,name)=>Object.defineProperty(value,"name",{value:name,configurable:true});\n'+initializers.join('\n');
}

async function observe(page){
 const raw=await page.evaluate(async()=>{
  const c=window.accountController,s=c.getSnapshot(),f=window.accountFixture,local=window.__quintAccountLocal;
  if(s.cloudAccount)f.owner=s.cloudAccount.userId===window.accountOriginalUser?0:1;
  const open=!!document.querySelector('[data-alpha-membership-panel]');
  const documentStore=(await import('/src/browser/documents.ts')).browserDocuments;
  const saved=await documentStore.read('quint-account-retained');
  return {owner:f.owner,open,section:open&&local?.section?'provider':'account',review:open&&local?.review?(local.review.userId===window.accountOriginalUser?0:1):-1,
   mode:s.providerStatus?.mode==='own'?'direct':'cloud',keys:[f.keys.text?0:null,f.keys.voice?1:null].filter(value=>value!==null),
   dataRevision:saved?.raw===window.accountRetainedRaw?1:2,removed:[...new Set(f.removed)],authorized:[...new Set(f.authorized)]};
 });
 return Object.fromEntries(Object.entries(raw).map(([name,value])=>['s.'+name,['keys','removed','authorized'].includes(name)?qset(value):value]));
}

export async function checkAccountSheet(extraSources=[]){
 checkClientFeatures();
 // Discover the repository-owned config import graph without executing it. Vite later
 // executes this same config, including the plugin that can replace mounted documents.
 const configGraph=buildSync({absWorkingDir:root,entryPoints:['vite.config.ts'],bundle:true,write:false,
  metafile:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
 const configInputs=Object.keys(configGraph.metafile.inputs);
 const require=createRequire(import.meta.url),asset=(pkg,path)=>join(dirname(require.resolve(pkg+'/package.json')),path);
 const ocrInputs=[asset('tesseract.js','dist/worker.min.js'),
  ...['lstm','simd-lstm','relaxedsimd-lstm'].map(variant=>asset('tesseract.js-core',`tesseract-core-${variant}.wasm.js`)),
  asset('@tesseract.js-data/eng','4.0.0_best_int/eng.traineddata.gz'),asset('tesseract.js','LICENSE.md'),
  asset('tesseract.js-core','LICENSE'),asset('pdf-lib','LICENSE.md'),'licenses/tessdata-APACHE-2.0.txt'];
 const sources=[...filesWithin(resolve(root,'apps/app/src')),...filesWithin(resolve(root,'.eliza/client-features')),
  ...configInputs,...ocrInputs,'app.config.json','config/pages-native-auth-callbacks.generated.json',
  'android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java','android/app/cloud-deployment.generated.gradle',
  'apps/app/index.html','vite.config.ts','upstream.lock.json','package-lock.json','scripts/prepare-client-features.mjs',
  'test/browser/flag-off-android.ts','test/browser/helpers/native-cloud-plan-fixture.ts',
  'test/browser/helpers/resident-agent-plugin.ts','test/browser/helpers/native-navigation-protocol.ts',
  'specs/quint/refinement/application/index.mjs','test/quint-application-refinement.test.mjs',driver,...extraSources];
 const before=captureInputs(sources),temporary=mkdtempSync(join(tmpdir(),'alpha-account-refinement-'));
 const generated=join(temporary,'connection-observer.tsx'),initializer=join(temporary,'native-initializer.js');
 let server,browser;const prior=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
 try{
  const source=readFileSync(resolve(root,product),'utf8'),marker='  if (!visible) {';
  assert.equal(source.split(marker).length,2,'one read-only Account state observation');
  writeFileSync(generated,source.replace(marker,'  window.__quintAccountLocal={section:accountSection,review:signOutAccount};\n'+marker),{mode:0o600});
  const input={...await entitlements(),holdProvider:false,fullApp:true,cashBalance:100};
  writeFileSync(initializer,await nativeFixture(null,input),{mode:0o600});
  const driverHashes={...before,...captureInputs([generated,initializer])},loaded=new Set();
  process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
  server=await createServer({configFile:resolve(root,'vite.config.ts'),logLevel:'error',
   cacheDir:resolve(root,'test-results/quint-refinement/account-sheet-vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false,watch:null},
   define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},plugins:[{name:'bound-account-observer',enforce:'pre',transform(code,id){
    const path=id.split('?')[0];if(path!==resolve(root,product))return;
    assert.equal(sha256(Buffer.from(code)),driverHashes[path]);loaded.add(path);return {code:readFileSync(generated,'utf8'),map:null};
   }}]});
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true});const traces=[];
  for(const kind of ['navigation','cancel-review','owner-switch','confirmed-sign-out','direct-mode-sign-out']){
   const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(30000);
   const foreign=[];await page.route('**/*',route=>{const u=new URL(route.request().url());
    if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue();foreign.push(u.origin+u.pathname);return route.abort();});
   await page.routeWebSocket(/.*/,socket=>socket.close());await page.addInitScript(readFileSync(initializer,'utf8'));
   try{
    await page.goto(origin+'/');
    await expect.poll(()=>page.evaluate(async()=>{
     const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;
     return !!c.getSnapshot().cloudAccount&&!c.getSnapshot().busy&&!!c.getSnapshot().session;
    }),{timeout:90000}).toBe(true);
    await page.evaluate(async originalUser=>{
     const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;
     window.accountController=c;window.accountOriginalUser=originalUser;
     const original=c.cloudSignOut.bind(c);c.cloudSignOut=async()=>{const user=c.getSnapshot().cloudAccount?.userId;
      window.accountFixture.authorized.push(user===originalUser?0:1);return original();};
     const docs=(await import('/src/browser/documents.ts')).browserDocuments;
     window.accountRetainedRaw='Retained Alpha document bytes';await docs.readOrCreate('quint-account-retained',window.accountRetainedRaw);
    },USER);
    const t={name:kind,init:{name:'init'},expect:await observe(page),steps:[]};
    const mark=async(label,actions)=>t.steps.push({label,action:actions,expect:await observe(page)});
    const show=async()=>{const settings=page.getByRole('button',{name:'Settings',exact:true});if(await settings.isVisible())await settings.click();
     await page.getByRole('button',{name:'Account',exact:true}).filter({visible:true}).click();await expect(panel(page)).toBeVisible();await mark('Actual Settings opens Account',{name:'show'});};
    await show();
    if(kind==='navigation'||kind==='direct-mode-sign-out'){
     await panel(page).getByRole('button',{name:/^AI connection/}).click();await expect(page.getByRole('heading',{name:'AI connection',exact:true})).toBeVisible();
     await mark('Actual Account provider subnavigation',{name:'provider'});
     if(kind==='navigation'){
      await panel(page).getByRole('button',{name:'Back to Account',exact:true}).click();await mark('Actual Back restores Account',{name:'back'});
      await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);await mark('Actual Escape dismisses Account',{name:'close'});
     }else{
      await panel(page).getByRole('button',{name:'Own API keys',exact:true}).click();await expect(panel(page)).toHaveCount(0);
      await expect.poll(()=>page.evaluate(()=>window.accountController.getSnapshot().residentInference)).toBe('direct');
      await mark('Actual reviewed provider selection closes the sheet',[{name:'switchMode'},{name:'close'}]);await show();
     }
    }
    if(kind!=='navigation'){
     await panel(page).getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign out?',exact:true})).toBeVisible();
     await mark('Actual source stores the account being reviewed',{name:'askSignOut'});
     if(kind==='owner-switch'){
      await panel(page).getByRole('button',{name:'Sign out',exact:true}).evaluate(button=>{
       const key=Object.keys(button).find(key=>key.startsWith('__reactProps$'));window.accountRetainedConfirm=button[key].onClick;
      });
      await page.evaluate(()=>{
       const c=window.accountController,get=c.getSnapshot.bind(c);let previous,cached;
       c.getSnapshot=()=>{const next=get();if(next!==previous){previous=next;cached={...next,cloudAccount:next.cloudAccount?{...next.cloudAccount,userId:'foreign-owner',credentialId:'foreign-credential'}:null};}return cached;};
       c.openPlan();
      });
      await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();await mark('Actual identity-dependent effect retires the old review',{name:'switchOwner'});
      await page.evaluate(()=>window.accountRetainedConfirm());await mark('The retained real callback refuses a changed identity',null);
      assert.equal((await page.evaluate(()=>window.accountFixture.authorized)).length,0);
     }else if(kind==='cancel-review'){
      await panel(page).getByRole('button',{name:'Close Account',exact:true}).click();await mark('Header Close cancels the review without signing out',{name:'cancel'});
      await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);await mark('Escape closes the sheet',{name:'close'});
     }else{
      await panel(page).getByRole('button',{name:'Sign out',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.accountController.getSnapshot().cloudAccount)).toBeNull();
      await expect(panel(page)).toHaveCount(0);await mark('Actual guarded controller call removes only the Cloud credential',[{name:'confirm'},{name:'close'}]);
     }
    }
    assert.deepEqual(foreign,[]);traces.push(t);
   }finally{await page.close();}
  }
  assert.ok(loaded.has(resolve(root,product)),'Actual Account renderer source was loaded');
  return await checkTraces({model:'AccountSheet',sources:[...sources,generated,initializer],driverHashes,generatedSources:[generated,initializer],traces,
   scope:'bounded-orchestration',assumptions:[
    'The actual flag-off renderer, Account React state/effects/callbacks, provider selection and sign-out controller execute in Chromium. A read-only source observer reports local review identity; a pass-through controller observer records authorization independently of native credential removal.',
    'Cloud identity, signed entitlement, native credential/provider storage and resident replies are closed synthetic ports. Two saved provider keys and one real browser document bound preservation; this is not native secure-storage, billing, provider, device or cross-domain data qualification.',
    'The owner-switch scenario injects a second verified identity at the presentation snapshot boundary and invokes the retained real confirm callback; it proves that callback fence, not authentication of the replacement identity. Source refresh/credential races and failure during sign-out remain separate obligations.',
   ]});
 }finally{
  await browser?.close();await server?.close();if(prior===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=prior;
  rmSync(temporary,{recursive:true,force:true});
 }
}
