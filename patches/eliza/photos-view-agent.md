# photos-view-agent.patch

Status: proposed upstream. No build uses this patch. It is not listed in
`native-manifest.json` (which admits Android sources only), and `prepare-client-features`
admits no TypeScript patch to these files. It takes effect only after it is merged upstream
and the pin in `upstream.lock.json` is bumped. Until then the phone code that uses it
(`apps/app/src/runtime/photos-view-contract.ts` and the `isPhotosViewOperation` branch in
`prototype/agent-adapter.ts`) is inert: the shared coordinator rejects an operation type it does
not know, and the pinned agent route rejects a capability header that names `photos.library.v1`
or `photos.view.v1`, so `runtime/connection-ui.tsx` does not yet offer them. Add both to the
negotiated list (and to `config/alpha-product.json` `features.capabilities`) in the pin bump that
brings this patch.

Base: elizaOS/eliza `0594fc72da4450a84a986ad12e730e3faa902018` (the pin in
`upstream.lock.json`). Apply from the eliza repo root with `git apply`. Written and tested at
`0594fc72da` on 2026-11-06.

## What it adds

Agent-side definitions for the Photos view operations (design/view-refresh-2026-11/PLAN.md
section 2, "Agent tools") behind a new capability `photos.view.v1`, and, because Alpha consumes
the shared phone-side coordinator (`client-coordinator.ts` through `.eliza/client-features`), the
phone-side parsing, gating and review cards for the same operations. Every operation is accepted
only when both `photos.library.v1` and `photos.view.v1` were negotiated.

| Tool | Operation | Runs | Result |
| --- | --- | --- | --- |
| `DEVICE_PHOTOS_FILTER` | `photos_filter {from?, to?, kind?: image or video, favorite?, album?: favorites, videos, camera, screenshots or custom:<id>, text?}` | directly when the owner's current message asked for it, otherwise reviewed. Read-only: narrows the Photos grid behind a clearable chip | `{kind, shown, more}` |
| `DEVICE_PHOTOS_OPEN` | `photos_open {id}` | directly when the owner's current message asked for it, otherwise reviewed. Opens one item in the Photos viewer; nothing changed or shared | `{kind, opened}` |
| `DEVICE_PHOTOS_ALBUM_CREATE` | `photos_album_create {name, ids}` | reviewed: the owner confirms the name and items in Photos | `{kind, status: review_opened, count, missing}` |
| `DEVICE_PHOTOS_SHARE` | `photos_share {ids}` | reviewed: the owner confirms in Photos, then Android's share sheet opens (the system sheet is the second confirmation; nothing leaves the phone before the owner picks a target) | `{kind, status: review_opened, count, missing}` |

- `plugins/plugin-assistant/src/services/device-actions/photos-view-contract.ts` (new,
  depends only on `photo-library-contract.ts`): types, `PHOTOS_VIEW_CAPABILITY`,
  `PHOTOS_VIEW_TYPES`, `PHOTOS_VIEW_DIRECT_TYPES`, `PHOTOS_FILTER_ALBUMS`,
  `isPhotosViewOperation`, `photosViewCapabilityAvailable`, `validatePhotosViewOperation`,
  `describePhotosViewOperation` (owner-facing text names the app through an `appName` argument,
  like `describeLibraryOperation`), `photosViewContextAllowed` and `validatePhotosViewResult`.
  Validation is the same as the earlier phone implementation: unknown fields are rejected;
  `from`/`to` are non-negative safe integers (ms) with `from <= to`; `text` is at most
  `LIBRARY_LIMITS.query` (80) characters with no control characters; `album` is one of the four
  keys or matches `/^custom:[A-Za-z0-9_-]{1,80}$/`; album names are 1 to 80 characters after
  trimming with no control characters; album ids are 1 to `LIBRARY_LIMITS.kept` (2000) distinct
  library ids, share ids 1 to 100. Nothing is truncated. Results are exact: `shown` is an integer
  of at least 0; album and share results need `count >= 1` and `count + missing === ids.length`.
- `contract.ts`: the operations are added to `DeviceOperation` and `validateDeviceOperation`.
  `deviceOperationSupportedByCapabilities` accepts them only when both capabilities are present.
- `action.ts`: schema branches and one guidance sentence. With no capabilities, the branches
  are hidden. A retried request returns the validated historical Photos result.
- `tools.ts`: the four tools above, in the `media` and `general` contexts. Each tool's validate
  and handler require both capabilities.
- `service.ts`: adds the operations to the proposal allow-list, hides queued proposals when the
  capability is gone, refuses claim, receipt and reconciliation without both capabilities,
  validates receipt and reconciliation results with `validatePhotosViewResult`, and offers
  `photos.library.v1` and `photos.view.v1` at enrollment. Photos has no record domain in
  `deviceAppRecordOperationAvailable` (that fence is Notes/Calendar only), so none is added.
- `effect-receipts.ts`: an applied Photos operation becomes a `noop` effect receipt with a
  reason. Filter and open change only what Photos shows. Album create (a data change) and share
  (an outward share) report only that the owner review opened; neither receipt claims a created
  album or a share. The exhaustive classification lists filter and open as reads, album create
  and share as non-reads.
- `client-coordinator.ts` (the phone side): parses the operations and refuses them if both
  capabilities were not negotiated ("Photos actions were not negotiated with this agent").
  Review and direct runs are allowed only while Photos is open on the unlocked phone. Builds the
  review card. Adds `photos_filter` and `photos_open` to `performRequested` direct types. The
  result travels in the existing `photoLibraryResult` field (widened to
  `LibraryAgentResult | PhotosViewResult`), is validated before the receipt is sent, and is
  re-validated from the journal. No committed change is reported: an album or share result is
  an opened review, not a saved change.
- Wording: the redesign removes the "Device library" album, so the shared copy no longer says
  "Photos > Device library". `proposalContextNotice` for a library operation now says "Open
  Photos to review this action."; `describeLibraryOperation` for `photo_library_select` says
  "Nothing is changed or shared." and for `photo_library_review` says "You confirm it in Photos,
  then in Android." followed by the action detail.
- `packages/agent/src/api/device-action-routes.ts`: accepts and advertises
  `photos.library.v1` and `photos.view.v1`. At the pin the route accepts neither, so without
  this change a phone could not negotiate them at all.
- `test/device-actions.e2e.test.ts`: adds both capabilities to the expected enrollment list.

At the pin the `photo_library_*` operations exist only in the phone-side coordinator: there is
no agent tool, `contract.ts` branch or route capability for them. This patch does not add
those. The agent therefore has library ids only when the phone has supplied them; the tool
descriptions say to use only ids the phone returned and never guess them.

## How it was tested (2026-11-06, at `0594fc72da`)

`git -C vendor/eliza apply --check` passes on the pinned checkout. The tests ran in a scratch
`git archive` export of the pin (`plugins/plugin-assistant`, `plugins/plugin-calendar`,
`packages/contracts`, `packages/core/src` and the route), with the patch applied and no
monorepo install: `@elizaos/contracts` and `@elizaos/core` were linked to the exported
sources and third-party packages (zod, json5, yaml, markdown-it and its dependencies,
`@types/node`) were copied from the local bun cache. None of that is part of the patch.

- Bun 1.3.14, `bun test --no-install --conditions eliza-source`:
  - `photos-view-contract.test.ts` (new, 11 tests), `client-coordinator.test.ts` (5 new Photos
    tests) and `photo-library-contract.test.ts`: 59 pass, 0 fail.
  - The whole `device-actions/` folder: 97 pass, 2 fail. Both failures are modules the scratch
    export does not contain (`packages/agent/src/actions/views.ts`, the `adze` package), in
    tests the patch does not touch.
- TypeScript 6.0.3 `tsc --noEmit` (strict, bundler resolution, `eliza-source` condition) over
  `photos-view-contract.ts`, `contract.ts`, `effect-receipts.ts`, `client-coordinator.ts`,
  `tools.ts`, `action.ts` and `service.ts`: no errors in the touched files. The 10 reported
  errors are all unresolved modules in untouched files that the export does not contain (`adze`,
  `file-type`, `uuid`, `@elizaos/plugin-sql`, `@elizaos/host/protocol`, `plugin-notes`,
  markdown-it types).
- Biome 2.5.15 format over the touched files (the pin's `biome.json` formatter settings; the
  untouched originals format without changes).
- Phone mirror: `node --test test/photos-view-contract.test.mjs` (Node 24.15.0): 7 pass;
  `npm run --ignore-scripts typecheck` in the product passes.

Not run: the full plugin-assistant vitest suite, the e2e tests (including the edited one), the
route's own tests, biome lint, tsc over the test files and the route, and anything that needs a
live agent or a phone.
