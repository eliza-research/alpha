/** Compile real browser source with explicit Vite flags for Node-only fixtures. */
import {build,transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function loadBrowserModule(entry,{testMocks=false,env={}}={}) {
 const entries=Array.isArray(entry)?entry:[entry];
 const contents=entries.map((name,index)=>`export * as entry${index} from ${JSON.stringify(resolve(root,name))};`).join('\n');
 const {outputFiles}=await build({absWorkingDir:root,stdin:{contents,resolveDir:root,sourcefile:'browser-fixture.mjs'},bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':JSON.stringify({DEV:testMocks,VITE_ELIZA_DEV_ALLOW_TEST_MOCKS:testMocks?'1':'',...env})},plugins:[{
  name:'fixture-module-url',setup(builder){builder.onLoad({filter:/\.[cm]?[jt]sx?$/},async({path})=>{
   if(path.includes("/node_modules/"))return;
   const loader=/\.tsx$/.test(path)?'tsx':/\.[cm]?ts$/.test(path)?'ts':/\.jsx$/.test(path)?'jsx':'js';
   const {code}=await transform(await readFile(path,'utf8'),{loader,format:'esm',define:{'import.meta.url':JSON.stringify(pathToFileURL(path).href)}});
   return {contents:code,loader:'js',resolveDir:dirname(path)};
  });}
 }]});
 const loaded=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 return Array.isArray(entry)?entries.map((_,index)=>loaded[`entry${index}`]):loaded.entry0;
}
