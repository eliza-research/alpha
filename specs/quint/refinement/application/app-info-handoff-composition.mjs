import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {checkTraces, qset} from '../check-traces.mjs';
import {withAppInfoSource} from '../native/app-info-handoff.mjs';
import {directory, javaTraces} from '../native/java.mjs';
import {compileDrawerInteraction} from './drawer-interaction.mjs';
import {call, checkpoint, root, trace} from './support.mjs';

const model = 'AppInfoHandoffComposition';
const probe = 'AppInfoHandoffProbe.java';
const preparedReceipt = '.eliza/client-features/.source.json';
const noTarget = {packageName:'', activityName:'', user:''};
const noReply = {resolved:false, code:'', message:'', queryPackage:'', queryUser:-1, queryFlags:0,
  launchUser:-1, intentAction:'', intentFlags:0, target:'', opened:false};

const open = ['openDrawer'], close = ['closeDrawer'], personalMenu = ['openMenu',1], workMenu = ['openMenu',2];
const request = ['requestAppInfo'], dispatch = ['dispatchNative'], deliver = ['deliverNative'];
const scenarios = [
  ['personal dispatch and settled success', [open,personalMenu,request,dispatch,deliver]],
  ['exact work profile dispatch and settled success', [open,workMenu,request,dispatch,deliver]],
  ['paused profile and disabled work package still open details', [open,workMenu,request,
    ['setProfile','paused'],['setPackageState',2,'disabled'],dispatch,deliver]],
  ['removed work package refreshes inventory without personal dispatch', [open,workMenu,request,
    ['setPackageState',2,'removed'],['stageInventory',[1]],dispatch,deliver]],
  ['stale work profile reply keeps a newer personal menu', [open,workMenu,request,
    ['setProfile','removed'],dispatch,close,open,personalMenu,deliver]],
  ['personal rejection after drawer closes refreshes the hidden inventory', [open,personalMenu,request,close,
    ['setPackageState',1,'removed'],['stageInventory',[2]],dispatch,deliver,open]],
  ['query denial returns the selected work notice', [open,workMenu,request,['setPackageState',2,'denied'],dispatch,deliver]],
  ['personal dispatch refusal is delivered to the exact selection', [open,personalMenu,request,['setLaunch','argument'],dispatch,deliver]],
  ['work dispatch refusal cannot be confused with package removal', [open,workMenu,request,
    ['setLaunch','runtime'],dispatch,deliver]],
  ['success settlement keeps the exact native reply after profile removal', [open,workMenu,request,dispatch,
    ['setProfile','removed'],deliver]],
];

async function step(page, operation, args = []) {
  return page.evaluate(({operation,args}) => globalThis.quintDrawerFixture.step(operation,args), {operation,args});
}

function installCapacitorPort() {
  globalThis.androidBridge = {};
  globalThis.Capacitor = {
    PluginHeaders:[{name:'ElizaSystem',methods:[{name:'openAppInfo',rtype:'promise'}]}],
    nativePromise(plugin, method, target) {
      if (plugin !== 'ElizaSystem' || method !== 'openAppInfo')
        throw Error(`Unexpected synthetic Capacitor call ${plugin}.${method}`);
      return globalThis.quintDrawerFixture.captureAppInfo(target);
    },
  };
}

function notice(message) {
  if (!message) return {app:0, message:''};
  const match = /^(Clock|Mail) info could not be opened\. (.+)$/.exec(message);
  assert.ok(match, `Actual Home toast identifies the selected app and reason: ${message}`);
  return {app:match[1] === 'Clock' ? 1 : 2, message:match[2]};
}

export async function checkAppInfoHandoffComposition(extraSources = []) {
  const read = name => JSON.parse(readFileSync(join(root,name),'utf8'));
  assert.equal(read(preparedReceipt).baseCommit, read('upstream.lock.json').commit);
  const compiled = await compileDrawerInteraction([
    'specs/quint/refinement/application/drawer-interaction.mjs', fileURLToPath(import.meta.url), preparedReceipt,
    join(directory,probe), ...extraSources,
  ]);
  return withAppInfoSource(async ({sources,driverHashes,generatedSources,javaSources}) => {
    const traces = [], errors = [];
    const browser = await chromium.launch({headless:true});
    try {
      const page = await browser.newPage({viewport:{width:412,height:915}});
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<button id="outside">Outside</button><div id="mount"></div>');
      await page.evaluate(installCapacitorPort);
      await page.addScriptTag({content:compiled.code});
      for (const [name, operations] of scenarios) {
        await page.evaluate(() => globalThis.quintDrawerFixture.reset([],true));
        let staged = [1,2], reply = noReply, dispatched = false;
        const platform = {personal:'enabled',work:'enabled',profile:'present',launch:'allowed'};
        async function readHandoff() {
          return page.evaluate(() => globalThis.quintDrawerFixture.handoff());
        }
        async function observe() {
          const actual = await readHandoff();
          const raw = actual.nativeTarget;
          return {
            's.open':actual.open,'s.inventory':qset(actual.inventory),'s.menu':actual.menu,
            's.listReads':actual.refreshes,'s.staged':qset(staged),
            's.selected':actual.infoTarget,'s.request':{...noTarget,...raw},'s.platform':platform,
            's.phase':actual.pending ? (dispatched ? 'answered' : 'queued') : actual.infoTarget ? 'settled' : 'idle',
            's.reply':reply,'s.notice':notice(actual.notice),
          };
        }
        const result = trace(name,await observe());
        for (const [operation,...args] of operations) {
          switch (operation) {
            case 'openMenu': await step(page,'context',args); break;
            case 'stageInventory': staged=args[0]; await step(page,operation,args); break;
            case 'requestAppInfo': await step(page,'appInfo'); dispatched=false; reply=noReply; break;
            case 'setPackageState': platform[args[0] === 1 ? 'personal' : 'work']=args[1]; break;
            case 'setProfile': platform.profile=args[0]; break;
            case 'setLaunch': platform.launch=args[0]; break;
            case 'dispatchNative': {
              const before = await readHandoff();
              assert.ok(before.pending && before.nativeTarget,'Exact captured Capacitor target awaits the Java bridge');
              reply=javaTraces(probe,javaSources,[JSON.stringify(before.nativeTarget),JSON.stringify(platform)]);
              dispatched=true;
              break;
            }
            case 'deliverNative':
              assert.ok(dispatched,'Deliver only an actual Java reply');
              await step(page,'infoReply',[reply.resolved,reply.message,reply.code]);
              break;
            default: await step(page,operation,args);
          }
          const modelArgs = operation === 'stageInventory' ? [qset(staged)] : args;
          checkpoint(result, [operation,...args].join(' '), call(operation,...modelArgs), await observe());
        }
        traces.push(result);
      }
      await page.evaluate(() => globalThis.quintDrawerFixture.close());
      assert.deepEqual(errors, [], 'Mounted Drawer has no browser errors');
    } finally {await browser.close();}
    const receipt = await checkTraces({
      model,sources,driverHashes,generatedSources,traces,scope:'bounded-orchestration',assumptions:[
        'The real Chromium drawer, Alpha Home adapter, openAppInfo wrapper and Capacitor proxy send the raw observed request into unmodified AlphaSystemPlugin.openAppInfo.',
        'A harness controls when the captured request runs in the JVM and when its exact reply settles the existing Promise. The source toast and launcher refresh read are observed after React settlement.',
        'One outstanding App info request. Android APIs and the inventory list are closed ports. Installed Capacitor/Binder transport and actual Settings/task placement remain separate.',
      ],
    });
    return {receipt, obligations:[{model,obligation:'Installed Drawer through Android Settings',
      reason:'The renderer and Java implementations execute with synthetic process boundaries. Physical input, device profile policy, task placement and concurrent native requests need separate evidence.'}]};
  }, compiled.sources);
}
