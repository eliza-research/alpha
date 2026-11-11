import test from 'node:test';
import assert from 'node:assert/strict';
import {checkScanReviewDialogs} from '../specs/quint/refinement/services/scan-review-dialogs.mjs';
test('actual scan reviews refine bounded save, retry and uncertain-close schedules',async()=>{const r=await checkScanReviewDialogs();assert.equal(r.passed,true);assert.equal(r.driverInputsBound,true);assert.ok(r.traces>=6&&r.checkpoints>=30);});
test('scan source canary cannot repeat an unconfirmed Notes save',async()=>{await assert.rejects(checkScanReviewDialogs([],{mutant:'notes-unlatch'}),/An unconfirmed Notes save must remain one-shot/);});
