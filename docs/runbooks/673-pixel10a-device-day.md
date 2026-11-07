# #673 Pixel 10a device day: install the signed image and run the update and recovery drills (H-24, H-25)

Owner preparation for [issue #673](https://github.com/eliza-research/alphaphone/issues/673),
[human actions](../human-actions.md) H-24 and H-25. A device operator and the release owner run
this with physical Pixel 10a (stallion) units, with each unit owner's consent to every flash and
wipe. Results are **device evidence**, kept apart from Cuttlefish boot evidence (#672 H-23) and
from APK builds (#662); none proves another, and none of this is user acceptance (H-34).

Prerequisites: #672 done (a release-signed `signed-target_files.zip`, `ota.zip`, `avb_pkmd.bin`
and `release-record.json`, recorded as `recovery.knownGoodRelease`; under the 2026-10-29 custody
decision these come from the CI `signed-release-image-<run>` artifact, so check the artifact files against
`release-record.json` before flashing, and keep the run URL in the unit evidence as `image.signingRun`); pilot units named (H-07);
the [pilot acceptance runbook](../pilot-acceptance-runbook.md) entry conditions met.

## Prepared on this branch

- Evidence templates, one class each (copy into `docs/evidence/`, fill every `UNSET`, hash serials):
  - `docs/runbooks/templates/pixel10a-unit-evidence.template.json`: `evidenceClass: "physical-device"`,
    one per unit, for the `physicalDevice` gate.
  - `docs/runbooks/templates/pixel10a-drill-evidence.template.json`: `evidenceClass: "physical-device-drill"`,
    one per drill, for the `signedUpdateRecovery` gate and the channel `drills`.
  - `docs/runbooks/templates/cuttlefish-boot-evidence.template.json`: `evidenceClass: "cuttlefish-image-boot"`,
    for the `cuttlefishBoot` gate (#672), so the virtual-target record has its own shape.
- `scripts/owner/evidence-class-check.mjs` (read-only): refuses a record of the wrong class under a
  gate (a Cuttlefish file under `physicalDevice`, for example), a release-level entry without a
  class, a cited file with `UNSET` fields or a non-passed result under a passed gate, one file cited
  by two gates, and a channel drill marked `passed` without its own drill record. The shared gate
  rules do not check this: they accept any release-level evidence file under any gate. Test:
  `test/owner-evidence-class-check.test.mjs`.

## Read-only state on 2026-10-28 (main 94676c82)

`npm run human:status` reads exactly these records for the two steps (`scripts/human-actions.mjs`):

- H-24 `open`: `physicalDevice gate: development` (status of `physicalDevice` in
  `android/aosp/pixel10a-qualification-gates.json`; its only evidence is the October 19
  development-signed, unlocked image record `docs/pixel10a-code6-boot-evidence.json`).
- H-25 `open`: `signedUpdate not run, interruptedUpdate not run, compatibleRollback not run,
  stockRecovery not run; signedUpdateRecovery gate: not run`. H-25 is `done` only when every
  channel drill is `passed` **and** the gate is `passed`.

`human:status` trusts the recorded status; the shared gate rules (`node --test test/pixel10a-gates.test.mjs`)
require release-level evidence for `passed` and that `signedUpdateRecovery` agrees with the channel
drills and known-good release; `evidence-class-check.mjs` adds the class separation. Run all three
after recording. `node scripts/owner/evidence-class-check.mjs` today: 0 problems, 2 notes (the two
development records predate evidence classes).

## Decisions for the owner

### D1. Bootloader state of released units (with the release owner)

| Option | Result | What it changes |
| --- | --- | --- |
| Relock after enrolling `avb_custom_key` (recommended) | Verified boot **yellow** (custom key) | `verify-pixel10a-image.mjs` accepts green or yellow and refuses orange, so only this option lets the `physicalDevice` verifier pass. Locking wipes user data again. |
| Leave unlocked | Verified boot **orange** | The verifier refuses the image, so the `physicalDevice` gate cannot pass through it; release notes must state the weaker trust state (upstream signing README section 5). |

### D2. OEM unlocking on released units

Stock recovery (`aosp-ota-update.mjs stock-archive`) starts with `fastboot flashing unlock`, which
the bootloader refuses unless OEM unlocking was enabled from the running image's developer
options; a unit that no longer boots cannot enable it. Options: leave OEM unlocking enabled on
pilot units (stock recovery stays possible; anyone with the unlocked phone and physical access can
unlock and wipe it), or disable it (a unit that stops booting cannot be restored by the owner).
The staging guide states this is a release decision the stock-recovery drill must exercise.
Recommendation for the pilot: leave it enabled and record that in the P- entry.

### D3. Which unit runs the destructive drills

The interrupted-update, rollback and stock-recovery drills wipe or risk the unit. Recommendation:
one designated drill unit (not one of the four pilot units' daily devices), with its owner's
written consent to wipe; record its alias in each drill record.

### D4. Second signed release for the update drills

`aosp-ota-update.mjs check` refuses a candidate that is not newer (build date), lowers the security
patch level or any AVB rollback index, or changes the OTA certificate or AVB key. The signed-update,
interrupted-update and compatible-rollback drills therefore need **a second release-signed build
(N+1)** from the same keys, built and signed through #672 H-21/H-22 again. Default: none exists.
Decide whether N+1 is a real candidate or a drill-only rebuild with a later build date.

## H-24 Install the release image (device operator, per unit)

The commands below are the **proposed sequence**, assembled from the documented pieces: the
staging guide (`fastboot flash avb_custom_key avb_pkmd.bin` before `fastboot flashing lock`), the
upstream signing README section 5, and the upstream `stock-archive` plan for the bootloader and
radio of the locked factory archive. **No agent has run any of it, and the
[pilot runbook](../pilot-acceptance-runbook.md) deliberately supplies no flashing commands: the
release owner reviews this sequence before the first unit.** There is no repository tool that
turns the signed target-files into a flashable image or flashes it.

On the image host (once per release):

```sh
# flashable images from the release-signed target-files (otatools bin/ from the same build)
/absolute/otatools/bin/img_from_target_files /absolute/release/signed-target_files.zip /absolute/release/signed-img.zip
sha256sum /absolute/release/signed-img.zip /absolute/release/avb_pkmd.bin
# bootloader and radio images come from the locked factory archive; print its verified plan:
node scripts/aosp-ota-update.mjs stock-archive --archive /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip
```

On each unit (owner consent recorded first; this wipes user data):

```sh
fastboot devices                                   # exactly one, the consented unit
fastboot -s SERIAL flashing unlock                 # confirm on the device; wipes data
fastboot -s SERIAL erase avb_custom_key            # clears any earlier custom key
fastboot -s SERIAL flash bootloader <bootloader-stallion-*.img from the factory archive>
fastboot -s SERIAL reboot-bootloader
fastboot -s SERIAL flash radio <radio-stallion-*.img from the factory archive>
fastboot -s SERIAL reboot-bootloader
fastboot -s SERIAL -w --skip-reboot update /absolute/release/signed-img.zip
fastboot -s SERIAL reboot-bootloader
fastboot -s SERIAL flash avb_custom_key /absolute/release/avb_pkmd.bin
fastboot -s SERIAL reboot-bootloader
fastboot -s SERIAL flashing lock                   # only if D1 = relock; confirm on device; wipes again
fastboot -s SERIAL reboot
```

After first boot (and setup), on each unit:

1. Wait more than 20 seconds after any HOME change before a test reboot (the October 19 run showed
   the preferred-HOME write is delayed about ten seconds).
2. Read-only verifier, with the reviewed launcher descriptor and the exact fingerprint from
   `release-record.json`:
   ```sh
   node scripts/verify-pixel10a-image.mjs --serial SERIAL --user 0 --descriptor /absolute/reviewed-launcher.json \
     --fingerprint '<exact build fingerprint>' --apk-path /product/app/AlphaPhone/AlphaPhone.apk \
     --out /absolute/new-report.json --listener
   ```
   It checks the fingerprint, Alpha's system launcher bytes as HOME, a remaining recovery HOME,
   Clock handlers, WebView, verified boot green or yellow, and the listener's privileges. Confirm
   enforcing SELinux and that the production provisioning overlay resolves HOME to Alpha.
3. Run the per-unit checks of the pilot runbook ("Execute on every unit", "Performance and
   stability") as far as this step covers them.
4. Fill `pixel10a-unit-evidence.template.json` into
   `docs/evidence/pixel10a-<alias>-device-<date>.json` (serial and fingerprint hashed; no account
   data), add a `level: "release"` entry per unit to `physicalDevice`, and set the gate `passed` only
   when every unit's record is `passed`.
5. `node scripts/owner/evidence-class-check.mjs --strict`, `node --test test/pixel10a-gates.test.mjs`,
   `npm run human:status` (H-24 `done`).

## H-25 Update and recovery drills (release owner, drill unit)

All drill commands are `scripts/aosp-ota-update.mjs` ([staging guide](../pixel10a-staging.md#update-interruption-rollback-and-recovery)).
Release N is installed through H-24; N+1 comes from D4. Each run writes a journal; keep it.

1. **signedUpdate**
   ```sh
   node scripts/aosp-ota-update.mjs check --from N/release-record.json --to N1/release-record.json
   node scripts/aosp-ota-update.mjs apply --serial SERIAL --from N/release-record.json \
     --to N1/release-record.json --ota N1/ota.zip --journal /abs/new-journal-signed.json
   # review the printed plan, then the same command with --execute --confirm-update
   ```
   In recovery choose "Apply update from ADB" when asked, and "Reboot system now" if recovery
   stays in its menu. Pass: the candidate boots on the other slot with enforcing SELinux and
   verified boot no weaker than before; user data preserved.
2. **interruptedUpdate**: reinstall N (H-24) or use a second N/N+1 pair, start `apply --execute
   --confirm-update`, and interrupt during the sideload transfer (disconnect USB). Then
   `node scripts/aosp-ota-update.mjs status --serial SERIAL --journal <journal>` and re-run the
   same `apply` with the same journal. Pass: it resumes from the observed state without assuming
   success and ends on the candidate.
3. **compatibleRollback**: after an update to N+1 and **before** the updated slot is marked
   successful, while the bootloader reports a `snapshotted` update (Virtual A/B):
   `node scripts/aosp-ota-update.mjs fallback --serial SERIAL --journal <journal>` then with
   `--execute --confirm-fallback`. Pass: the original slot boots N. A rollback after the slot is
   marked successful is a newer release that passes `check`; downgrades stay refused
   (`downgradeAllowed: false`); record that a lower build was refused.
4. **stockRecovery** (wipes; consent): run the plan `stock-archive` printed (it starts with
   `fastboot flashing unlock`, needs D2), then
   `node scripts/aosp-ota-update.mjs verify-stock --serial SERIAL`. Pass: the stock build verifies.
   Relock (`fastboot flashing lock`, wipes again) only after `verify-stock` passes, then reinstall
   the release with H-24.

For each drill: fill `pixel10a-drill-evidence.template.json` into
`docs/evidence/pixel10a-drill-<drill>-<date>.json`, add a `level: "release"` entry to
`signedUpdateRecovery`, and set the channel's `drills.<drill>` to `passed` (or `failed`) in
`android/aosp/pixel10a-ota-channel.json`. Set the gate `passed` only when all four drills passed
and the known-good release is recorded. Then `node scripts/owner/evidence-class-check.mjs --strict`,
`node --test test/pixel10a-gates.test.mjs` and `npm run human:status` (H-25 `done`).

For APK-only updates of the launcher, `node scripts/pilot-update.mjs --serial <serial> --alias <alias>
--apk-manifest <new build>/apk-manifest.json` checks an in-place update with the same signer and a
higher versionCode. That is an APK update record, not one of the four image drills.

## Evidence separation

| Class | Gate | Template | Never counts for |
| --- | --- | --- | --- |
| `cuttlefish-image-boot` | `cuttlefishBoot` | `cuttlefish-boot-evidence.template.json` | `physicalDevice`, `signedUpdateRecovery` |
| `physical-device` | `physicalDevice` | `pixel10a-unit-evidence.template.json` | `cuttlefishBoot`, drills, user acceptance |
| `physical-device-drill` | `signedUpdateRecovery` and channel `drills` | `pixel10a-drill-evidence.template.json` | `physicalDevice`, `cuttlefishBoot` |

Upstream simulated-device tests (`aosp-ota-update.node.test.ts`) and mocked-releasetools signing
tests fill none of these.

## Draft decision entries

```markdown
- **P-5x — H-24/H-25 ([#673](https://github.com/eliza-research/alphaphone/issues/673)), decided <YYYY-MM-DD> by Shaw with the release owner:**
  Released Pixel 10a units are <relocked with Alpha's avb_custom_key (yellow verified boot) | left
  unlocked (orange)>. OEM unlocking is <left enabled | disabled> on pilot units, so stock recovery
  <is | is not> available to the owner. Destructive drills run on <unit alias> with its owner's
  consent. The update drills use a second signed release <N+1 identity>. Policy only, not device evidence.
```

## Remaining human steps

1. Owner and release owner: D1 to D4; review the proposed fastboot sequence before the first unit.
2. Release owner: produce N+1 through #672 for the update drills.
3. Device operator: H-24 on every named unit, with consent; per-unit records; `physicalDevice` gate.
4. Release owner: H-25 four drills on the drill unit; drill records, channel `drills`,
   `signedUpdateRecovery` gate.
5. Run the three checks (`evidence-class-check --strict`, `pixel10a-gates` test, `human:status`).
