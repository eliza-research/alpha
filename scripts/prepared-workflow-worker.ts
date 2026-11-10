import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,join,relative,dirname,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sourceDirectory,assertWorkerOutputSeparation} from './local-agent-source.ts';
import {verifyWorkerArtifact,workerHash} from './workflow-worker-artifact.ts';

/** Caller must first complete normal prepare-local-agent --source-only admission. */
export async function buildPreparedWorkflowWorker(root: any,source: any,output: any) {
 root=resolve(root);source=sourceDirectory(root,{ALPHA_LOCAL_AGENT_SOURCE_DIR:source});output=resolve(output);
 const within=relative(join(root,'artifacts'),output);
 if(!within||within.startsWith('..')||isAbsolute(within)||existsSync(output))throw Error('Choose a fresh worker output directory under artifacts');
 for(let current=output;;current=dirname(current)){
  let stat;try{stat=lstatSync(current);}catch(error: any){if(error.code!=='ENOENT')throw error;}
  if(stat?.isSymbolicLink())throw Error('Worker output path must not contain symlinks');
  if(dirname(current)===current)break;
 }
 assertWorkerOutputSeparation(source,output);
 const producer=join(source,'packages/scripts/plugins/plugin-workflow/build-workflow-artifact.ts');
 if(!existsSync(producer))throw Error('Prepared runtime lacks the generic workflow artifact producer; update the reviewed runtime source');
 const stamp=join(source,'.alpha-runtime-source.json'),lock=join(source,'bun.lock');
 const expected={sourceStampSha256:workerHash(readFileSync(stamp)),lockSha256:workerHash(readFileSync(lock))};
 const {buildWorkflowArtifact}=await import(pathToFileURL(producer).href);
 if(typeof buildWorkflowArtifact!=='function')throw Error('Prepared runtime workflow artifact API unavailable');
 await buildWorkflowArtifact({sourceRoot:source,outputDir:output,sourceIdentity:expected.sourceStampSha256});
 if(workerHash(readFileSync(stamp))!==expected.sourceStampSha256||workerHash(readFileSync(lock))!==expected.lockSha256)throw Error('Prepared runtime provenance changed during artifact build');
 return verifyWorkerArtifact(output,expected);
}

/**
 * Reuse an existing worker artifact only when it verifies against the currently
 * admitted prepared source; otherwise build into the fresh default directory.
 * A stale or foreign artifact is never rebuilt over or relabelled.
 */
export async function ensurePreparedWorkflowWorker(root: any,source: any,output: any) {
 if(existsSync(resolve(output))){
  const stamp=join(source,'.alpha-runtime-source.json'),lock=join(source,'bun.lock');
  const expected={sourceStampSha256:workerHash(readFileSync(stamp)),lockSha256:workerHash(readFileSync(lock))};
  try{return {reused:true,...verifyWorkerArtifact(output,expected)};}
  catch(error: any){throw Error(`Existing worker artifact ${output} does not match the prepared runtime source (${error.message}). Move it aside, or set ALPHA_WORKFLOW_WORKER_OUTPUT to a fresh directory under artifacts, then rerun npm run agent:build-workflow-worker.`);}
 }
 return {reused:false,...await buildPreparedWorkflowWorker(root,source,output)};
}
