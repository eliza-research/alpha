# Function verification

`bun run lemma:check` checks the pinned LemmaScript 0.6.6 generation against the
committed proof companions, then runs Dafny 4.11.0. `bun run lemma:regen` updates
generation after an intentional source/specification change. Review and commit
both companions. `lemmascript.json` selects JavaScript UTF-16 string semantics;
these initial policies use no mathematical-number approximation or extern axiom.

The first admitted production function is `residentBootStateLost` in
`apps/app/src/runtime/resident-recovery.ts`. Its contract classifies exactly
`dead`, `restarting` and `booting` as invalidating the renderer's resident binding.
The existing wrapper still handles a missing native snapshot. Native status
delivery, lifecycle timing and recovery effects are outside this function proof.

The source list is `LemmaScript-files.txt`. Missing or differently versioned Dafny
records `skipped-no-qualified-backend`, never a passing proof. The promotion
workflow sets `LEMMA_REQUIRE_BACKEND=1`, so missing qualification fails it. Receipts
under `test-results/lemma/check.json` bind the source, lockfile, configuration,
generated companions and checker output. A changed generated artifact fails the
check even when the compiler would otherwise refresh it in place.

The original audit's deletion, layout, launcher and route-policy targets mostly
now live upstream. Annotate and review them upstream before advancing the consumer
pin; do not edit `vendor/eliza` or `.eliza/client-features` to increase proof counts.
This initial function proof does not complete issue #856's full adoption wave or
establish Android, AOSP, provider or physical-device acceptance.


## Expanded audit targets

The root inventory now also registers the audit’s additional annotated production functions. Existing `residentBootStateLost` remains the canonical resident proof. Committed companions retain JavaScript UTF-16 semantics and exact LemmaScript 0.6.6 / Dafny 4.11.0 admission. Receipts bind every source, proof companion, inventory, configuration and checker byte before and after verification. Annotation extraction and trust counters are checked for every target; source assumptions and proof axioms are refused.

# LemmaScript proofs

[LemmaScript](https://www.npmjs.com/package/lemmascript) (`lsc`, version 0.6.6) reads contracts
written as `//@` comments inside TypeScript functions, translates each annotated function to
[Dafny](https://dafny.org), and asks Dafny to prove that the function body meets its contract for
every input. The annotations are comments: they do not change what the app does.

The proofs here cover small pure decision functions in `apps/app/src`. The list of proved files is
`/LemmaScript-files.txt`; the Dafny text is under ``, mirroring the source path.

## What a proof establishes

For a function marked `//@ verify`, Dafny proves that for all inputs satisfying the `//@ requires`
lines, the translated body returns a value satisfying every `//@ ensures` line, every loop
terminates, and every array index is in range. Extra lemmas written by hand in the `.dfy` file are
proved about the same translated function.

## What a proof does not establish

- **Numbers are mathematical.** A TypeScript `number` is modelled as an unbounded integer, or as a
  mathematical real where the source says `//@ type x real`. Floating-point rounding, `NaN`,
  `Infinity`, `-0`, non-integer values passed to an integer-modelled parameter and integers beyond
  2^53 are outside the model. `Math.floor(a / b)` is integer floor division.
- **The translation is trusted.** The proof is about the Dafny text LemmaScript generates, so the
  LemmaScript translator, Dafny and Z3 are trusted. `**/*.dfy.gen` is that text.
- **Per function, not per program.** Only the annotated function is proved. Its callers are not
  checked: nothing proves that a caller meets the `requires` lines, passes the facts the parameters
  are named after, or uses the result. Where a decision was extracted from a larger function (for
  example `resolveCloudEnvironmentCore`, `startupPermissionsActiveCore`, `admitVideoChunk`), the
  surrounding function that gathers the inputs and performs the effects is covered by its unit
  tests only.
- **Separate from the Quint models.** `specs/quint` models state machines over many steps and
  checks them by bounded simulation and model checking against a hand-written model of the code.
  A LemmaScript proof is about one call of one real function for all inputs. Neither implies the
  other. A few hand-written lemmas restate a Quint property for a single function (named in the
  table); they do not connect the two tools mechanically.
- **Externs and overrides are assumptions.** `//@ extern` gives a helper a contract without a
  body, `//@ type` and `//@ declare-type` replace a TypeScript type with a stated one, and
  `//@ skip` leaves a declaration out of the model. Each is part of the trust boundary and is
  counted per file in the receipt under `trust`. The current proofs use no extern, no `havoc` and
  no assumption; the overrides and skips in use are listed in the table. `//@ assume` in a source
  and `assume`, `{:axiom}` or `{:verify false}` in a `.dfy` file are refused by the check.
- **Strings and collections** follow LemmaScript's models: a string is a sequence of characters, a
  string-literal union returned by a function is a string, an array is an immutable sequence, a
  `Set` is a mathematical set, and `x | undefined` or `x | null` is an option.

## Install the backend

The check needs two tools.

1. **LemmaScript 0.6.6.** It is an exact devDependency installed by `bun install --frozen-lockfile`; the checker verifies that installed package version before generation. The npm package named `lsc` is unrelated; do not
   run bare `bunx lsc`. `lsc` also needs `git` on `PATH`.
2. **Dafny 4.11.0** (proofs were checked with 4.11.0). Download the release archive for your
   platform from <https://github.com/dafny-lang/dafny/releases/tag/v4.11.0> and unpack it; it
   includes Z3. Either put the unpacked directory on `PATH` or set `DAFNY` to the `dafny`
   executable. Any other Dafny version is treated as no backend.

Dafny 4.11.0 is built for the .NET 8 runtime. On a machine that has only a newer .NET runtime it
runs with `DOTNET_ROLL_FORWARD=LatestMajor`; `scripts/check-lemma.ts` sets that variable itself
when it is unset. Set it yourself when calling `dafny` or `lsc` directly.

## Run

From the repository root:

```sh
export PATH="<dafny dir>:$PATH"
bun scripts/check-lemma.ts                                  # every listed file
node node_modules/lemmascript/tools/dist/lsc.js check --backend=dafny apps/app/src/browser/video-capture.ts # focused diagnosis; the gate checks every listed file
bun test test/lemma-check.test.mjs                         # tests of the check itself
```

For each listed file the script checks that every contract annotation is read by LemmaScript, that
the committed `.dfy.gen` equals a fresh generation, that the `.dfy` is the generated text plus
additions only, and that Dafny reports zero errors. A proof is the line
`proof verified (N verified, 0 errors)` for the file together with `check-lemma: passed` and exit
code 0. The receipt is `test-results/lemma/check.json` (not committed). A plain run never rewrites
tracked files.

An annotation that nothing reads is an error: a `//@` line in a file under `apps/app/src` that is
not in the list, a listed file with no `//@ verify` function, or a contract line that does not
appear in `lsc extract` output.

### When Dafny is missing

Without a Dafny 4.11.0 the annotation and staleness checks still run, but no proof is checked.
The script prints a warning, records status `skipped-no-backend` and exits 0. That is not a pass
and must not be reported as one. `LEMMA_REQUIRE_BACKEND=1` turns the skip into exit code 2; use it
wherever the proofs are meant to gate. Without `lsc` the check fails.

Exit codes: 0 passed or skipped, 1 failed, 2 backend required but missing, or bad usage.

## Add a function

1. Pick a pure function inside the LemmaScript subset (see `SUBSET.md` in the package). If the
   decision sits inside a function that uses regular expressions, `Date`, JSON, the DOM or
   promises, extract the decision into a small exported function that the original calls, and run
   the existing tests for that file.
2. Put `//@ verify` as the first line of the body, then `//@ requires` and `//@ ensures` lines
   (`\result`, `==>`, `<==>`, `===`, `forall(k, P)`, `exists(k, P)`). A loop takes `//@ invariant`
   and `//@ decreases` as the first lines of its body. Only functions with `//@ verify` are
   translated.
3. Add the source path as a line in `/LemmaScript-files.txt`
   (`path [timeout seconds] [extra dafny flags]`).
4. Run `node node_modules/lemmascript/tools/dist/lsc.js regen --backend=dafny --no-verify <path>`. This regenerates
   `<path>.dfy.gen`, creates or three-way merges `<path>.dfy`, then runs the normal
   check. Repeat after every change to the source or its annotations.
5. Write any helper lemmas in the `.dfy` file, below or between the generated lines. Never edit a
   generated line.
6. Commit the source, the list, the `.dfy.gen` and the `.dfy`, and add the function to the table
   below.

Things that do not translate: an inline object type on a parameter (name it with a `type` alias),
`a / b` on integers (use `Math.floor(a / b)`, or declare the values `real`), `**`, `Math.round`,
`toFixed`, `Number.isFinite`. A function with a loop becomes a Dafny `method`, which cannot be
named in another contract; give it its own `ensures` lines or a pure specification function in the
`.dfy`.

## Verified functions

All paths are under `apps/app/src`. "None" in the last column means no extern, type override or
skip in that file; the general limits above still apply. The count is Dafny's number of verified
obligations for the file (run of 2026-11-10, LemmaScript 0.6.6, Dafny 4.11.0).

| File (verified) | Function | Properties proved | Trusted assumptions |
| --- | --- | --- | --- |
| `browser/browser-poll.ts` (3) | `surfaceIdleForView` | True exactly when the view is not the browser and the last geometry equals the hidden geometry. | None |
| | `retryDelayForCount` | Result is between 2000 and 60000; 2000 for a count of at most 1; 60000 from count 6; never decreases as the count grows; the recursion terminates. | |
| `browser/edit-receipt.ts` (2) | `editReceiptAbandoned` | True exactly when the status is `prepared` and more than 86400000 ms have passed since `at` (0 when absent); never true for a settled record. | None |
| | `editReceiptSettled` | True exactly for `saved`, `failed`, `cancelled`, `unchanged`. | |
| `browser/journal-retention.ts` (16) | `journalRowRetires` | A row retires exactly when it is older than the newest `KEEP` rows by position or older than `AGE`; a row without a time retires by position only. Hand-written `RetireJournalPassBound`: after one pass over all rows at most `KEEP` survive, and every survivor is among the newest `KEEP` and within `AGE`. | None |
| | `deletionSettled` | True exactly for `deleted`, `undone`, `conflict`; false for `queued` and `paused`. | |
| | `settledDeletionsToTrim` | For `terminal >= 0` the result is `max(0, terminal - SETTLED)`, so at most `SETTLED` settled rows remain and nothing is trimmed below that. | |
| `browser/notifications.ts` (24) | `noticeRoute` | Result is one of six routes; `focus` exactly for ids starting `focus:`; `workflow`, `hosted`, `external`, `calendar` only for the matching source or id prefix; hosted, external and own-workflow notices always get their route. | `//@ type live Set<string>`: the `ReadonlySet` parameter of `retainDismissed` is modelled as a mathematical set. |
| | `retainDismissed` | For `limit >= 0`: result length is at most `limit`; an input within the limit is returned unchanged; the result equals the hand-written `RetainSpec`. Lemmas about `RetainSpec`: it is a subsequence of the input (order kept, nothing invented); while the live marks fit, only the oldest gone marks are removed, exactly as many as needed, and every live mark is kept; when live marks alone exceed the limit the newest `limit` live marks are kept. | |
| `browser/video-capture.ts` (2) | `admitVideoChunk` | For `chunk >= 0` and `bytes <= max`: the kept byte count never exceeds `max` and never decreases; a chunk is kept exactly when it fits; recording stops exactly when the total reaches or would pass `max`; a refused chunk always stops. | None |
| `browser/video-edit.ts` (7) | `videoEditValid` | True exactly when duration is in (0, 300], `0 <= start`, `end <= duration + 0.05`, the cut is at least `0.1 - tolerance` long and rotation is 0, 90, 180 or 270. | `//@ type ... real` on `start`, `end`, `duration`, `tolerance`, `reached` and the result of `videoDurationReached` (8 overrides): seconds are mathematical reals, not doubles. |
| | `videoClockParts` | For `tenths >= 0`: `minutes * 600 + remainder === tenths` with `0 <= remainder < 600`. | |
| | `videoDurationReached` | Result is at least 0.001 and, unless it is that floor, at most `end - start`; exact value in each of the cases unknown or past the end, before the start, and in between. | |
| `browser/workflow-triggers.ts` (11) | `placeChanged` | True exactly when both keys are known and differ. Hand-written: irreflexive and symmetric. | None |
| | `cursorThrough` | Never moves backwards, never passes `max(old, now)`, advances at most one day per call, and is either `now` or `old` plus one day when `now >= old`. Hand-written (property of `TriggerCursor.qnt` for this function): repeated calls stay monotone and reach `now` after `ceil((now - old) / day)` calls, then stay there. | |
| | `triggerTickPlan` | Nothing runs in the background; scan runs exactly when foreground and not blocked; dispatch exactly when foreground and not held. Hand-written: a blocked scan does not stop dispatch and a held dispatch does not stop a scan. | |
| `prototype/calendar-days.ts` (6) | `firstCalendarDayOf` | `day - 1` for three or more visible days, otherwise `day`. | None |
| | `visibleCalendarDaysOf` | For `count >= 1`: returns `count` consecutive, strictly increasing days starting at the first day, and contains `day`. | |
| | `calendarReturnDayOf` | Returns `day` or `eventDay`; `day` exactly when the event is already visible; the event is visible from the result; applying it again changes nothing. | |
| | `weekDayMarked` | True exactly for a visible offset other than the selected day and other than 0; never true for a single-day view. | |
| `prototype/chat-overlay-motion-adapter.ts` (9) | `flickSpan` | `run` is in [0, 100]; `run === 0` implies `rise === 0`; an empty track, a stale last sample or no earlier sample gives `run === 0`; a positive run is the time and height difference between the last sample and some sample of the track. | None. `(full - floor) / 3` in `chatRelease` is modelled as exact real division. |
| | `clampSheetHeight` | For `0 < half <= full`: result is at most `full`, at least `min(200, half)`, and equals the input when that is within [200, full]. | |
| | `chatRelease` | For `floor <= full`: result is `hidden`, `input`, `sheet` or `full`; with `home` set the result is never `hidden`, and `input` is returned only with `home` set; from the input row a downward release hides (on Home it settles on `input`) and an upward one never hides; a flick from the sheet goes to `full` (up) or to `hidden` (down; `input` on Home); a height is returned only with `sheet`, equals the released height, and lies strictly between floor and full outside both snap zones; a release well inside the range always yields a sheet with that height. | |
| `prototype/context-selection.ts` (17) | `noticeCurrent` | False for a missing or empty list; true exactly when the reviewed identity (id and source) is listed once and that row has the reviewed revision; two rows with the identity make it false (hand-written `CurrentSound`, `CurrentComplete`, `CurrentRejectsDuplicates`). | `//@ skip` on four module-level `RegExp` constants (`OPAQUE`, `SETTINGS_SECTION`, `SENSITIVE_SETTINGS`, `MIME_TYPE`); no proved function reads them. |
| | `captureUnchanged` | False when the capture is gone; true for an identical record; when true, the trashed flag matches and the mutation revision (or, without one, the revision) matches; a differing content revision makes it false. | |
| `prototype/note-recorder.ts` (4) | `recordingClockParts` | `total` is the whole seconds of `ms` (0 for negative input); `h * 3600 + m * 60 + s === total` with `m` and `s` in [0, 60). | None |
| `prototype/settings-adapter.ts` (12) | `updateCheckDue` | True exactly when the clock went backwards or the interval has elapsed. | `//@ skip` on `declare const __APP_VERSION__` (a build-time constant with no value); no proved function reads it. |
| | `updateIdle` | True exactly when all fourteen idle facts hold (voice inactive and off, home with no view, not typing, chat resting, no editor, drawer, shade, menu, home edit or add, not busy, nothing open). | |
| | `settingsPage` | Without developer surfaces the result is never `developer` or `character` (those become `null`); every other page, and every page with developer surfaces, is returned unchanged. | |
| | `settingsNavigationRows` | With developer surfaces the rows are returned unchanged; without, no returned row is labelled `Developer`. Hand-written `settingsNavigationRows_shape`: the result is a subsequence of the input, exactly the Developer rows are dropped and every other row is kept. | |
| `runtime/canvas-geometry.ts` (5) | `canvasScale` | For positive width, available height and short screen side: scale is positive; landscape exactly when not desktop and wider than the free height; desktop is never landscape or wide and never scales above 1; a fluid non-launcher canvas never scales above 1 and is exactly 1 in landscape; other landscape canvases scale at least 0.1; wide exactly when not desktop and `width >= WIDE_CANVAS * scale`. | `//@ declare-type CanvasInput` and `CanvasScale`, and `//@ type ... real` on `freeHeight`, `banner` and the result of `canvasTop` (5 overrides): lengths are mathematical reals, and the two record shapes are stated in the annotation rather than read from the TypeScript types. |
| | `canvasTop` | Result is at least the banner height and equals it off desktop. | |
| `runtime/cloud-environment-selection.ts` (1) | `resolveCloudEnvironmentCore` | Result is `production` or `staging`; on Android or outside development, staging requires test mocks and a staging selection; without test mocks only a desktop development cloud resident can reach staging; the full set of staging cases is stated; a production selection stays production outside that development case. | None |
| `runtime/cloud-voice-limit.ts` (1) | `finiteWaitSeconds` | A defined result is in [1, `MAX_RETRY_AFTER_SECONDS`]; negative or over-limit input gives `undefined`; in range gives `max(1, value)`. | None. The caller's `Number.isFinite` and rounding are outside the proved function. |
| `runtime/gmail-mailbox.ts` (3) | `sizeFrom` | Terminates for `0 <= from <= rows.length` (it is the specification of the suffix size). | `//@ skip` on the module-level `WeakMap` cache `measured`; no proved function reads it. `size` is an arbitrary function parameter: the proof holds for any size function, including negative sizes. |
| | `newestWithinBudget` | Result is an index in [0, length]; for a non-negative budget the rows from that index fit the budget, and including one more row would not (the kept suffix is maximal). | |
| `runtime/hosted-digests.ts` (10) | `digestPhaseDiscardable` | True exactly for phase `review`. | `//@ skip` on the module-level `RetainedBriefStore` instance; no proved function reads it. The re-exported code under `.eliza` is not a proof target. |
| | `digestMissingCalendars` | Every returned id is selected and not offered by any choice; every selected id that no choice offers is returned. Hand-written: the result is a subsequence of `selected` (order kept). | |
| | `digestTapNotice` | `null` exactly when the tap is not bound; the sign-in notice exactly for a bound `other-account` tap. | |
| `runtime/inbox-edit-coalescer.ts` (2) | `coalesceDelay` | For `0 <= delay <= maximumWait`: result is in [0, delay]; the flush never lands after `first + maximumWait` when that is still ahead; it is 0 once the maximum wait has passed and the full delay when that fits. | None |
| `runtime/inbox-operation.ts` (1) | `regressedReceipt` | True exactly when a saved receipt exists, the incoming state is `prepared`, the saved phase is `observed` and the request ids match. | None |
| `runtime/resident-recovery.ts` (1) | `residentBootStateLost` | True exactly for state `dead`, `restarting` or `booting`; absent states are false. | None |
| `runtime/voice-states.ts` (1) | `deniedSettingsChoice` | True exactly when native, the failure is `denied`, the stage is `ready` and nothing is busy. | None |
| `runtime/workflow-device-contract.ts` (6) | `readyTapStep` | `consume-only` exactly when the token is the one already opened; a first tap opens. Hand-written (property of `WorkflowNoticeTaps.qnt` for this function): the same token is never opened twice. | None |
| | `tapRecheck` | `after-operation` exactly while an operation runs; otherwise `now` exactly when the generation changed, else `none`. Hand-written: the four-row table and the priority of a running operation. | |
| `startup-permission-flow.ts` (5) | `startupPermissionsActiveCore` | Active only with an account or a selected Cerebras setup; never during sign-in; never while busy unless the resident is starting or background work runs; active in the two stated sufficient cases. | None |
| | `lateReadyNotice` | Never shown unless silent; shown for a silent non-empty error or a message containing `did not confirm revoking`; not shown when there is neither an error text nor a message. | |
