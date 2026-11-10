import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isBuiltin} from 'node:module';
import {coreStateBuildPlugin,coreStateBuildRecord,coreStateRequiredTargets} from './core-state-patch.ts';

const [root,sdk,file,metadataFile]=process.argv.slice(2);
if(!root||!sdk||!file||!metadataFile)throw Error('Native host build paths are required');
const entry=path.join(root,'backend/native-google-agent-host.ts');
const core=coreStateBuildPlugin(root,sdk);
const consumed=new Map<string,string>();
const result=await Bun.build({
 entrypoints:[entry],
 target:'bun',format:'esm',minify:{syntax:true},conditions:['eliza-source'],
 tsconfig:path.join(sdk,'tsconfig.json'),metafile:true,
 define:{'import.meta.env':'{"VITE_ELIZA_DEV_ALLOW_TEST_MOCKS":"0"}'},
 plugins:[core.plugin,{name:'pinned-native-server-sdk',setup(builder){
  builder.onResolve({filter:/^[^./]/},args=>{
   if(isBuiltin(args.path)||args.path.startsWith('bun:'))return;
   const vendor=path.join(root,'vendor/eliza'),fromVendor=path.relative(vendor,args.importer),fromSdk=path.relative(sdk,args.importer);
   const vendorImport=!!args.importer&&!fromVendor.startsWith('..')&&!path.isAbsolute(fromVendor);
   const sdkImport=!!args.importer&&!fromSdk.startsWith('..')&&!path.isAbsolute(fromSdk);
   if(!vendorImport&&!sdkImport&&!args.path.startsWith('@elizaos/'))return;
   const parent=vendorImport?path.dirname(path.join(sdk,fromVendor)):sdkImport?path.dirname(args.importer):sdk;
   const resolved=Bun.resolveSync(args.path,parent),relative=path.relative(sdk,resolved);
   if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Native server SDK dependency escaped its prepared source');
   return {path:resolved};
  });
  builder.onLoad({filter:/.*/,namespace:'file'},args=>{
   const input=path.resolve(args.path);
   if(!fs.lstatSync(input).isFile())throw Error('Native Google build input is not regular');
   const bytes=fs.readFileSync(input),digest=createHash('sha256').update(bytes).digest('hex');
   const previous=consumed.get(input);
   if(previous!==undefined&&previous!==digest)throw Error('Native Google build input changed while compiling');
   consumed.set(input,digest);
   return {contents:bytes,loader:args.loader,resolveDir:path.dirname(input)};
  });
 }}],
});
if(!result.success)throw new AggregateError(result.logs,'Native host compilation failed');
const output=result.outputs.find(item=>item.kind==='entry-point');
if(!output||!result.metafile)throw Error('Native host compiler did not produce its module and source graph');

// The core hook supplies effective source to Bun and separately authenticates its raw input.
for(const row of core.transforms)consumed.set(path.resolve(sdk,row.path),row.sourceSha256);
const graph=new Map<string,{input:(typeof result.metafile.inputs)[string],digest:string}>();
for(const [name,value] of Object.entries(result.metafile.inputs)){
 const absolute=path.resolve(root,name),relative=path.relative(root,absolute);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Native host source graph escaped the product');
 const key=relative.split(path.sep).join('/'),digest=consumed.get(absolute);
 if(!digest||graph.has(key))throw Error('Native host source graph lacks exact input bytes: '+key);
 graph.set(key,{input:value,digest});
}
if(graph.size!==consumed.size||!graph.has('backend/native-google-agent-host.ts'))
 throw Error('Native host compiler input graph is incomplete');
const inputs=Object.fromEntries([...graph].map(([name,row])=>[name,row.input]));
const inputHashes=Object.fromEntries([...graph].map(([name,row])=>[name,row.digest]));
const coreState=coreStateBuildRecord(root,core.transforms,coreStateRequiredTargets(Object.keys(inputs)));
const outputSha256=createHash('sha256').update(Buffer.from(await output.arrayBuffer())).digest('hex');
await Bun.write(file,output);
fs.writeFileSync(metadataFile,JSON.stringify({...result.metafile,inputs,inputHashes,outputSha256,coreState},null,2)+'\n');
