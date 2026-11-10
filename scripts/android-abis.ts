export const ANDROID_ABIS = Object.freeze(['arm64-v8a', 'x86_64'] as const);
/** Explicit ABI selection never relaxes the requested binary's integrity. */
export type AndroidAbi = (typeof ANDROID_ABIS)[number];
const isAndroidAbi = (value: unknown): value is AndroidAbi => value === 'arm64-v8a' || value === 'x86_64';

export function selectedAndroidAbis(requested: readonly string[] = ANDROID_ABIS): AndroidAbi[] {
  if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length || !requested.every(isAndroidAbi)) throw Error('Requested Android ABIs must be unique arm64-v8a or x86_64 values');
  return [...requested];
}
export function abiArguments(args: readonly string[]) {
  const rest: string[] = [], abis: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--abi') { rest.push(args[i]); continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('--abi requires a value');
    abis.push(args[++i]);
  }
  return {rest, abis: selectedAndroidAbis(abis.length ? abis : undefined)};
}
