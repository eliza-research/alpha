import { pathToFileURL } from 'node:url';

// Aggregate needed-job results into one stable required status check.
// Each argument is name=result or name=result:selected. A selected job must
// succeed; an unselected job may be skipped; a job without a selection must succeed.
export function requiredResult(args: readonly string[]) {
  const failures: string[] = [];
  const rows = args.map(arg => {
    const match = /^([a-z][a-z0-9_-]*)=([a-z_]*)(?::(.*))?$/.exec(arg);
    if (!match) throw new Error(`Invalid job result argument ${JSON.stringify(arg)}`);
    const [, name, result, selection] = match;
    const selected = selection === undefined ? true : selection === 'true';
    const ok = result === 'success' || (!selected && result === 'skipped');
    if (!ok) failures.push(`${name}: ${result || 'missing'}${selected ? ' (selected)' : ''}`);
    return { name, result, selected, ok };
  });
  if (!rows.length) failures.push('no jobs were listed');
  return { ok: failures.length === 0, rows, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok, rows, failures } = requiredResult(process.argv.slice(2));
  for (const row of rows) console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.name}: ${row.result || 'missing'}${row.selected ? '' : ' (not selected)'}`);
  if (!ok) {
    console.error(`Required jobs did not pass: ${failures.join('; ')}`);
    process.exit(1);
  }
}
