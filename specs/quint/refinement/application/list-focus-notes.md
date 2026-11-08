# Historical list-focus source refinement

This evidence belongs to pre-reconciliation commit `796880e9eca39e13d69a38e2376e0907083bfaab`. Current main removed the helper and its callers. The retained model now lives under the legacy family and does not claim current renderer coverage. Current `dc-lite`/React list identity requires separate source traces.


`ListFocus` models the shared Notes/Photos focus helper independently of the shell's view navigation. It retains two simultaneous capture closures, their source `committed` and `moved` fields, listener lifetime, ref callback generations, and the FIFO microtasks created by capture and commit. Five DOM nodes represent an original row, its replacement, a duplicate candidate, another list owner and a keyless control. The generation bound is eight and does not wrap.

The source adapter executes the real helper in JSDOM. Its only source instrumentation inserts a read-only getter for the existing `root` and `revision` closure variables. The returned capture objects are observed directly. The queue and listener ports retain and execute the source callbacks. DOM nodes, focus events, disconnection, disabled controls, inert/hidden attributes and dialogs are real JSDOM objects. Geometric visibility is a controlled port because JSDOM has no layout engine. Each trace binds source, driver and checker hashes before execution and compares them afterward. [Historical model](../../legacy/ListFocus.qnt)

The separate Notes/Photos Chromium cases execute the real renderer and list producers. They cover a durable Notes insertion that moves an item between columns, removal and deliberate focus movement, inactive-view updates, actual browser-photo import/readback, and fixture-only movement between date groups. Their JSON observations retain concrete row IDs, remembered intent, owner/view, visible unique restoration candidate, removal and other-control focus state, and actual opened record identity. The fixture photo transition is a renderer exercise. It does not establish MediaStore behavior. The historical browser cases lived at `test/browser/notes-photos-list-focus.spec.ts` in that commit.

These checks provide bounded implementation evidence. They do not establish unbounded event-loop liveness, all browser focus-engine behaviors, arbitrary simultaneous render closures or native accessibility acceptance. Checklist and voice-action durable-row identities remain a separate open migration.

## Historical checked evidence

- All 18 model scenarios passed on Quint 0.33.1.
- The actual-helper adapter passed 24 source traces with 180 checkpoints. All 15 top-level state fields, including both nested capture records, were compared with Quint. Source, driver and checker hashes were unchanged.
- Seed `20261107` completed 1,000 model simulations of 80 steps without a safety violation.
- Apalache 0.62.4 completed bounded symbolic checking through depth four without a safety violation. This is bounded safety evidence.
- The adjacent Chromium accessibility suite passed all 44 cases. The helper's Node suite and adjacent renderer/media/source checks passed all 40 cases. TypeScript checking passed.

The model SHA-256 for this evidence is `12ed5326f8e6c063514ca6de877e55d6a9e49f7679a51d07d7463f95a4b20457`. The helper source SHA-256 is `ae78d853c5e77cd977d80b9250f502e7df33f52260071eee762ff78b48b23ff7`.
