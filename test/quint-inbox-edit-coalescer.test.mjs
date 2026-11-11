import test from 'node:test';
import {runInboxEditCoalescerCase1,runInboxEditCoalescerCase2,runInboxEditCoalescerCase3} from '../specs/quint/refinement/services/inbox-edit-coalescer-replay.mjs';

test('the real edit coalescer follows every step of the model scenarios', () => runInboxEditCoalescerCase1(undefined));
test('the real edit coalescer follows random model walks step by step', {timeout: 120000}, () => runInboxEditCoalescerCase2(undefined));
test('an armed timer is the only way a waiting copy is written without a caller', () => runInboxEditCoalescerCase3(undefined));
