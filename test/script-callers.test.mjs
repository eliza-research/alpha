import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Every script must have a caller or a documented manual use, so removed flows do not leave orphans behind.
const root = path.resolve(import.meta.dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z', 'package.json', 'README.md', '.github', 'test', 'scripts', 'docs'], {cwd: root, encoding: 'utf8'}).split('\0').filter(file => file && fs.existsSync(path.join(root, file)));
const text = file => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return ''; } };
const callerFiles = tracked.filter(file => !file.startsWith('docs/evidence/') && !/^docs\/mvp-audit/.test(file) && !/\.(png|jpe?g|webp|zip|pyc)$/.test(file));
const scripts = tracked.filter(file => file.startsWith('scripts/') && !file.startsWith('scripts/owner/') && !file.includes('/__pycache__/'));

test('every script has a caller or a documented use', () => {
  const corpus = new Map(callerFiles.map(file => [file, text(file)]));
  const orphans = scripts.filter(script => {
    const name = path.basename(script), stem = name.replace(/(?:\.d)?\.[^.]+$/, '');
    // A fixture file is covered when its directory is named, a declaration file when its module is,
    // a Python module when it is imported, and a hyphenated name also without its extension.
    const directory = path.dirname(script).replace(/^scripts\//, '');
    const needles = [name, ...(name.endsWith('.d.mts') ? [`${stem}.mjs`] : []), ...(/(^|\/)fixtures(\/|$)/.test(directory) ? [directory] : [])];
    const named = stem.includes('-') ? new RegExp(`(?<![\\w.-])${stem}(?![\\w-])`) : null;
    const imported = name.endsWith('.py') && /^[a-z_][a-z0-9_]*$/.test(stem) ? new RegExp(`\\b(?:import|from)\\s+${stem}\\b`) : null;
    for (const [file, content] of corpus) {
      if (file === script) continue;
      if (needles.some(needle => content.includes(needle)) || named?.test(content) || imported?.test(content)) return false;
    }
    return true;
  });
  assert.deepEqual(orphans, [], 'Delete these scripts or reference them from package.json, README, .github, test/, another script or a docs/ page');
});
