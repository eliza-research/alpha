#!/usr/bin/env bun
// Audits a built web bundle (web-dist or an APK's extracted assets/public) for mock,
// fixture and developer surfaces. Usage:
//   bun scripts/audit-production-bundle.ts <dir> [--expect-test-mocks]
// The denylist is skipped only when the bundle's build-flags.json records testMocks:true.
import {readFileSync,statSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fontLicenceFindings, fontLicenceLine} from './font-license-blockers.ts';
import {licenceFlagLines} from './licence-policy.ts';
import {assetLinksProblems} from './render-assetlinks.ts';
import {regularFiles} from './regular-files.ts';
import {SHIPPED_CLOUD_DEPLOYMENT,CLOUD_DEPLOYMENT_IS_CANDIDATE,CLOUD_SIGN_IN_REGISTRATION} from './cloud-deployment-policy.ts';
import {STORAGE_NAMESPACES} from './cloud-deployment.ts';

/** The staging Cloud's authorities, return page and tenant, from the deployment policy: test-mocks builds only. */
export const STAGING_CLOUD_TEXT = Object.freeze([new URL(SHIPPED_CLOUD_DEPLOYMENT.staging.api).host, new URL(SHIPPED_CLOUD_DEPLOYMENT.staging.services).host,
  new URL(SHIPPED_CLOUD_DEPLOYMENT.staging.web).host + CLOUD_SIGN_IN_REGISTRATION.callbackPath.replace(/\/auth\/callback$/, ''),
  // The former 'cloud-staging' entry also caught the staging tenant name.
  SHIPPED_CLOUD_DEPLOYMENT.staging.tenant]);

/** Decision P-43: production copy that offered or described a "no agent" state. */
export const RETIRED_NO_AGENT_TEXT = Object.freeze(['without AI', 'Continue offline', 'continue offline', 'Connect an agent']);
/** Decision P-43 (#381): fallback copy that implied a remote agent. Production has none; the resident
 * runs on the phone. Test-mocks builds keep the remote development path and are not denied. */
export const RETIRED_REMOTE_AGENT_TEXT = Object.freeze(['Connect your remote agent', 'No remote agent connected', 'Connect a remote agent']);
/** AP-03: the remote pairing protocol and its owner copy. Saved remote credentials are left untouched;
 * no product path reads or pairs them. */
export const RETIRED_PAIRING_TEXT = Object.freeze(['pairing_identity_mismatch', 'This agent is not accepting pairing', 'The agent refused this pairing code']);
/** AP-03/P-22: the Cloud sign-in hand-off (CloudProtocol.login). Product sign-in is the native in-app host. */
export const RETIRED_SIGN_IN_HAND_OFF_TEXT = Object.freeze(['/api/auth/cli-session', '/auth/cli-login', 'Finish signing in to', 'Use the newly opened browser tab']);
/** App review #855 (PROD-02/03/04): toasts and labels of the simulated prototype that answered a tap
 * with a stand-in. They exist only behind the test-mocks build flag; a product bundle that holds one
 * means a simulated handler stopped folding away. No entry may contain another denylist entry. */
export const SIMULATED_STUB_TEXT = Object.freeze([
  'in this preview', 'is taking notes', 'Voice input is not connected', 'Scene description is not connected',
  'for you (confirmed)', 'Not booked.', 'Workflow execution is not connected', 'Booking is not connected',
  'Read-aloud is not connected', 'Messages are not connected', 'Inbox is not connected',
]);
export const DENYLIST = Object.freeze([
  'Connect remote agent', 'Agent HTTPS address', 'Development Cloud agent infrastructure', 'Dedicated hosting requires a reviewed setup',
  'alpha:force-render-error', 'alpha:render-error-check', 'Forced render failure',
  'Enter mock mode', 'Try mock mode', 'Exit mock mode', 'mock-mode-banner', 'Mock mode ·',
  '10.0.2.2:2138', ...STAGING_CLOUD_TEXT,
  'alpha-dev-tools', 'Development connections', 'Development card', 'Device controls',
  'Browser development device', 'Development reply', '__alpha-local-agent', '__alpha-browser-cloud',
  'emulator development agent', 'Simulate Clock request',
  // The development agent's missing-provider reply (REPLY_FAILURES, test mocks only).
  'Set one up on the agent',
  'Maya Chen', 'Jordan Park', 'Priya Nair', 'Alex Kim', 'you@gmail.example', 'Ritual Coffee',
  'news.example', 'Design review at', 'Unlock for details',
  // Fixture-only Wallet/Settings effects and the desktop development rail must
  // fold away at the build flag boundary, even when their views are hidden.
  'Kitchen Speaker', '4000 1234 5678 9017', 'Card scanned', 'Simulated payment',
  'Memory wiped', 'Logs saved to Downloads', 'Up to date',
  'This page is a visual prototype', 'Pixel 11 Pro', 'Powered by elizaOS ·',
  'data-alpha-development-lock-screen', 'Booked · ', 'Agent booking',
  'Development vault secret', 'synthetic-dev-',
  ...SIMULATED_STUB_TEXT,
  // The simulated password provider (browser/password-provider.ts) reaches a bundle only if
  // browserDevProfile stops constant-folding to false; these catch that regression.
  'demo-only-password', 'Development password provider', 'Add development provider', 'Proton Pass · development',
  // The plain-HTTP Maps emulator gateway (maps/regional-provider.ts, testMocks builds only).
  '10.0.2.2:47850', '127.0.0.1:47850',
  // Decision P-43 (owner, 2026-10-13): the resident agent is always present. The retired
  // no-agent choices and empty states must not reach a production bundle.
  ...RETIRED_NO_AGENT_TEXT,
  // Subscription gate QA (test-mocks builds only).
  'gate QA', 'resident-qa.v1',
  // Owner-provided keys are a product feature. The older developer-only dialog remains gated.
  'A new key takes effect after the agent restarts.',
  // Hosted and paired agents (#406): the agent always runs on the phone. Remote pairing, Cloud agent
  // discovery, personal/Dedicated setup and the hosted phone protocol are development fixtures only.
  '/api/auth/pair', 'Pair this agent before connecting', 'Choose an endpoint serving one agent', 'Pair the agent again',
  '/api/v1/eliza/agents', 'personalElizaId', 'dedicated-always', 'personal Cloud agent', 'cloud-runtime:',
  'X-Eliza-Phone-Protocol', 'x-eliza-phone-protocol', 'Connect your own remote agent',
  ...RETIRED_REMOTE_AGENT_TEXT,
  // Remote pairing (AP-03): RemoteProtocol.pair and its refusal copy are development-only.
  ...RETIRED_PAIRING_TEXT,
  // In-app Eliza Cloud sign-in (owner directive 2026-10-14): the native host is the one product
  // sign-in path. The diagnostic button, the staging return host and the Cloud sign-in hand-off
  // (cli-session, the hosted cli-login page and its browser waiting copy) are test-mocks only.
  'Browser sign-in (diagnostic)',
  ...RETIRED_SIGN_IN_HAND_OFF_TEXT,
  // Upstream test sign-in (elizaOS/eliza#39519 moved it out of shipped code): the Playwright auth
  // marker cookie, its synthetic user, the test session route and the local test account button.
  'eliza-test-auth', 'local-live-test-user@agent.local', '/api/test/auth/session', 'Continue with local test account',
  'Browser calendar (development)',
  // The read-only OS update-channel check is registered off; its About row is development only.
  'Update channel (development)',
  // Internal project scope is never user copy (owner decision 2026-10-30): unavailable apps and
  // actions say they are not available on this phone yet.
  'deferred from the MVP',
]);
const TEXT = /\.(?:html?|js|mjs|cjs|css|json|txt|svg|xml|webmanifest)$/i;

// Owner rule: on-device speech and inference use only the native llama.cpp-based libelizainference
// stack. No model or runtime of the removed in-browser and Sherpa engines may ship in any bundle,
// with or without test mocks. The tokens are spelled in pieces so the repository-wide search
// (test/llama-cpp-only.test.mjs) finds no literal outside its own allow-list.
const OX = 'on' + 'nx';
export const FORBIDDEN_ENGINE_PATH = new RegExp(`\\.${OX}$|${OX}runtime|ort-wasm|sher${'pa'}|k2${'fsa'}|(?:^|/)browser-speech/`, 'i');
// Each token holds a character outside base64, so embedded data URIs cannot match by chance.
export const FORBIDDEN_ENGINE_TEXT = Object.freeze([`${OX}runtime-`, `${OX}runtime/`, `${OX}runtime.`, 'ort-wasm', `sher${'pa'}-${OX}`, `com.k2${'fsa'}`]);
const FORBIDDEN_MODEL_REFERENCE = new RegExp(`[\\w/-]\\.${OX}\\b`);
/** Every forbidden inference-engine path or string in a bundle file. Binary files are checked by path only. */
interface Finding {
  file: string;
  rule: string;
}

export function engineFindings(file: string, text?: string) {
  const findings: Finding[] = [];
  if (FORBIDDEN_ENGINE_PATH.test(file)) findings.push({file, rule: `forbidden inference engine file (${OX.toUpperCase()}/Sherpa)`});
  if (text !== undefined) {
    for (const token of FORBIDDEN_ENGINE_TEXT) if (text.includes(token)) findings.push({file, rule: `forbidden inference engine reference "${token}"`});
    if (FORBIDDEN_MODEL_REFERENCE.test(text)) findings.push({file, rule: `forbidden model reference "*.${OX}"`});
  }
  return findings;
}

// Hard-coded avatar initials: a small round badge span whose whole text is two capital
// letters or a "+N" overflow count, written into markup instead of rendered from data.
// Matches the raw markup and its JSON-escaped form inside a bundled ?raw template.
// Every such badge fails, including the prototype's former MC, JP and +2 (platform-20).
export const AVATAR_INITIALS = /border-radius:\s*1[0-9]px;[^<>]{0,400}?\\?"\s*>\s*([A-Z]{2}|\+\d{1,2})\s*<\/span>/g;
export function avatarInitials(text: string) {
  return [...text.matchAll(AVATAR_INITIALS)].map(match => match[1]);
}

/** Reads {"testMocks": boolean}. A missing or malformed record is treated as a production bundle. */
export function readBuildFlags(dir: string) {
  const file = path.join(dir, 'build-flags.json');
  if (!existsSync(file)) return {present: false, testMocks: false, candidateCloud: false};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return {present: true, testMocks: value?.testMocks === true, candidateCloud: value?.candidateCloud === true, valid: typeof value?.testMocks === 'boolean' && (value.candidateCloud === undefined || typeof value.candidateCloud === 'boolean')};
  } catch { return {present: true, testMocks: false, candidateCloud: false, valid: false}; }
}

interface BundleAuditOptions {
  testMocks?: boolean;
  debugFingerprints?: readonly string[];
}

export function auditWebBundle(dir: string, options: BundleAuditOptions = {}) {
  const errors: string[] = [];
  const engine: Finding[] = [];
  const policy: Finding[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return {ok: false, testMocks: false, files: 0, findings: [], errors: [`Bundle directory not found: ${dir}`]};
  const flags = readBuildFlags(dir);
  const expected = options.testMocks === true;
  if (!flags.present) errors.push('build-flags.json is missing; the bundle cannot prove how it was built.');
  else if (flags.valid === false) errors.push('build-flags.json is malformed.');
  if (flags.present && flags.testMocks !== expected) errors.push(`build-flags.json records testMocks:${flags.testMocks}, expected ${expected}.`);
  if (!existsSync(path.join(dir, 'index.html'))) errors.push('index.html is missing.');
  // A candidate Cloud (ALPHA_CLOUD_DEPLOYMENT_FILE) is for development and rehearsal; distributed builds use the shipped policy.
  if (!expected && (flags.candidateCloud || CLOUD_DEPLOYMENT_IS_CANDIDATE)) errors.push('This build addresses a candidate Cloud deployment (ALPHA_CLOUD_DEPLOYMENT_FILE); a production bundle must use the shipped Cloud deployment policy.');
  let files = 0;
  // Only an explicitly requested and recorded mock build skips the denylist.
  const skip = expected && flags.testMocks;
  for (const source of regularFiles(dir)) {
    files++;
    const file = path.relative(dir, source).split(path.sep).join('/');
    const text = TEXT.test(file) ? readFileSync(source, 'utf8') : undefined;
    engine.push(...engineFindings(file, text));
    if (skip) continue;
    if (file === 'img' || file.startsWith('img/')) policy.push({file, rule: 'fixture image directory img/'});
    if (file.endsWith('.map')) policy.push({file, rule: 'source map'});
    if (text === undefined) continue;
    if (/\.[cm]?js$/i.test(file)) {
      for (const [, fingerprint] of text.matchAll(/cloud-deployment:([a-f0-9]{64}):/g)) {
        if (fingerprint !== STORAGE_NAMESPACES.at(-1)) {
          policy.push({file, rule: 'candidate Cloud deployment credential namespace'});
          break;
        }
      }
    }
    for (const entry of DENYLIST) if (text.includes(entry)) policy.push({file, rule: entry});
    for (const initials of avatarInitials(text)) policy.push({file, rule: `hard-coded avatar initials "${initials}"`});
    if (path.posix.basename(file) === 'assetlinks.json')
      for (const problem of assetLinksProblems(text, {debugFingerprints: options.debugFingerprints ?? []})) policy.push({file, rule: problem});
  }
  const findings = [...engine, ...policy];
  return {ok: errors.length === 0 && findings.length === 0, testMocks: flags.testMocks, files, findings, errors};
}

function main(argv: string[]) {
  const args = argv.filter(arg => !arg.startsWith('--'));
  const flags = argv.filter(arg => arg.startsWith('--'));
  const unknown = flags.filter(flag => flag !== '--expect-test-mocks');
  if (args.length !== 1 || unknown.length) {
    console.error('Usage: bun scripts/audit-production-bundle.ts <dir> [--expect-test-mocks]');
    return 2;
  }
  const dir = path.resolve(args[0]);
  const result = auditWebBundle(dir, {testMocks: flags.includes('--expect-test-mocks')});
  for (const error of result.errors) console.error(`ERROR ${error}`);
  for (const finding of result.findings) console.error(`DENY ${finding.file}: ${finding.rule}`);
  // Licence flags of the bundle's own notices are warnings (decision P-09); they never fail the audit.
  try { for (const line of licenceFlagLines(JSON.parse(readFileSync(path.join(dir, 'licenses', 'third-party-notices.json'), 'utf8')))) console.warn(line); }
  catch { /* a bundle without readable notices is reported by the APK checks, not here */ }
  // The one separately named font check. Reported, never failed here: a developer build may carry it.
  if (existsSync(dir)) { const fonts = fontLicenceFindings(dir); for (const row of [...fonts.unresolved, ...fonts.resolved]) console.warn(fontLicenceLine(row.message)); }
  if (result.ok) console.log(`PASS ${path.relative(process.cwd(), dir) || '.'}: ${result.files} files, testMocks=${result.testMocks}${result.testMocks ? ' (denylist skipped for an explicit test-mocks bundle)' : ', no audited mock, fixture or developer markers found'}.`);
  else console.error(`FAIL ${result.findings.length} denylist hit(s), ${result.errors.length} error(s).`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
