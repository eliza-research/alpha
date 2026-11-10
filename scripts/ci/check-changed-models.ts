import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadModels,repositoryRoot,sha256} from '../quint-lib.ts';

const families=['application','services','native','legacy'];
const manifests=families.map(family=>`specs/quint/${family}/manifest.json`);
const checkerInputs=new Set(['scripts/check-quint.ts','scripts/quint-lib.ts','scripts/ci/check-changed-models.ts','specs/quint/tlc.json','package-lock.json']);

/** Manifest changes select their changed entries; shared checker changes select every model. */
export function selectChangedModels(models,paths,previous=new Map(),dependencies=new Map()){
 const changed=new Set(paths);
 if([...changed].some(path=>checkerInputs.has(path)))return models;
 const selected=new Set(models.filter(model=>changed.has(model.path)
  || (model.sources||[]).some(path=>changed.has(path))
  || (changed.has('upstream.lock.json')&&(model.sources||[]).some(path=>path.startsWith('vendor/eliza/')))
  || (changed.has(`specs/quint/${model.family}/manifest.json`)
    &&JSON.stringify(previous.get(model.module))!==JSON.stringify(model))).map(model=>model.path));
 let expanded;
 do{
  expanded=false;
  for(const model of models)if(!selected.has(model.path)&&(dependencies.get(model.path)||[]).some(path=>selected.has(path))){selected.add(model.path);expanded=true;}
 }while(expanded);
 return models.filter(model=>selected.has(model.path));
}

export function importedModelPaths(model,text){
 const source=text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 return [...source.matchAll(/\bimport\s+[\s\S]*?\bfrom\s+["']([^"']+)["']/g)].map(match=>
  relative(repositoryRoot,resolve(repositoryRoot,dirname(model.path),match[1].endsWith('.qnt')?match[1]:match[1]+'.qnt')).split('\\').join('/'));
}

export function proofPhases(model){
 return ['verify',...(model.temporal?.length?['temporal']:[]),
  ...(model.currentChecks?.length||model.currentTemporalChecks?.length||model.expectedViolations?.length?['compare']:[])];
}

async function main(){
 const args=process.argv.slice(2);
 for(const arg of args)if(!arg.startsWith('--base=')&&!arg.startsWith('--out='))throw Error(`Unknown option ${arg}`);
 const option=(name,fallback)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
 let base=option('base',process.env.ALPHA_QUINT_BASE||'HEAD^');
 const out=resolve(repositoryRoot,option('out','test-results/quint/changed-models'));
 mkdirSync(out,{recursive:true});
 const runId=randomUUID(),runOut=join(out,runId);mkdirSync(runOut);
 const receipt={schemaVersion:1,runId,status:'running',passed:false,base,startedAt:new Date().toISOString(),models:[],results:[]};
 const save=()=>writeFileSync(join(out,'summary.json'),JSON.stringify(receipt,null,2)+'\n');
 save();
 try{
  if(!/^[A-Za-z0-9_./~^\-]+$/.test(base)||base.startsWith('-'))throw Error('Invalid base revision');
  if(/^0+$/.test(base))base=execFileSync('git',['hash-object','-t','tree','--stdin'],{cwd:repositoryRoot,input:'',encoding:'utf8'}).trim();
  else base=execFileSync('git',['rev-parse','--verify',`${base}^{commit}`],{cwd:repositoryRoot,encoding:'utf8'}).trim();
  receipt.base=base;
  const paths=execFileSync('git',['diff','--name-only','-z',base,'--'],{cwd:repositoryRoot,encoding:'utf8'}).split('\0').filter(Boolean);
  const models=loadModels(),previous=new Map();
  for(const path of manifests){
   let document;
   try{document=JSON.parse(execFileSync('git',['show',`${base}:${path}`],{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
   catch(error){
    // A newly introduced manifest has no baseline; malformed existing JSON must still fail.
    const exists=spawnSync('git',['cat-file','-e',`${base}:${path}`],{cwd:repositoryRoot,stdio:'ignore'});
    if(exists.status===0)throw error;
    document=[];
   }
   const family=path.split('/')[2];
   for(const model of Array.isArray(document)?document:document.models)previous.set(model.module,{...model,family,
    sources:[...new Set([...(model.sources||[]),...(model.sharedSources||[]).map(source=>`vendor/eliza/${source}`)])]});
  }
  const dependencies=new Map(models.map(model=>[model.path,importedModelPaths(model,readFileSync(join(repositoryRoot,model.path),'utf8'))]));
  const selected=selectChangedModels(models,paths,previous,dependencies);
  receipt.changedPaths=paths;
  const inputs=[...new Set([...checkerInputs,...manifests,...models.map(model=>model.path),...selected.flatMap(model=>model.sources||[])])];
  receipt.inputHashes=Object.fromEntries(inputs.map(path=>[path,sha256(readFileSync(join(repositoryRoot,path)))]));
  receipt.models=selected.map(model=>({module:model.module,sha256:sha256(readFileSync(join(repositoryRoot,model.path))),phases:proofPhases(model)}));
  save();
  let passed=true;
  for(const model of selected)for(const phase of proofPhases(model)){
   const output=join(runOut,`${model.module}-${phase}.json`),expectedHash=receipt.models.find(row=>row.module===model.module).sha256;
   const args=[join(repositoryRoot,'scripts/check-quint.ts'),phase,`--models=${model.module}`,`--out=${output}`];
   const result=spawnSync(process.execPath,args,{cwd:repositoryRoot,stdio:'inherit'});
   let evidence;try{evidence=JSON.parse(readFileSync(output,'utf8'));}catch{}
   const valid=result.status===0&&!result.signal&&!result.error&&evidence?.passed===true
    &&evidence.status==='passed'&&evidence.command===phase&&evidence.results?.length>0
    &&evidence.inputHashes?.[model.path]===expectedHash
    &&evidence.results.every(row=>row.model===model.module&&row.passed===true&&row.modelSha256===expectedHash);
   receipt.results.push({model:model.module,phase,passed:valid,exitCode:result.status,signal:result.signal,output});
   passed=passed&&valid;save();
  }
  receipt.passed=passed;receipt.status=passed?'passed':'failed';
  if(!passed)process.exitCode=1;
  console.log(`Changed-model proofs: ${selected.length} models, ${receipt.results.length} phases, ${receipt.status}`);
 }catch(error){receipt.status='failed';receipt.error=String(error.stack||error);process.exitCode=1;console.error(receipt.error);}
 finally{
  receipt.finalInputErrors=[];
  try{for(const [path,hash] of Object.entries(receipt.inputHashes||{}))if(sha256(readFileSync(join(repositoryRoot,path)))!==hash)receipt.finalInputErrors.push(`Proof input changed during run: ${path}`);}
  catch(error){receipt.finalInputErrors.push(`Could not verify final proof inputs: ${error.message}`);}
  if(receipt.finalInputErrors.length){receipt.passed=false;receipt.status='failed';process.exitCode=1;console.error(receipt.finalInputErrors.join('\n'));}
  receipt.finishedAt=new Date().toISOString();save();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
