import test from 'node:test';
const {runWorkflowLifecycleChangeCase1, runWorkflowLifecycleChangeWalks}=await import('../specs/quint/refinement/services/workflow-lifecycle-change-replay.mjs');

test('the real workflow adapter follows every step of the lifecycle model scenarios', {timeout: 240000}, async () => runWorkflowLifecycleChangeCase1(undefined));

test('the real workflow adapter follows random lifecycle model walks step by step', {timeout: 280000}, async () => runWorkflowLifecycleChangeWalks());
