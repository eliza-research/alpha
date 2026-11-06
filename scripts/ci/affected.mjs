import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const referenceOnly = path => /^(docs\/|design\/)/.test(path) || /^(README\.md|AGENTS\.md|LICENSE|LICENSE\.md)$/.test(path);

// Reference data that node tests read, so a change to it must run repository verification
// (never a browser, Android or prepare lane). Derived from `grep -o 'docs/[^ ]*' test/*.test.mjs`:
// every docs/*.json (requirements, dependency-audit dispositions and snapshot, the
// mvp-remaining-work inventory), and every Markdown file test/docs-links.test.mjs scans,
// which is README.md and docs/**/*.md outside docs/market-research/. That set includes
// ci-cost-policy.md (embedded ruleset), core-loop-audit.md, decisions.md and the inventories.
export const testReadReference = path =>
  /^docs\/.*\.json$/.test(path) ||
  (/^docs\/.*\.md$/.test(path) && !/^docs\/market-research\//.test(path)) ||
  path === 'README.md';

// Unknown paths run everything. Only explicitly non-executable reference data is ignored.
export function affected(paths) {
  const result = { verify: false, browser: false, android: false, prepare: false };
  for (const path of paths) {
    if (referenceOnly(path)) {
      if (testReadReference(path)) result.verify = true;
      continue;
    }
    result.verify = true;
    if (/^test\/browser\//.test(path) || path === 'playwright.config.ts' || path === 'scripts/storage-specs.mjs') {
      result.browser = true;
    } else if (/^test\//.test(path)) {
      // Host contract tests run in verify, not in an emulator.
    } else if (path === '.github/workflows/browser.yml') {
      result.browser = true;
    } else if (path === '.github/workflows/android.yml') {
      result.android = true;
    } else if (path === '.github/workflows/resident-prepare.yml') {
      result.prepare = true;
    } else if (/^\.github\/workflows\/(resident-android|bun-spawn-seccomp|android-emulator|digest-restart|dependency-audit)\.yml$/.test(path)) {
      // Explicit qualification/diagnostics; resident push/nightly runs are opt-in by repository variable,
      // and the emulator evidence and digest process-recovery workflows have no trigger but a dispatch.
      // The advisory audit is scheduled and dispatched only; its script and test run in verify.
    } else if (/^android\//.test(path)) {
      result.android = true;
    } else if (/^apps\/app\//.test(path)) {
      result.browser = true;
      result.android = true; // Renderer bytes are shipped inside every APK.
    } else {
      result.browser = result.android = result.prepare = true;
    }
  }
  return result;
}

// Restrict only an existing-spec-only diff. Renames/deletions, helpers, app inputs,
// manual runs and unavailable diffs all retain the complete browser inventory.
// Must match productionSpec in playwright.config.ts.
export const productionSpec = /(production-surface|\.production)\.spec\.ts$/;
export const selectableSpec = /^test\/browser\/[A-Za-z0-9_/-]+(\.production)?\.spec\.ts$/;

export function browserPlan(paths, exists = existsSync) {
  const changed = paths.filter(path => !referenceOnly(path));
  const narrow = changed.length > 0 && changed.every(path => selectableSpec.test(path) && exists(path));
  const specs = narrow ? [...new Set(changed)].sort() : [];
  const development = specs.filter(path => !productionSpec.test(path));
  const shards = narrow && development.length <= 3 ? [1] : [1, 2, 3, 4, 5, 6];
  return {
    browser_specs: JSON.stringify(development),
    browser_shards: JSON.stringify(shards),
    browser_total: shards.length,
    browser_development: !narrow || development.length > 0,
    browser_production: !narrow || specs.some(path => productionSpec.test(path)),
    browser_speech: !narrow || development.some(path => /\/(browser-(agent-recording|agent-tts|host-disclosure)|host-reminder-recovery)\.spec\.ts$/.test(path)),
  };
}

export function changedPaths(base, head, git = (...args) => execFileSync('git', args, { encoding: 'utf8' })) {
  for (const sha of [base, head]) if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected full base and head commit IDs');
  // --no-renames reports both sides, so moving executable input into docs cannot hide it.
  return git('diff', '--no-renames', '--name-only', '-z', base, head, '--').split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let result;
  let paths = [];
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    result = { verify: true, browser: true, android: true, prepare: true };
  } else {
    try {
      let base = event.before;
      let head = process.env.GITHUB_SHA;
      if (event.pull_request) {
        head = event.pull_request.head.sha;
        base = execFileSync('git', ['merge-base', event.pull_request.base.sha, head], { encoding: 'utf8' }).trim();
      }
      paths = changedPaths(base, head);
      result = affected(paths);
    } catch (error) {
      console.warn(`Cannot establish complete diff; running all checks: ${error.message}`);
      result = { verify: true, browser: true, android: true, prepare: true };
    }
  }
  Object.assign(result, browserPlan(paths));
  for (const [key, value] of Object.entries(result)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Change selection\n\n${paths.length} changed paths. Missing diff or manual run selects all lanes.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
}
