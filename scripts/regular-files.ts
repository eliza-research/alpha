import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Enumerate file entries without following symlinks. An absent root is empty. */
export function* regularFiles(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) yield* regularFiles(file);
    else if (entry.isFile()) yield file;
  }
}
