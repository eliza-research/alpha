import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {sourceDirectory,workerArtifactDirectory} from './local-agent-source.ts';
import {stageWorkerArtifact,workerHash} from './workflow-worker-artifact.ts';
const root=resolve(import.meta.dirname,'..'),source=sourceDirectory(root);
execFileSync(process.execPath,[join(root,'scripts/prepare-local-agent.ts'),'--source-only'],{cwd:root,stdio:'inherit'});
const artifact=workerArtifactDirectory(root);
const result=stageWorkerArtifact(artifact,join(root,'android/app/src/main/assets/agent/workflow-worker'),{
 sourceStampSha256:workerHash(readFileSync(join(source,'.alpha-runtime-source.json'))),
 lockSha256:workerHash(readFileSync(join(source,'bun.lock'))),
});
console.log(JSON.stringify({stagedWorker:result,androidExecution:false}));
