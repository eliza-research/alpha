import fs from 'node:fs';
import path from 'node:path';
import {GATE_NAMES, qualificationGateProblems} from '../vendor/eliza/packages/os/scripts/android/pixel10a-release.mjs';
import {PIXEL10A_PRODUCT, PIXEL10A_RELEASE} from './aosp-pixel10a.mjs';

/** The distinct Pixel 10a distribution gates (issue #399), checked by the shared Pixel 10a release rules. */
export const PIXEL10A_GATES = 'android/aosp/pixel10a-qualification-gates.json';
export {GATE_NAMES};
const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

/**
 * Problems with Alpha's recorded gates, read from `root`. Each gate stands alone: 'passed'
 * needs release-level evidence of its own, development evidence never passes a gate, and the
 * record must agree with the source lock, product descriptor and update channel it summarizes.
 * The record and descriptor are Alpha's product (alpha_stallion_phone), never another brand's.
 * An empty list means the record is consistent, not that any gate passed.
 */
export function pixel10aGateProblems(root = process.cwd()) {
  let record, descriptor;
  try { record = readJson(root, PIXEL10A_GATES); } catch (error) { return [`${PIXEL10A_GATES} is unreadable: ${error.message}`]; }
  try { descriptor = readJson(root, PIXEL10A_PRODUCT); } catch (error) { return [`${PIXEL10A_PRODUCT} is unreadable: ${error.message}`]; }
  const problems = qualificationGateProblems(record, {root, file: PIXEL10A_GATES, descriptor, descriptorFile: PIXEL10A_PRODUCT});
  if (record?.product !== PIXEL10A_RELEASE.productName || descriptor?.product !== PIXEL10A_RELEASE.productName)
    problems.unshift(`${PIXEL10A_GATES}: the gates and ${PIXEL10A_PRODUCT} must record ${PIXEL10A_RELEASE.productName}`);
  return [...problems, ...alphaGateProblems(root, record)];
}

const BOOT_STATES = ['green', 'yellow', 'orange', 'red'];
const STATUSES = ['not run', 'development', 'failed', 'passed'];

/**
 * Alpha's rules beside the shared ones. physicalDevice records the unit's verified boot state:
 * P-70 pilot units are unlocked (orange) and give pilot-level evidence only, so the gate cannot
 * pass on one. unattendedUpdate (P-75) follows the shared status and evidence rules and cannot
 * pass while no update client exists in this repository.
 */
function alphaGateProblems(root, record) {
  const problems = [];
  const device = record?.gates?.physicalDevice;
  if (device) {
    const state = device.verifiedBootState;
    if (state !== undefined && !BOOT_STATES.includes(state)) problems.push(`${PIXEL10A_GATES}: physicalDevice verifiedBootState must be one of ${BOOT_STATES.join(', ')}`);
    if (device.status === 'passed' && !['green', 'yellow'].includes(state))
      problems.push(`${PIXEL10A_GATES}: physicalDevice cannot pass with verifiedBootState ${state ?? 'unrecorded'}: an unlocked (orange) pilot unit gives pilot-level evidence only (P-70)`);
  }
  const update = record?.alphaGates?.unattendedUpdate, at = `${PIXEL10A_GATES}: unattendedUpdate`;
  if (!update) return [...problems, `${at} is missing (P-75)`];
  if (!STATUSES.includes(update.status)) return [...problems, `${at} status must be one of ${STATUSES.join(', ')}`];
  if (!Array.isArray(update.evidence)) return [...problems, `${at} evidence must be a list`];
  for (const entry of update.evidence) {
    if (!['development', 'release'].includes(entry?.level)) problems.push(`${at} evidence level must be development or release`);
    if (typeof entry?.ref !== 'string' || !entry.ref) problems.push(`${at} evidence needs a ref`);
    else if (!/^https:\/\//.test(entry.ref) && !fs.existsSync(path.join(root, entry.ref))) problems.push(`${at} evidence ${entry.ref} is missing`);
  }
  if (update.status !== 'not run' && !update.evidence.length) problems.push(`${at} is "${update.status}" without evidence`);
  if (update.status === 'passed') {
    if (!update.evidence.some(entry => entry?.level === 'release')) problems.push(`${at} cannot pass on development evidence`);
    const client = typeof update.client === 'string' && update.client !== 'unset' && !path.isAbsolute(update.client) && !update.client.includes('..') ? update.client : null;
    if (!client || !fs.existsSync(path.join(root, client))) problems.push(`${at} cannot pass while no update client is recorded in this repository`);
  }
  return problems;
}
