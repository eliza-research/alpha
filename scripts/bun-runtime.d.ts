// Bun 1.4.2 surface used by the pinned runtime producer scripts.
type RuntimeLoader = 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'jsonc' | 'toml' | 'yaml' | 'xml' | 'file' | 'napi' | 'wasm' | 'text' | 'css' | 'html';
type RuntimePluginFilter = {filter: RegExp; namespace?: string};

interface RuntimePluginBuilder {
  onLoad(filter: RuntimePluginFilter, load: (args: {path: string; loader: RuntimeLoader}) =>
    {contents: string | NodeJS.ArrayBufferView; loader?: RuntimeLoader; resolveDir?: string} | undefined): void;
  onResolve(filter: RuntimePluginFilter, resolve: (args: {path: string; importer: string}) => {path: string} | undefined): void;
}

interface RuntimeBuildPlugin {
  name: string;
  setup(builder: RuntimePluginBuilder): void;
}

interface RuntimeBuildOptions {
  entrypoints: string[];
  target?: 'bun';
  format?: 'esm';
  minify?: {syntax?: boolean};
  conditions?: string[];
  tsconfig?: string;
  metafile?: boolean;
  define?: Record<string, string>;
  plugins?: RuntimeBuildPlugin[];
}

declare var Bun: {
  version: string;
  revision: string;
  build(options: RuntimeBuildOptions): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: (Blob & {kind: 'entry-point' | 'chunk' | 'asset' | 'sourcemap' | 'bytecode'})[];
    metafile?: {inputs: Record<string, unknown>};
  }>;
  plugin(plugin: RuntimeBuildPlugin): void;
  resolveSync(specifier: string, from: string): string;
  write(path: string, contents: Blob): Promise<number>;
};
