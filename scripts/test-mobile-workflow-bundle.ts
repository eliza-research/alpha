/** Load the actual mobile bundle and its workflow routes without a source checkout. */
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sourceDirectory,workerArtifactDirectory} from './local-agent-source.ts';
import {stageWorkerArtifact,workerHash} from './workflow-worker-artifact.ts';
const root=resolve(import.meta.dirname,'..');
const bundle=join(sourceDirectory(root),'packages/agent/dist-mobile');
type MobileBundleManifest = {
 plugins: { optional: string[] };
 externalsAsStubs: string[];
 pglite: { extensions: Record<string, {file: string; expectedAt: string}> };
};
const manifest: MobileBundleManifest=JSON.parse(readFileSync(join(bundle,'plugins-manifest.json'),'utf8'));
assert.ok(manifest.plugins.optional.includes('@elizaos/plugin-workflow'));
assert.ok(!manifest.externalsAsStubs.includes('@elizaos/plugin-workflow'));
const temporary=realpathSync(mkdtempSync(join(tmpdir(),'alpha-mobile-workflow-bundle-')));
try{
 cpSync(bundle,join(temporary,'bundle'),{recursive:true});
 // RuntimeBundleStore extracts the declared PGlite archives beside bundle/.
 // Preserve that packaged layout instead of relying on the source checkout.
 for(const extension of Object.values(manifest.pglite.extensions)){
  assert.match(extension.file,/^[A-Za-z0-9_.+-]+\.tar\.gz$/);
  assert.equal(extension.expectedAt,'../'+extension.file);
  cpSync(join(bundle,extension.file),join(temporary,extension.file));
 }
 const state=join(temporary,'state');mkdirSync(state,{mode:0o700});
 const worker=join(temporary,'workflow-worker'),prepared=sourceDirectory(root);
 stageWorkerArtifact(workerArtifactDirectory(root),worker,{
  sourceStampSha256:workerHash(readFileSync(join(prepared,'.alpha-runtime-source.json'))),
  lockSha256:workerHash(readFileSync(join(prepared,'bun.lock'))),
 });
 const bun=realpathSync(execFileSync(process.env.ALPHA_BUN||'bun',['--no-install','-e','process.stdout.write(process.execPath)'],{cwd:temporary,env:{PATH:process.env.PATH,HOME:temporary},encoding:'utf8',timeout:10000}).trim());
 const program=`import assert from 'node:assert/strict';
const hardDeadline=setTimeout(()=>{console.error('Workflow bundle bootstrap deadline exceeded');process.exit(2)},60000);
await import(${JSON.stringify(pathToFileURL(join(temporary,'bundle/agent-bundle.js')).href)});
// The entry launches bootstrap asynchronously. Observe its real enabled workflow
// registration; import completion alone is not runtime initialization.
const readEntry=()=>globalThis[Symbol.for('elizaos.app.route-plugin-registry')]?.entries?.get('@elizaos/plugin-workflow:routes');
const deadline=Date.now()+45000;let entry=readEntry();
while(typeof entry?.load!=='function'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,25));entry=readEntry();}
assert.equal(typeof entry?.load,'function','Workflow route loader was not bundled/registered');
const plugin=await entry.load();
assert.equal(plugin.name,'@elizaos/plugin-workflow:routes');
for(const path of ['/api/workflow/status','/api/workflow/phone/validate','/api/workflow/phone/workflows']){
 const route=plugin.routes.find(route=>route.path===path);assert.ok(route,path);assert.equal(route.rawPath,true);assert.equal(typeof route.handler,'function');
}
console.log('ALPHA_MOBILE_WORKFLOW_BUNDLE '+JSON.stringify({isolatedDirectory:true,verifiedWorkerArtifact:true,workflowRegistrationObserved:true,workflowRouteCount:plugin.routes.length,fullRuntimeReadiness:false,nativeExecution:false}));clearTimeout(hardDeadline);process.exit(0);`;
 // Exercise the real direct-executable process-host contract with this host's
 // Bun and authenticated worker files. This does not execute Android binaries.
 const output=execFileSync(bun,['--no-install','-e',program],{cwd:join(temporary,'bundle'),env:{PATH:process.env.PATH,HOME:temporary,TMPDIR:temporary,ELIZA_STATE_DIR:state,ELIZA_DISABLE_TRAJECTORY_LOGGING:'1',ELIZA_DISABLE_AGENT_WALLET_BOOTSTRAP:'1',ELIZA_PLATFORM:'android',ELIZA_ANDROID_APP_DATA_DIR:temporary,ELIZA_MOBILE_WORKFLOWS:'1',ELIZA_SMTHRS_RUNTIME_DIR:worker,ELIZA_ANDROID_BUN_TARGET:'android',BUN_PATH:bun,LD_PATH:bun,LD_LIBRARY_PATH:dirname(bun)},encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
 const result=output.split('\n').find(line=>line.startsWith('ALPHA_MOBILE_WORKFLOW_BUNDLE '));assert.ok(result,'Missing qualification result');console.log(result);
}finally{rmSync(temporary,{recursive:true,force:true});}
