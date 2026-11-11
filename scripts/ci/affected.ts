import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const referenceOnly = (path: string) => /^(docs\/|design\/)/.test(path) || /^(README\.md|AGENTS\.md|LICENSE|LICENSE\.md)$/.test(path);

// The retained product documentation is checked by test/docs-links.test.mjs.
// Policy inputs under scripts/ remain executable build inputs and select normal lanes.
export const testReadReference = (path: string) => path === 'README.md' || path === 'docs/development.md' || path === 'docs/prd.md';

// Android files that browser specs read; test/ci-affected.test.mjs scans test/browser to keep this complete.
export const browserReadAndroid = new Set([
  'android/app/src/androidTest/java/ai/alphacompute/alphaphone/StartupDocumentProbe.java',
  'android/video-fixture/src/main/assets/qa-source.mp4',
]);

// Unknown paths run everything. Only explicitly non-executable reference data is ignored.
export function affected(paths: readonly string[]) {
  const result = { verify: false, browser: false, android: false, prepare: false };
  for (const path of paths) {
    if (referenceOnly(path)) {
      if (testReadReference(path)) result.verify = true;
      continue;
    }
    result.verify = true;
    if (/^specs\/quint\//.test(path) || /^scripts\/(check-quint|quint-lib)\.ts$/.test(path)) {
      // Formal models change no APK or browser bytes; the promotion workflow checks them.
    } else if (/^test\/browser\//.test(path) || path === 'playwright.config.ts' || path === 'scripts/storage-specs.ts') {
      result.browser = true;
    } else if (/^test\//.test(path)) {
      // Host contract tests run in verify, not in an emulator.
    } else if (path === '.github/workflows/browser.yml') {
      result.browser = true;
    } else if (path === '.github/workflows/android.yml') {
      result.android = true;
    } else if (path === '.github/workflows/resident-prepare.yml') {
      result.prepare = true;
    } else if (/^\.github\/workflows\/(resident-android|android-emulator)\.yml$/.test(path)) {
      // Explicit qualification/diagnostics; resident push/nightly runs are opt-in by repository variable,
      // and the emulator evidence workflow has no trigger but a dispatch.
    } else if (browserReadAndroid.has(path)) {
      result.browser = result.android = true;
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

export function browserPlan(paths: readonly string[], exists: (path: string) => boolean = existsSync) {
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
    browser_speech: !narrow || development.some(path => /\/(browser-(agent-tts|host-disclosure)|host-reminder-recovery)\.spec\.ts$/.test(path)),
  };
}

export function changedPaths(base: string, head: string, git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })) {
  for (const sha of [base, head]) if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected full base and head commit IDs');
  // --no-renames reports both sides, so moving executable input into docs cannot hide it.
  return git('diff', '--no-renames', '--name-only', '-z', base, head, '--').split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
    GITHUB_SHA: sha, GITHUB_EVENT_NAME: eventName } = process.env;
  if (!eventPath || !output || !summary) throw Error('Expected a GitHub Actions event and output paths');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  let result;
  let paths: string[] = [];
  // Manual and scheduled runs have no diff; they select every lane.
  if (['workflow_dispatch', 'schedule'].includes(eventName ?? '')) {
    result = { verify: true, browser: true, android: true, prepare: true };
  } else {
    try {
      let base = event.before;
      let head = sha;
      if (event.pull_request) {
        head = event.pull_request.head.sha;
        base = execFileSync('git', ['merge-base', event.pull_request.base.sha, head], { encoding: 'utf8' }).trim();
      }
      if (!head) throw Error('Missing head commit');
      paths = changedPaths(base, head);
      result = affected(paths);
    } catch (error) {
      console.warn(`Cannot establish complete diff; running all checks: ${error instanceof Error ? error.message : String(error)}`);
      result = { verify: true, browser: true, android: true, prepare: true };
    }
  }
  Object.assign(result, browserPlan(paths));
  for (const [key, value] of Object.entries(result)) appendFileSync(output, `${key}=${value}\n`);
  appendFileSync(summary, `### Change selection\n\n${paths.length} changed paths. Missing diff, manual or scheduled run selects all lanes.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
}
