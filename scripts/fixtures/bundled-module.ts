import { build } from 'esbuild';

/** Run actual renderer code in Node with explicit module replacements. */
export async function bundledFixture<T>(entry: string, mocks: Readonly<Record<string, string>> = {}): Promise<T> {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [{
      name: 'fixture-module-replacements',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({path}) => {
          const key = Object.hasOwn(mocks, path) ? path : path.split('/').at(-1);
          if (key && Object.hasOwn(mocks, key)) return {path: key, namespace: 'fixture'};
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path}) => ({
          contents: mocks[path],
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

/** Restore any prior globals even if the fixture fails. */
export function installFixtureGlobals(values: Record<string, unknown>): () => void {
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(values)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, writable: true, configurable: true});
  }
  return () => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}
