import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {CORE_STATE_INPUTS,coreStatePatch,coreStateBuildRecord,coreStateRequiredTargets} from '../../../../../scripts/core-state-patch.ts';
import {captureInputs} from '../../check-traces.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Compile actual Notes owners and bind all selected bytes before evaluating them. */
export async function loadNotesSource(extraSources=[]) {
  const root=process.cwd(),source=path.join(root,'vendor/eliza'),compiled=new Map(),transforms=[];
  const prepared=coreStatePatch(root,source);
  const built=await build({stdin:{contents:`
    export {AgentRuntime} from './vendor/eliza/packages/core/src/runtime.ts';
    export {NotesStore} from './vendor/eliza/plugins/plugin-notes/src/store.ts';
    export {NotesService} from './vendor/eliza/plugins/plugin-notes/src/service.ts';
    export {interact,serverInteract} from './vendor/eliza/plugins/plugin-notes/src/interact.ts';
    export {createNotesClient} from './.eliza/client-features/plugins/plugin-notes/src/client/notes-api.ts';
    export {notesProvider,namedNotesProvider} from './vendor/eliza/plugins/plugin-notes/src/provider.ts';
  `,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',
    banner:{js:`import {createRequire as createBoundRequire} from 'node:module'; const require=createBoundRequire(${JSON.stringify(path.join(root,'package.json'))});`},
    plugins:[{name:'byte-bound-notes-source',setup(builder){
      builder.onResolve({filter:/^@elizaos\/core$/},()=>({path:path.join(source,'packages/core/src/index.ts')}));
      builder.onResolve({filter:/^file-type$/},()=>({path:'file-type',external:true}));
      builder.onLoad({filter:/\.(?:ts|tsx|js|mjs|cjs|json)$/,namespace:'file'},args=>{
        const bytes=fs.readFileSync(args.path);compiled.set(args.path,hash(bytes));
        const relative=path.relative(source,args.path).split(path.sep).join('/');
        const selected=prepared.files.get(relative);
        if(selected){assert.equal(hash(bytes),selected.beforeSha256);transforms.push({path:relative,sourceSha256:selected.beforeSha256,outputSha256:selected.afterSha256});}
        const extension=args.path.split('.').at(-1);
        return {contents:bytes,loader:['mjs','cjs'].includes(extension)?'js':extension,resolveDir:path.dirname(args.path)};
      });
    }}]});
  assert.doesNotMatch(built.outputFiles[0].text,/['"]file-type['"]/, 'Optional media dependency must be absent from Notes executable');
  const sources=[...compiled.keys(),fileURLToPath(import.meta.url),'bun.lock',...CORE_STATE_INPUTS,...extraSources];
  const driverHashes=captureInputs(sources);
  for(const [file,digest] of Object.entries(prepared.receipt.inputHashes))assert.equal(driverHashes[path.resolve(file)],digest,'Notes source inputs changed before capture');
  for(const [file,digest] of compiled)assert.equal(driverHashes[path.resolve(file)],digest,'Notes source changed during compilation');
  const module=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  return {...module,sources,driverHashes,coreState:coreStateBuildRecord(root,transforms,coreStateRequiredTargets([...compiled.keys()]))};
}
