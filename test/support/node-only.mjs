// The few host tests that need a platform feature Bun 1.4.2 does not have. Under Bun they are
// skipped with the reason below; `bun run test:node` runs them on a real Node.js
// (scripts/run-node-only-tests.ts lists the files).
export const onBun = typeof process.versions.bun === 'string';

export const nodeOnly = reason => ({skip: onBun ? `needs Node.js: ${reason} (bun run test:node)` : false});
