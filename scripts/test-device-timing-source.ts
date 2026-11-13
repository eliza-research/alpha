#!/usr/bin/env bun
// Authenticated HTTP, real approval service, and disk-backed SQL over pinned source.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {statSync} from 'node:fs';
import {sourceDirectory} from './local-agent-source.ts';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
const root=resolve(import.meta.dirname,'..');
execFileSync(process.execPath,['scripts/prepare-local-agent.ts','--source-only'],{cwd:root,stdio:'inherit'});
const source=sourceDirectory(root),runner=resolve(source,'node_modules/vitest/vitest.mjs');
if(!statSync(runner,{throwIfNoEntry:false})?.isFile())throw Error('Install admitted runtime dependencies before device-action qualification');
execFileSync(process.execPath,['--conditions=eliza-source',runner,'run','--config','vitest.device-actions.config.ts','--maxWorkers=1','--fileParallelism=false'],{
 cwd:resolve(source,'plugins/plugin-assistant'),stdio:'inherit',timeout:scaledTimeout(540000),
});
console.log('PASS admitted-source authenticated HTTP and durable device-action lifecycle; no Android or live-provider acceptance');
