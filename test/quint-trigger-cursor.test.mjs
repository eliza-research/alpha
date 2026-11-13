import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import {runTriggerCursorCase1,runTriggerCursorCase2,runTriggerCursorCase3} from '../specs/quint/refinement/services/trigger-cursor-replay.mjs';

test('the real trigger runtime follows every step of the model scenarios', {timeout: scaledTimeout(120000)}, async () => runTriggerCursorCase1(undefined));
test('the real trigger runtime follows random model walks step by step', {timeout: scaledTimeout(240000)}, async () => runTriggerCursorCase2(undefined));
test('a workflow that cannot be checked keeps its cursor only while its definition is unchanged', () => runTriggerCursorCase3(undefined));
