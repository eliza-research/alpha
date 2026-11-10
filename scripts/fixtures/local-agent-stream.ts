import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = new URL('../../apps/app/src/runtime/local-agent-stream.ts', import.meta.url);

/** Bundle the actual stream parser so Node tests can run its renderer dependency graph. */
export async function loadLocalAgentStream(hostRoot = fileURLToPath(new URL('../../', import.meta.url))): Promise<typeof import('../../apps/app/src/runtime/local-agent-stream.ts')> {
  const { build }: typeof import('esbuild') = createRequire(path.join(hostRoot, 'package.json'))('esbuild');
  const compiled = await build({
    stdin: { contents: readFileSync(entry, 'utf8'), loader: 'ts', resolveDir: path.join(hostRoot, 'apps/app/src/runtime') },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
}
