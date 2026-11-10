import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function browserArguments(raw: any = '[]', extra: any[] = [], exists: any = existsSync) {
  const specs = JSON.parse(raw);
  if (!Array.isArray(specs) || specs.some((path: any) => typeof path !== 'string' ||
      !/^test\/browser\/[A-Za-z0-9_/-]+\.spec\.ts$/.test(path) ||
      path.split('/').includes('..') || !exists(path))) throw new Error('Invalid selected browser spec');
  // Playwright CLI file arguments are regexes. Anchor escaped paths; never use a shell.
  const selectors = specs.map((path: any) => `(?:^|/)${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return ['run', 'test:browser', '--', ...selectors, ...extra];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = browserArguments(process.env.ALPHA_CI_BROWSER_SPECS, process.argv.slice(2));
  const result = spawnSync('npm', args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
