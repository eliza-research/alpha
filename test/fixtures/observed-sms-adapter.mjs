import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {repositoryRoot} from '../../specs/quint/refinement/services/identity-comms-traces.mjs';

/** Read the actual held draft identities separately from the last sent receipt. This adds only
 * a closure observation; every adapter statement, native request and journal path still runs. */
export async function observedSmsAdapter(stubs) {
  const entries = Object.entries(stubs).map(([pattern, contents]) => [new RegExp(pattern), contents]);
  const bundled = await build({absWorkingDir: repositoryRoot,
    stdin: {contents: "export * from './apps/app/src/prototype/sms-adapter.ts'; export * from './apps/app/src/runtime/image-sms.ts';", resolveDir: repositoryRoot, loader: 'ts'},
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom', '@capacitor/core'],
    plugins: [{name: 'actual-sms-draft-observer', setup(builder) {
      builder.onResolve({filter: /.*/}, args => {
        const index = entries.findIndex(([pattern]) => pattern.test(args.path));
        return index < 0 ? undefined : {path: String(index), namespace: 'port'};
      });
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: entries[Number(args.path)][1], loader: 'js', resolveDir: repositoryRoot}));
      builder.onLoad({filter: /\/sms-adapter\.ts$/}, ({path}) => {
        const source = readFileSync(path, 'utf8'), marker = ' const sync=()=>{';
        assert.equal(source.split(marker).length, 2, 'one actual SMS draft-observation seam');
        return {loader: 'ts', contents: source.replace(marker,
          ' globalThis.__smsDraftProbe=()=>({operationId,mmsOperationId,sentId:sent?.id,mmsSentId:mmsSent?.id,active,body});\n' + marker)};
      });
    }}]});
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
