import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Execute the real CLI with only Vite replaced at its external module boundary.
// The fake server records its configuration without starting a backend or network listener.
const vite = `
export async function loadConfigFromFile(){return {config:{plugins:[
 Promise.resolve({name:'alpha-local-agent-development'}),
 [{name:'alpha-browser-cloud-dev-bridge'},{name:'retained-plugin'}]
],server:{headers:{'x-fixture':'retained'}}}};}
export async function createServer(config){
 const names=['ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ELIZA_DEV_ALLOW_TEST_MOCKS','VITE_ALPHA_CLOUD_RESIDENT','VITE_ALPHA_CLOUD_ENVIRONMENT','VITE_LOCAL_AGENT','VITE_ELIZA_RUNTIME_PROFILE','VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE'];
 console.log(JSON.stringify({fixture:'vite-config',env:Object.fromEntries(names.map(name=>[name,process.env[name]])),config}));
 return {listen:async()=>{},close:async()=>{}};
}`;
const preload = `import {registerHooks} from 'node:module';
registerHooks({resolve(name,context,next){
 return name==='vite'?{url:${JSON.stringify('data:text/javascript,'+encodeURIComponent(vite))},shortCircuit:true}:next(name,context);
}});`;
const root=fileURLToPath(new URL('../',import.meta.url));
function launch(extra={}){
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'scripts/dev-ui-remote-host.mjs','--port=5494','--remote=http://127.0.0.1:5518','--environment=staging'],{
  cwd:root,encoding:'utf8',timeout:10000,
  env:{...process.env,ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_ELIZA_RUNTIME_PROFILE:'native',ALPHA_CLOUD_REALTIME_VOICE:'',VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE:'1',...extra},
 });
 assert.equal(result.status,0,result.stderr);
 const row=result.stdout.split('\n').find(line=>line.startsWith('{"fixture":"vite-config"'));
 assert.ok(row,result.stdout);
 return JSON.parse(row);
}

test('remote renderer selects Cloud routing with mocks off before loading Vite',()=>{
 const {env}=launch();
 assert.equal(env.VITE_ELIZA_RUNTIME_PROFILE,'cloud');
 assert.equal(env.VITE_ALPHA_CLOUD_RESIDENT,'1');
 assert.equal(env.VITE_ALPHA_CLOUD_ENVIRONMENT,'staging');
 assert.equal(env.VITE_LOCAL_AGENT,'1');
 assert.equal(env.ELIZA_DEV_ALLOW_TEST_MOCKS,'');
 assert.equal(env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS,'');
});

test('remote realtime renderer requires the explicit Cloud relay opt-in',()=>{
 for(const value of ['', '0', 'true'])assert.equal(launch({ALPHA_CLOUD_REALTIME_VOICE:value}).env.VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE,'');
 assert.equal(launch({ALPHA_CLOUD_REALTIME_VOICE:'1'}).env.VITE_ALPHA_DEV_CLOUD_REALTIME_VOICE,'1');
});

test('remote preview preserves proxy authority and filters local backend plugins',()=>{
 const {config}=launch();
 assert.deepEqual(config.plugins.map(plugin=>plugin.name),['retained-plugin']);
 assert.equal(config.server.host,'127.0.0.1');
 assert.equal(config.server.port,5494);
 assert.equal(config.server.strictPort,true);
 assert.equal(config.server.hmr,false);
 assert.deepEqual(config.server.headers,{'x-fixture':'retained'});
 const proxies=Object.entries(config.server.proxy);
 assert.equal(proxies.length,1);
 const [pattern,proxy]=proxies[0];
 assert.equal(proxy.target,'http://127.0.0.1:5518');
 assert.equal(proxy.changeOrigin,false);
 assert.equal(proxy.ws,true);
 for(const route of ['browser-cloud','local-agent','local-renderer','local-voice','agent-google-access','owner-gmail'])assert.ok(new RegExp(pattern).test('/__alpha-'+route+'/fixture'));
 assert.equal(new RegExp(pattern).test('/__alpha-unregistered/fixture'),false);
});
