// Local Vite assets, existing loopback host. This does not start an agent or read credentials.
import {createServer,loadConfigFromFile} from 'vite';
import {resolve} from 'node:path';
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const match=/^--(port|remote|environment)=(.+)$/.exec(arg);if(!match)throw Error('Use --port, --remote and --environment');return [match[1],match[2]];}));
const port=Number(options.port||5494),remote=new URL(options.remote||'http://127.0.0.1:5518');
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
if(remote.protocol!=='http:'||remote.hostname!=='127.0.0.1'||!remote.port||remote.pathname!=='/'||remote.search||remote.hash||remote.username||remote.password||Number(remote.port)===port)throw Error('Remote host must be a separate explicit loopback port');
const environment=options.environment||'production';
if(!['production','staging'].includes(environment))throw Error('Invalid Cloud environment');
Object.assign(process.env,{ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:'',VITE_ALPHA_CLOUD_RESIDENT:'1',VITE_ALPHA_CLOUD_ENVIRONMENT:environment,VITE_LOCAL_AGENT:'1'});
const loaded=await loadConfigFromFile({command:'serve',mode:'development'},resolve('vite.config.ts'));
if(!loaded)throw Error('Vite configuration unavailable');
const plugins=[];
async function append(value){for(const item of await value||[]){const plugin=await item;if(Array.isArray(plugin))await append(plugin);else if(plugin&&!['alpha-local-agent-development','alpha-browser-cloud-dev-bridge'].includes(plugin.name))plugins.push(plugin);}}
await append(loaded.config.plugins);
const server=await createServer({...loaded.config,configFile:false,plugins,server:{...loaded.config.server,host:'127.0.0.1',port,strictPort:true,hmr:{host:'127.0.0.1',clientPort:port},proxy:{'^/__alpha-(browser-cloud|local-agent|local-renderer|local-voice|agent-google-access|owner-gmail)(/|\\?|$)':{target:remote.origin,changeOrigin:false,ws:true,timeout:180000,proxyTimeout:180000}},warmup:{clientFiles:['./src/main.tsx']}}});
let closing=false;async function close(){if(closing)return;closing=true;await server.close();process.exitCode=0;}
process.once('SIGINT',close);process.once('SIGTERM',close);
await server.listen();
console.log(`Local renderer http://127.0.0.1:${port}; existing host ${remote.origin}; ${environment}; agents and credential stores unchanged.`);
