/** Product-owned renderer routes. The resident validates this host-supplied policy. */
const nativeViews = [
  ['photos', 'Photos'],
  ['maps', 'Maps'],
  ['camera', 'Camera'],
  ['notes', 'Notes'],
  ['calendar', 'Calendar'],
  ['inbox', 'Inbox'],
].map(([id, label]: any) => ({
  id,
  label,
  path: `/${id}`,
  fallbackFor: `@elizaos/plugin-${id}`,
}));

// The resident environment and APK asset use the same byte-exact representation.
export const nativeViewDeclarationsJson = JSON.stringify(nativeViews, null, 2) + '\n';

if (import.meta.main) process.stdout.write(nativeViewDeclarationsJson);
