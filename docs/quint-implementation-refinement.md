# Quint implementation refinement

## Published source baseline

The migration and its required product-source prerequisites are in draft PR 825.
The base is `claude/finish-open-issues`, the published source lineage of the
starting checkout. The prerequisite changes are a separate commit. The original
working tree was preserved. The upstream pin remains
`b25d8aef2916385c571f4367e099809254fde0bb`.

## Executable relation

Every adapter executes product code and records an explicit projection of its
state and effects. The checker generates Quint scenarios that require each
recorded checkpoint to match the named model transitions. It also checks
rejected actions, stuttering and each registered model safety invariant. Deliberately wrong observations and changed
source hashes are tested as failures.

Receipts retain concrete inputs, observations, exercised actions, assumptions,
Quint output and hashes captured before implementation execution. Imported model
dependencies are hashed transitively. The aggregate rejects stale receipts and
fails the full campaign when a runtime model has no passing current receipt.

`complete-finite-helper` applies only to the enumerated helper domain stated in
its receipt. `bounded-component` and `bounded-orchestration` preserve their
schedule and projection limits. The aggregate records unobserved fields and
unexercised actions as open obligations. `--require-complete` fails while the
universal application refinement obligation remains open.

## Corrections found through source execution

| Component | Finding and change | Remaining boundary |
| --- | --- | --- |
| Scan document | Explicit save and load now retain user ownership across later autosaves. Confirmed export only deletes an automatic draft. The preservation predicate is a safety invariant. | Actual document-provider persistence and PDF content retain separate integration tests. |
| Maps route admission | The source regression now follows the current free-flow and live-traffic route contract. A free-flow route remains valid when the provider also supports live traffic. | GPS, route-provider correctness and physical guidance retain separate integration requirements. |
| Renderer recovery | The loss counter now saturates after the immediate-recovery budget, preventing integer overflow from reopening that budget. | Visible Android Activity/WebView escape behavior needs platform evidence. |
| Startup permissions | The model separates volatile prompt ownership from a best-effort durable attempt marker. A failed marker write can allow a new flow to request permission again. | OS permission behavior is an environmental contract. |
| Draft dispatch | A failed release write with readable storage enters conflict review. The model distinguishes this from an unreadable store or failed clear. | Broader concurrent edit schedules remain explicit obligations. |
| Durable store | The final legacy check occurs before the document CAS finishes. A late external legacy write is detected on the next read. The original stronger cross-store condition is retained as a falsifiable property. | An atomic guarantee across external localStorage and document transactions is unresolved. |
| Resident runtime | Ordinary stop, confirmation failure, owned cancellation and attached cancellation now have distinct model transitions. Stop retires enrollment before confirmed process termination and retains provider configuration. | Native service locks and process shutdown require Android integration. |
| Application composition | Pending replacement keeps the existing account available, with committed owner generation separate from attempt generation. Stop and cancellation are composed with voice retirement. A real renderer-controller campaign observes account sign-out and replacement under isolated native/provider ports. | Intermediate events and cross-domain voice, Calendar, Inbox and reset schedules remain open. |

## Further coordinator findings

The next source-driven tranche executes complete coordinators beyond the first
component projections. Its failing traces remain explicit work items.

- `AlphaDataReset` preserves an existing retry count for manual attempts. The
  current model resets that count. Failure-budget write errors can also leave a
  missing budget and admit another automatic reset on every process launch.
  Durable admission and storage-failure transitions need implementation and model
  refinement together.
- `AlphaCloudSignInPlugin.resumeAcknowledgements` finishes the saved-key
  acknowledgement without the previous token held by an interrupted interactive
  call. The model currently retains that token across restart. The recovered
  state must preserve uncertainty about previous-session revocation.
- Main chat integration uses `installAgentAdapter` and separate draft-recovery
  state. The first `AlphaClient` and `AssistantDraftController` projections leave
  that live coordinator work open.

## Reproduction

Use the pinned Node and npm dependencies, JDK 21 and the pinned host JSON jar.
CI prepares the JSON jar with `scripts/ci/prepare-host-test-json.sh` and installs
Chromium with `npx playwright install --with-deps chromium`.

```sh
npm run upstream:prepare-client
npm run quint:refinement
npm run quint:check
npm run verify
npm run android:build:local
npm run android:verify
```

The default refinement command runs the application, services, native and
composition campaigns. A subset can be selected with `--families=application`,
`--families=services`, `--families=native` or `--families=composition`. Reports are
written to `test-results/quint-refinement/`. CI retains model and source trace
evidence as artifacts.

## Platform validation

The refinement worktree's local Android build stops at the voice-input preflight.
Qualified on-device voice outputs have not been staged into that isolated tree.
APK verification reports missing APKs. Neither distribution variant is validated
by those attempts. APK generation, installed emulator HOME behavior, full AOSP
boot, real integrations and physical-device/user acceptance remain separate
requirements.

## Completeness

The executable campaigns establish their stated finite or bounded projections.
A universal simulation relation covering every supported source state and all
permitted interleavings remains open. Provider responses, Android execution,
physical audio, durable power-loss behavior and actual reset erasure require
additional contract or integration evidence. The source ledger's file coverage
does not discharge those obligations.
