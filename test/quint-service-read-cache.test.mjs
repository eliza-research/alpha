import test from 'node:test';
import {runServiceReadCacheCase1,runServiceReadCacheCase2,runServiceReadCacheCase3} from '../specs/quint/refinement/services/service-read-cache-replay.mjs';

test('the real read cache and its store binding follow every step of the model scenarios', {timeout: 120000}, async t => runServiceReadCacheCase1(t));
test('the real read cache and its store binding follow random model walks step by step', {timeout: 240000}, async t => runServiceReadCacheCase2(t));
test('a document keeps its newest entries within the entry bound', async () => runServiceReadCacheCase3(undefined));
