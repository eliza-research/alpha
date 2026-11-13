/** Test the packaged compiler against the production checker's trusted program. */
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceDirectory,workerArtifactDirectory} from './local-agent-source.ts';
import {verifyWorkerArtifact} from './workflow-worker-artifact.ts';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
const artifact=workerArtifactDirectory(resolve(import.meta.dirname,'..'));
const verified=verifyWorkerArtifact(artifact);
const source=sourceDirectory(resolve(import.meta.dirname,'..'));
const checker=readFileSync(join(source,'plugins/plugin-workflow/src/services/workflow-source-check.ts'),'utf8');
const program=checker.match(/const COMPILER_PROGRAM = String\.raw`([\s\S]*?)`;/)?.[1];
assert.ok(program&&!program.includes('${'),'Trusted compiler program must be a literal');
const valid=`import {createSmithers} from 'smthrs/create';import {approvalDecisionSchema} from 'smthrs';import {z} from 'zod';
const {Workflow,Sequence,Approval,Task,smithers,outputs}=createSmithers({decision:approvalDecisionSchema,result:z.object({value:z.number()})},{dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
export default smithers(()=><Workflow name="portable"><Sequence><Approval id="review" output={outputs.decision} request={{title:'Synthetic review'}}/><Task id="task" output={outputs.result}>{()=>({value:56})}</Task></Sequence></Workflow>);`;
const cases=[
 ['valid-approval',valid,true],
 ['unsupported-named-export',"import {CodexAgent} from 'smthrs';\n"+valid,false],
 ['unsupported-namespace-export',"import * as runtime from 'smthrs';const unavailable=runtime.CodexAgent;\n"+valid,false],
 ['supported-type-contract',"import type {SmithersWorkflow} from 'smthrs';\n"+valid,true],
 ['unsupported-create-export',"import {CodexAgent} from 'smthrs/create';\n"+valid,false],
 ['unsupported-subpath',"import * as tools from 'smthrs/tools';\n"+valid,false],
 ['draft-never-executed',"throw new Error('DRAFT_EXECUTED');\n"+valid,true],
 ['semantic-type-error',"const invalid: number = 'wrong';\n"+valid,false],
 ['invalid-default-export','export default 42;',false],
 ['suppression-rejected','// @ts-nocheck\n'+valid,false],
 ['dynamic-import-rejected',"const hidden=import('node:fs');\n"+valid,false],
 ['reference-rejected','/// <reference path="./secret.ts" />\n'+valid,false],
] as const;
const temporary=mkdtempSync(join(tmpdir(),'alpha-workflow-compiler-'));
try{
 const anchor=join(temporary,'compiler');cpSync(join(artifact,'compiler'),anchor,{recursive:true});
 const descriptor: {compilerModule: string; declarationFiles: number; packages: unknown}=JSON.parse(readFileSync(join(anchor,'compiler.json'),'utf8'));
 assert.ok('compiler' in verified.manifest,'Worker manifest must bind the compiler descriptor');
 assert.deepEqual(descriptor,verified.manifest.compiler);
 for(const [name,text,expected] of cases){
  const result: {ok: boolean; diagnostics: unknown}=JSON.parse(execFileSync(process.env.ALPHA_BUN||'bun',['--no-install','-e',program,join(anchor,descriptor.compilerModule)],{cwd:temporary,env:{PATH:process.env.PATH,HOME:temporary,TMPDIR:temporary},input:JSON.stringify({source:text,anchor}),encoding:'utf8',timeout:scaledTimeout(15000),maxBuffer:16384}));
  assert.equal(result.ok,expected,`${name}: ${JSON.stringify(result.diagnostics)}`);
  console.log(`${name}: passed`);
 }
 console.log(JSON.stringify({cases:cases.length,artifactFiles:verified.files.length,artifactBytes:verified.bytes,declarationFiles:descriptor.declarationFiles,packages:descriptor.packages}));
}finally{rmSync(temporary,{recursive:true,force:true});}
