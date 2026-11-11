import test from 'node:test';
import {spawnSync} from 'node:child_process';
const {runApprovalDecisionCase1,runApprovalDecisionCase2}=await import('../specs/quint/refinement/services/approval-decision-replay.mjs');

test('the real workflow adapter follows every step of the approval model scenarios', {timeout: 120000}, async () => runApprovalDecisionCase1(undefined));
test('the real workflow adapter follows random approval model walks step by step', {timeout: 240000}, async () => runApprovalDecisionCase2(undefined));
