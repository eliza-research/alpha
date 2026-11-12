import test from 'node:test';
import {spawnSync} from 'node:child_process';
const {runWorkflowLifecycleChangeCase1}=await import('../specs/quint/refinement/services/workflow-lifecycle-change-replay.mjs');

test('the real workflow adapter follows every step of the lifecycle model scenarios', {timeout: 240000}, async () => runWorkflowLifecycleChangeCase1(undefined));
