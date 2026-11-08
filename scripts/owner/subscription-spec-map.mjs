#!/usr/bin/env node
/**
 * Reviewer table for test/browser/native-cloud-subscription.spec.ts (issues #659 and #660).
 *
 *   node scripts/owner/subscription-spec-map.mjs [--results PLAYWRIGHT_LIST_LOG] [--json]
 *
 * Static and read-only: it parses the spec source, runs nothing and changes nothing. For each
 * case it reports the boot fixture, the flow that fixture boots and the account/plan element the
 * case waits for. `--results` joins a saved `playwright test --reporter=list` log so failing cases
 * are marked. Every case's `boot()` asserts planFlags {native:'android', mocks:false}, which makes
 * `residentCloudFlow()` in apps/app/src/runtime/connection-ui.tsx true: all cases boot the
 * resident flow. Which account surface renders then depends on the entry the case uses
 * (connection-ui.tsx render branches near lines 3003-3004):
 *  - cloud-account entry (connectionController.openCloudAccount(): Settings > Accounts > "Manage
 *    Cloud account", Inbox "Connect", the voice adapter, cloud-voice.ts). The purpose 'cloud-account'
 *    branch has no residentCloudFlow() guard: any signed-in account gets the "Membership & credits"
 *    sheet (data-alpha-membership-sheet) whatever its balance; signed out it is the sign-in screen.
 *  - plan entry (planController.openPlan(), the plan notice). On the resident flow the sheet is
 *    forced only for a "zero" membership balance (fundingRequired); otherwise the resident dialog
 *    titled "Your agent" / "Eliza Cloud account" / "Eliza Cloud account & plan" is rendered.
 * This is source review data; it is not a browser run, APK, emulator, image or device result.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SPEC = 'test/browser/native-cloud-subscription.spec.ts';

/** Helper or literal in a case body -> the element that case waits for. */
export const EXPECTATIONS = Object.freeze([
 {token: /\bneedsPlan\(/, element: 'region "Eliza Cloud plan notice" beside the running agent, then dialog "Eliza Cloud account & plan" (resident panel)'},
 {token: /\bsheet\(page\)|name:'Eliza Cloud account & plan'/, element: 'dialog "Eliza Cloud account & plan" (resident panel carrying the membership controls)'},
 {token: /\bopenAccountPlan\(|\baccountPanel\(|\bplanDetails\(/, element: 'dialog /^Eliza Cloud account( & plan)?$/ (resident plan panel)'},
 {token: /\bsignInPage\(/, element: '.alpha-cloud-sign-in[role=main] (resident first-run sign-in page)'},
 {token: /Membership (&amp;|&) credits|alpha-membership-title|data-alpha-membership/, element: 'dialog "Membership & credits" (membership sheet)'},
 {token: /\bopenCloudAccount\(|Manage Cloud account|Connect Eliza Cloud|Close Cloud account|cloud-account-title/, element: 'dialog "Membership & credits" via the cloud-account entry (any signed-in balance; sign-in screen when signed out)'},
 {token: /Review billing account/, element: 'dialog "Review billing account" (billing handoff review)'},
 {token: /\bstarted\(/, element: 'Agent.start called (resident always runs, P-43)'},
]);

/** Test cases of a Playwright spec source: line, title, describe, boot fixture text and body. */
export function parseCases(source) {
 const lines = source.split('\n');
 const starts = [];
 const helpers = new Map();
 let describe = '', helper = null;
 const bootOf = text => { const boot = text.match(/\bboot\(page,?\s*([^;]*?)\);/); return boot ? boot[1].trim() || '{}' : null; };
 lines.forEach((line, index) => {
  const group = line.match(/test\.describe\((['`])(.*?)\1/);
  if (group) describe = group[2];
  const fn = line.match(/^\s{0,1}async function (\w+)\(page/);
  if (fn) helper = fn[1];
  else if (/^\s{0,1}(test\(|test\.|for\s*\(|\}\)|\/\*\*|const |async function|function )/.test(line) && !/^\s{0,1}const \w+=\(page/.test(line)) helper = null;
  if (helper && bootOf(line) && !helpers.has(helper) && helper !== 'boot') helpers.set(helper, bootOf(line));
  const match = line.match(/(?:^|[\s)])test\((['`])((?:\\.|(?!\1).)*)\1/);
  if (match) starts.push({line: index + 1, title: match[2], describe: line.match(/^test\(/) ? '' : describe});
 });
 // A case body ends at the next case or at the next top-level/describe-level declaration.
 const boundary = /^\s{0,1}(test\.describe|test\.beforeEach|test\.afterEach|async function |function |\/\/ |\/\*\*)/;
 return starts.map((start, i) => {
  const next = i + 1 < starts.length ? starts[i + 1].line - 1 : lines.length;
  let end = next;
  for (let at = start.line; at < next; at++) if (boundary.test(lines[at])) { end = at; break; }
  const body = lines.slice(start.line - 1, end).join('\n');
  let boot = bootOf(body);
  if (boot === null) for (const [name, shared] of helpers) if (new RegExp(`\\b${name}\\(page`).test(body)) { boot = shared; break; }
  return {...start, end, loop: /\$\{/.test(start.title), boot, body};
 });
}

/** Fixture facts that decide which surface the guard renders. */
export function fixtureFacts(boot) {
 if (boot === null) return {account: 'unknown', plan: 'unknown'};
 const pick = (key, fallback) => {
  const match = boot.match(new RegExp(`\\b${key}:\\s*'([^']+)'`));
  return match ? match[1] : fallback;
 };
 const saved = !/\bsaved:\s*false\b/.test(boot);
 const identity = pick('identity', 'ok');
 const route = pick('route', 'signed');
 const plan = pick('plan', 'active');
 const limits = pick('limits', 'absent');
 const cash = boot.match(/\bcashBalance:\s*(\d+)/);
 const account = !saved ? 'signed out' : identity === 'ok' ? 'verified' : `identity ${identity}`;
 return {account, route, plan, limits, cashBalance: cash ? Number(cash[1]) : 0, fullApp: /\bfullApp:\s*true\b/.test(boot)};
}

/** Which account entry a case body opens: 'cloud-account', 'plan', 'both' or 'none'. */
export function entryOf(body) {
 const cloud = /\bopenCloudAccount\(|Manage Cloud account|Connect Eliza Cloud|Close Cloud account/.test(body);
 const plan = /\bopenPlan\(|\bopenAccountPlan\(|\baccountPanel\(|\bneedsPlan\(|\bplanDetails\(|\bsheet\(page\)/.test(body);
 return cloud && plan ? 'both' : cloud ? 'cloud-account' : plan ? 'plan' : 'none';
}

/** The surface the resident flow would render for these facts and this entry, as source reasoning. */
export function predictedSurface(facts, entry = 'plan') {
 const cloudSurface = facts.account === 'verified'
  ? 'sheet "Membership & credits" (cloud-account entry: no resident guard, any signed-in balance)'
  : 'sign-in screen (cloud-account entry, no account yet)';
 // Plan entry: credits come from /api/v1/billing/limits v2.balance (organizationCreditFromLimits);
 // the spec's billing-limits fixture carries no v2.balance, so the credit state is "unavailable",
 // never "zero", and the zero-balance (fundingRequired) branch cannot force the sheet.
 const planSurface = facts.account === 'verified'
  ? 'resident dialog (plan entry; balance cannot be "zero" with this fixture, so the sheet is not forced)'
  : 'resident dialog (sign-in required or offline; no account yet)';
 if (entry === 'cloud-account') return cloudSurface;
 if (entry === 'both') return `${planSurface}; ${cloudSurface}`;
 return planSurface;
}

/** Failing titles from a `--reporter=list` log ("✘ … › title" lines). */
export function failingTitles(log) {
 const failed = new Set();
 for (const line of log.split('\n')) {
  const match = line.match(/^\s*(?:✘|x|\d+\)\s.*?)\s*.*?native-cloud-subscription\.spec\.ts:(\d+):\d+\s›\s(.+?)(?:\s\(\d+(?:\.\d+)?m?s\))?$/);
  if (match && /✘|^\s*x\s|\d+\)/.test(line)) failed.add(`${match[1]}|${match[2].split(' › ').pop().trim()}`);
 }
 return failed;
}

export function mapSpec(source, log = null) {
 const failed = log ? failingTitles(log) : null;
 return parseCases(source).map(item => {
  const facts = fixtureFacts(item.boot);
  const expects = EXPECTATIONS.filter(rule => rule.token.test(item.body)).map(rule => rule.element);
  const failures = failed ? [...failed].filter(key => Number(key.split('|')[0]) === item.line).map(key => key.split('|')[1]) : null;
  return {line: item.line, describe: item.describe, title: item.title, loop: item.loop, boot: item.boot, flow: 'resident (Android, test mocks off)', facts, entry: entryOf(item.body), surface: predictedSurface(facts, entryOf(item.body)), expects, failed: failures};
 });
}

function table(rows) {
 const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
 const out = ['| Line | Case | Boot fixture | Flow | Account | Entry | Expects | Failed |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
 for (const row of rows) out.push(`| ${row.line} | ${cell(row.title)} | ${row.boot === null ? '(none found)' : `\`${cell(row.boot)}\``} | ${row.flow} | ${cell(row.facts.account)} | ${row.entry} | ${cell(row.expects.join('; ') || 'calls only')} | ${row.failed === null ? 'not run' : row.failed.length ? `yes (${row.failed.length})` : 'no'} |`);
 return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const args = process.argv.slice(2);
 const json = args.includes('--json');
 const resultsIndex = args.indexOf('--results');
 const known = new Set(['--json', '--results']);
 if (args.some((arg, i) => arg.startsWith('--') ? !known.has(arg) : i !== resultsIndex + 1) || (resultsIndex >= 0 && !args[resultsIndex + 1])) {
  console.error('Usage: node scripts/owner/subscription-spec-map.mjs [--results PLAYWRIGHT_LIST_LOG] [--json]');
  process.exit(2);
 }
 const root = fileURLToPath(new URL('../../', import.meta.url));
 const rows = mapSpec(fs.readFileSync(path.join(root, SPEC), 'utf8'), resultsIndex >= 0 ? fs.readFileSync(args[resultsIndex + 1], 'utf8') : null);
 console.log(json ? JSON.stringify(rows.map(({...row}) => row), null, 1) : table(rows));
}
