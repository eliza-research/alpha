import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkWorkflowExecutionAuditAdmission} from '../specs/quint/refinement/services/workflow-execution-audit-admission.mjs';

// The existing renderer fixture imports the application's extensionless TS graph.

const own = fileURLToPath(import.meta.url);
test('workflow admission audit observes actual protocol, journal and renderer recovery', {timeout: 180000}, async () => {
  const {receipt} = await checkWorkflowExecutionAuditAdmission([own]);
  assert.equal(receipt.passed, true);assert.equal(receipt.inputsUnchanged, true);assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 6);assert.equal(receipt.checkpoints, 48);
  assert.deepEqual(receipt.observedFields, ['s.intentSaved', 's.ownerReview', 's.phase', 's.ranVersion']);
  for (const action of ['validate', 'save', 'retainSubmission', 'serverAdmit', 'receipt', 'unknownSubmission', 'restart', 'reconcile', 'resend', 'clearRequest', 'versionMismatch'])
    assert.ok(receipt.actions[action] > 0, action);
});

for (const [name, rewrite, expected] of [
  ['resend dispatch bypasses its owner review', source => source.replace('if(request){if(!reviewResend){', 'if(request){if(false&&!reviewResend){'), /Retained resend requires owner confirmation/],
  ['legacy clear bypasses its owner review', source => source.replace('if(stuck){if(!reviewClear){', 'if(stuck){if(false&&!reviewClear){'), /Removing a retained legacy request requires owner confirmation/],
]) test('admission audit rejects actual-source mutation: ' + name, {timeout: 180000}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-workflow-audit-canary-'));
  try {
    await assert.rejects(checkWorkflowExecutionAuditAdmission([own], {rewrite, out: join(directory, 'receipt.json')}), expected);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
