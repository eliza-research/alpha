# notes-organize-agent.patch

Status: proposed upstream. No build uses this patch. It is not listed in
`native-manifest.json` (which admits Android sources only), and `prepare-client-features`
admits no TypeScript patch to these files. It takes effect only after it is merged upstream
and the pin in `upstream.lock.json` is bumped. Until then the phone code that uses it
(`apps/app/src/runtime/notes-organize-contract.ts`, `prototype/notes-organize-executor.ts`,
the `isNotesOrganizeOperation` branch in `prototype/agent-adapter.ts`) is inert: the shared
coordinator rejects an operation type it does not know, so `runtime/connection-ui.tsx` does not
yet offer `notes.organize.v1`; add it to the negotiated list (and to `config/alpha-product.json`
`features.capabilities`) in the pin bump that brings this patch.

Base: elizaOS/eliza `0594fc72da4450a84a986ad12e730e3faa902018` (the pin in
`upstream.lock.json`). Apply from the eliza repo root with `git apply`. The patch was first
written at `912f972e58`; every file it touches is byte-identical at both commits, so the
hunks are unchanged. It was regenerated and re-tested at `0594fc72da` on 2026-11-06.

## What it adds

Agent-side definitions for the phone Notes operations behind capability `notes.organize.v1`,
and, because Alpha now consumes the shared phone-side coordinator
(`client-coordinator.ts` through `.eliza/client-features`), the phone-side parsing, gating
and review cards for the same operations.

| Tool | Operation | Runs |
| --- | --- | --- |
| `DEVICE_NOTES_FILTER` | `notes_filter {text?, folder?, kind?}` | directly when the owner's current message asked for it, otherwise reviewed. Read-only; returns no note content |
| `DEVICE_NOTE_MOVE` | `notes_move {target, folder: name or null}` | reviewed |
| `DEVICE_NOTES_FOLDER_CREATE` | `notes_folder_create {name}` | reviewed |
| `DEVICE_NOTE_RESTORE` | `notes_restore {noteId}` | reviewed |
| `DEVICE_NOTES_RECORD` | `notes_record {action: start or stop}` | directly when the owner's current message asked for it, otherwise reviewed. Notes view only |

- `plugins/plugin-assistant/src/services/device-actions/notes-organize-contract.ts` (new,
  depends only on `notes-contract.ts`): types, `NOTES_ORGANIZE_CAPABILITY`,
  `NOTES_ORGANIZE_TYPES`, `NOTES_ORGANIZE_DIRECT_TYPES`, `isNotesOrganizeOperation`,
  `validateNotesOrganizeOperation`, `describeNotesOrganizeOperation`,
  `notesOrganizeContextAllowed`. Validation is the same as the phone's: unknown fields are
  rejected, text is at most 200 characters, folder names are at most 40 characters after
  whitespace is collapsed, kind must be text, list, voice or link, `notes_move` targets use
  `notesTarget`, and nothing is truncated.
- `contract.ts`: the operations are added to `DeviceOperation` and `validateDeviceOperation`.
  `deviceOperationSupportedByCapabilities` accepts them only when both `notes.organize.v1` and
  `notes.local-record.v1` are present.
- `action.ts`: schema branches and one guidance sentence. With no capabilities, the
  branches are hidden.
- `tools.ts`: the five tools above. Each tool's validate and handler require the capability.
- `service.ts`: adds the operations to the Notes record domain and the proposal allow-list,
  hides queued proposals when the capability is gone, and offers `notes.organize.v1` at
  enrollment.
- `effect-receipts.ts`: classifies the operations as non-read operations.
- `client-coordinator.ts` (the phone side): parses the operations and refuses them if the
  capability was not negotiated. Review is allowed only on Home or Notes (`notes_record` only
  in Notes). Builds the review card. Adds `notes_filter` and `notes_record` to
  `performRequested` direct types. Successful move, folder create and restore report a
  `notes` committed change.
- `packages/agent/src/api/device-action-routes.ts`: accepts and advertises
  `notes.organize.v1`. Without this change the route rejects a capability header that
  contains it.
- `test/device-actions.e2e.test.ts`: adds the capability to the expected enrollment list.

## How it was tested (2026-11-06, at `0594fc72da`)

`git -C vendor/eliza apply --check` passes on the pinned checkout. The tests ran in a scratch
`git archive` export of the pin (`plugins/plugin-assistant`, `plugins/plugin-calendar/src`,
`packages/contracts`, `packages/core/src` and the route), with the patch applied and no
monorepo install: `@elizaos/contracts` and `@elizaos/core` were linked to the exported
sources and third-party packages (zod, json5, yaml, markdown-it and its dependencies) were
copied from the local bun cache. None of that is part of the patch.

- Bun 1.3.14, `bun test --no-install --conditions eliza-source`:
  - `notes-organize-contract.test.ts` (new) and `client-coordinator.test.ts` (4 new organize
    tests): 50 pass, 0 fail.
  - The whole `device-actions/` folder: 97 pass, 2 fail. Both failures are modules the
    scratch export does not contain (`packages/agent/src/actions/views.ts`, the `adze`
    package), in tests the patch does not touch.

Not run: TypeScript over the patched files at this pin, the full plugin-assistant vitest
suite, the e2e tests (including the edited one), biome, and anything that needs a live agent
or a phone. (At `912f972e58` the earlier run also covered `tsc --noEmit` over the touched
files, with no new errors, and an out-of-tree check of `action.ts` and `tools.ts`.)
