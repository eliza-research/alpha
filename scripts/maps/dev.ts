#!/usr/bin/env node
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const data=resolve(process.env.ALPHA_MAPS_DATA||join(homedir(),'.local/share/alphaphone-maps/monaco'));
const args=process.argv.slice(2);let port=5173;
if(args.length){if(args.length!==2||args[0]!=='--port'||!/^\d+$/.test(args[1]))throw Error('Usage: npm run dev:maps -- --port 5173');port=Number(args[1]);}
if(port<1024||port>65535||[47850,47851,47852].includes(port))throw Error('Choose an app port from 1024–65535 outside the Maps service ports.');
const prepareSteps=`\nPrepare the region in this order:\n 1. python3 scripts/maps/prepare-region.py\n 2. python3 scripts/maps/index-region.py (PyOsmium 4.1.1)\n 3. From ${data}: java -Xmx512m -jar graphhopper.jar server ${join(root,'scripts/maps/graphhopper.yml')}, then stop it once the graph is imported\n 4. Review the data, then python3 scripts/maps/dataset_manifest.py seal`;
const children: any[]=[];const abort=new AbortController();let stopping=false;
async function stop(code: any){
 if(stopping)return;stopping=true;abort.abort();
 await Promise.all(children.map((child: any)=>new Promise((resolve: any)=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');})));
 process.exitCode=code;
}
process.on('SIGINT',()=>void stop(130));process.on('SIGTERM',()=>void stop(143));
const free=(port: any)=>new Promise((resolve: any,reject: any)=>{const server=net.createServer();server.once('error',()=>reject(Error(`Port ${port} is occupied. Stop its owner or choose another app port; existing services are left running.`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});
function start(name: any,command: any,args: any,options: any={}){
 abort.signal.throwIfAborted();const child=spawn(command,args,{cwd:root,stdio:'inherit',...options});children.push(child);
 child.once('error',(error: any)=>{if(!stopping){console.error(`${name}: ${error.message}`);void stop(1);}});
 child.once('exit',(code: any,signal: any)=>{if(!stopping){console.error(`${name} stopped (${signal||code}).`);void stop(1);}});return child;
}
async function ready(url: any,validate: any,format:'json'|'text'='json'){
 const until=Date.now()+60000;
 while(Date.now()<until){abort.signal.throwIfAborted();try{const response=await fetch(url,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(1000)])});if(response.ok&&validate(await response[format]()))return;}catch{abort.signal.throwIfAborted();}await new Promise((resolve: any)=>setTimeout(resolve,200));}
 throw Error(`Service did not become ready: ${url}`);
}
try{
 for(const name of ['graphhopper.jar','places.sqlite','monaco.mbtiles','source-manifest.json'])if(!existsSync(join(data,name))||!statSync(join(data,name)).isFile())throw Error(`Missing regional data: ${join(data,name)}.${prepareSteps}`);
 if(!existsSync(join(data,'graph-cache','properties')))throw Error(`Prepared GraphHopper graph-cache is missing.${prepareSteps}`);
 const candidates=[process.env.ALPHA_MAPS_JAVA,process.env.JAVA_HOME&&join(process.env.JAVA_HOME,'bin/java'),'/opt/homebrew/opt/openjdk@21/bin/java','/usr/local/opt/openjdk@21/bin/java','java'].filter(Boolean);
 const java=candidates.find((candidate: any)=>{const result=spawnSync(candidate,['-version'],{encoding:'utf8',timeout:5000});const version=(result.stderr||'')+(result.stdout||'');return result.status===0&&Number(version.match(/version "(\d+)/)?.[1])>=21;});
 if(!java)throw Error('Java 21 or newer is required. Set ALPHA_MAPS_JAVA to its executable.');
 if(spawnSync('python3',['--version'],{timeout:5000}).status!==0)throw Error('Python 3 is required for the regional gateway.');
 const manifest=spawnSync('python3',[join(root,'scripts/maps/dataset_manifest.py'),'verify','--data',data],{encoding:'utf8',timeout:30000});
 if(manifest.status!==0)throw Error(`Regional runtime manifest is missing or stale.${prepareSteps}`);
 for(const value of [47850,47851,47852,port])await free(value);
 start('Regional router',java,['-Xmx512m','-jar','graphhopper.jar','server',join(root,'scripts/maps/graphhopper.yml')],{cwd:data});
 await ready('http://127.0.0.1:47851/info',(value: any)=>Array.isArray(value.profiles));
 start('Regional gateway','python3',[join(root,'scripts/maps/serve-region.py')],{env:{...process.env,ALPHA_MAPS_DATA:data}});
 await ready('http://127.0.0.1:47850/capabilities',(value: any)=>value.providerId==='alpha-osm-monaco');
 start('Development app',process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{env:{...process.env,ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_MAPS_BASE_URL:'http://127.0.0.1:47850'}});
 await ready(`http://127.0.0.1:${port}/`,(value: any)=>value.includes('/@vite/client'),'text');
 console.log(`Regional Maps ready. App: http://127.0.0.1:${port}/?mode=dev — Ctrl-C stops this command's services.`);
}catch(error: any){if(!stopping)console.error(error.message);await stop(stopping?process.exitCode||130:1);}
