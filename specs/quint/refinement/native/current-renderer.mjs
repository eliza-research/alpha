import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {root,directory} from './java.mjs';
import {residentLifecycleTraces} from './local-agent.mjs';

export async function checkCurrentRenderer(extraSources=[]) {
 const options={absWorkingDir:root,entryPoints:[directory+'/renderer.mjs'],bundle:true,write:false,platform:'node',format:'esm',metafile:true,packages:'external'};
 const discovery=await build(options);
 const sources=Object.keys(discovery.metafile.inputs).map(path=>resolve(root,path)).filter(existsSync)
  .concat(fileURLToPath(import.meta.url),extraSources);
 const driverHashes=captureInputs(sources);
 const actual=await import('./renderer.mjs');
 const receipts=[];
 for(const [model,generate] of [['VoiceSession',actual.voiceTraces],['NavigationProgress',actual.navigationTraces]])
  receipts.push(await checkTraces({model,id:model+'-current-renderer',sources,driverHashes,traces:await generate(),scope:'bounded-component',assumptions:[
   'Product re-export and current staged shared source execute. Every transitive source discovered by esbuild is bound before execution.',
   'Controlled voice capture/playback/clock and finite navigation fix partitions replace external ports. Complete native navigation and speech pipelines remain separate obligations.'
  ]}));
 const lifecycle=await residentLifecycleTraces([fileURLToPath(import.meta.url),...extraSources]);
 receipts.push(await checkTraces({model:'ResidentRuntime',id:'ResidentRuntime-current-wrapper',...lifecycle,scope:'bounded-orchestration',assumptions:[
  'The real renderer LocalAgentProtocol and stopLocalAgent execute against a controlled Capacitor service port.',
  'Native stop inventory, attached/owned cancellation and late readiness are finite schedules. Binder/process outcomes and service implementation remain separate.'
 ]}));
 return receipts;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkCurrentRenderer(),null,2));
