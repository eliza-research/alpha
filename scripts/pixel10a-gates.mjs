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
  return problems;
}
