#!/usr/bin/env bun
/** Product preparation/provenance wrapper. Runtime owns bundling and compiler resources. */
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {preparedSourceEnv,sourceDirectory,workerArtifactDirectory} from './local-agent-source.ts';
import {ensurePreparedWorkflowWorker} from './prepared-workflow-worker.ts';
import {addNativeGoogleHostArtifact} from './native-google-host-artifact.ts';
import {verifyWorkerArtifact} from './workflow-worker-artifact.ts';
// The producer runs in this process; drop agent-detection variables before it can
// start turbo in the prepared source (see preparedSourceEnv).
const env=preparedSourceEnv(process.env);
for(const name of Object.keys(process.env))if(!(name in env))delete process.env[name];
const root=resolve(import.meta.dirname,'..'),source=sourceDirectory(root),output=workerArtifactDirectory(root);
execFileSync(process.env.ALPHA_NODE||'node',[join(root,'scripts/prepare-local-agent.ts'),'--source-only'],{cwd:root,stdio:'inherit'});
const result=await ensurePreparedWorkflowWorker(root,source,output);
// Reuse authenticates upstream worker bytes, not independently changing product host inputs.
// Always build the product host normally so its receipt binds the current source.
addNativeGoogleHostArtifact(root,output);
verifyWorkerArtifact(output);
// The build must leave the prepared source at the exact pinned commit.
execFileSync(process.env.ALPHA_NODE||'node',[join(root,'scripts/prepare-local-agent.ts'),'--source-only'],{cwd:root,stdio:'inherit'});
console.log(`${result.reused?'Reused verified':'Built'} worker dependency artifact: ${output}`);
