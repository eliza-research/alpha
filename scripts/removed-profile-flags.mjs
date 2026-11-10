/** The build-time runtime profiles are gone: one build packages local speech and embeddings and
 * routes speech at run time. Dependency-free, so option parsers can refuse the old flags first. */
export const ONE_PROFILE_MESSAGE = 'There is one runtime profile now: remove --runtime-profile and --local-embeddings (local speech and embeddings always ship; speech is routed at run time).';
/** Fails with one line when a caller still passes a removed profile flag. */
export function refuseRemovedProfileFlags(args) {
  if (args.some(arg => typeof arg === 'string' && (arg === '--runtime-profile' || arg.startsWith('--runtime-profile=') || arg === '--local-embeddings')))
    throw new Error(ONE_PROFILE_MESSAGE);
}
