import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifySource} from '../../scripts/local-agent-source.mjs';
const {config,variants} = JSON.parse(readFileSync(0, 'utf8'));
// The normal prepared runtime owns installed SDK dependencies. Authenticate it
// at this app's exact pin rather than treating generated metadata as a raw vendor checkout.
const source=resolve(process.env.ALPHA_CLOUD_COLLECTOR_SOURCE||'vendor/eliza');
const {commit}=JSON.parse(readFileSync(new URL('../../upstream.lock.json',import.meta.url),'utf8'));
verifySource(source,commit);
const {collectPluginNames} = await import(pathToFileURL(join(source,'packages/agent/src/runtime/plugin-collector.ts')).href);
// The collector reads (and may set) process.env, so each variant starts from the launched environment.
const base={...process.env};
for(const extra of variants){
 for(const key of Object.keys(process.env))if(!(key in base))delete process.env[key];
 Object.assign(process.env,base,extra);
 console.log('SDK_PLUGIN_SELECTION=' + JSON.stringify([...collectPluginNames(config)].sort()));
}
