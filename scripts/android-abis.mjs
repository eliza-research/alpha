export const ANDROID_ABIS = Object.freeze(['arm64-v8a', 'x86_64']);
/** Explicit ABI selection never relaxes the requested binary's integrity. */
export function selectedAndroidAbis(requested = ANDROID_ABIS) {
  if (!Array.isArray(requested) || requested.length === 0 || new Set(requested).size !== requested.length || requested.some(abi => !ANDROID_ABIS.includes(abi))) throw Error('Requested Android ABIs must be unique arm64-v8a or x86_64 values');
  return [...requested];
}
export function abiArguments(args) {
  const rest = [], abis = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--abi') { rest.push(args[i]); continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('--abi requires a value');
    abis.push(args[++i]);
  }
  return {rest, abis: selectedAndroidAbis(abis.length ? abis : undefined)};
}
