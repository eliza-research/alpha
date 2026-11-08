# MVP operator and acceptance actions

Updated 2026-10-12: the owner answered all 32 decisions. There is no pending scope
approval for those choices. [Approved TODOs](owner-approved-mvp-plan-2026-10-12.md)
and [implementation order](implementation-plan.md) replace the old decision queue.
The [previous owner-action ledger](https://github.com/AlphaCompute/alphaphone/blob/f3ccefd382bd40b29b06117c97da366c1e9b75a7/docs/mvp-owner-actions.md)
retains earlier campaign details. Policy approval is not evidence of qualification.

The single ordered checklist of every step only a person can take, with the file, setting,
script or runbook that waits for it and how to verify it, is [human actions](human-actions.md)
(`npm run human:status` prints the steps this repository records). The groups below summarise
the same steps by role; this page also keeps the resolved-choice and inventory coverage notes.

## Resolved choices

A-01 to A-20, A-22 to A-26, A-32 to A-35, MVP-01, MVP-52 and approval-notice policy
are approved in decisions.md. A-21 was already settled by P-09. A-27 to A-31 are
not decision IDs. Do not ask the owner to reapprove these product choices.

## Actions requiring operator resources or evidence

- Release owner Shaw: provide controlled signing/operator access, exact Pixel 10a
  Android 17 input admission and recovery/update evidence (#399 #400). Keep keys
  and credentials out of repo/chat.
- Cloud operators: deploy subscription/inference, Gmail and reusable Maps service
  changes (#396 #410 #412 #421). Establish subscription price, numerical quotas and
  coverage from costs and real traffic; these details have not been invented here.
- Authorized account/provider tests: sign-in/revoke, a test mailbox and controlled
  recipients, SMS/call endpoints on AOSP, and Maps route/location evidence. Scope
  approval alone does not authorize arbitrary calls, messages or production changes.
- Native reviewers: benchmark and admit source/model/ABI-identical speech artifacts,
  verify Clef feasibility and actual microphone/speaker/interrupt/listening behavior
  (#397 #413 #423 #424). No “fastest on phone” claim from desktop model cards.
- Device/QA operators: emulator and Cuttlefish campaigns, Pixel hardware and audio,
  role/permission/Doze/locked-user tests, system shade design, responsive accessibility,
  always-on power/thermal/stop tests and target-user acceptance at the exact release.

## Inventory coverage

MVP-01 to 53 remain tracked in the [inventory](mvp-remaining-work-2026-10-09.md).
Policy-related human blockers were replaced with implementation work. Real resource,
artifact review, device and provider acceptance needs remain visible there. Work
that can proceed without those resources should continue; no broad approval gate
is introduced by this page. All 32 GitHub implementation issues remain open TODOs.
