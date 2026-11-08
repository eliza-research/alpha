# Pixel 10a Android 17 source contract

Issues #399 and #377 select Pixel 10a, codename `stallion`, on Android 17.
The connected development device's hardware SKU is `GE1GQ`. Pixel 10 and Pixel 11
are different devices and are not supported targets; the former Pixel 10 placeholder lock is
retired, and no other device configuration can admit this one.

`vendor/eliza/packages/os/android/sources/pixel10a-stallion.json` records the inspected development source inputs:

- AOSP `android-17.0.0_r1`, manifest commit `5bc9a7ce1cd78dd53613bbfd0ebf506e1e4adb0f`.
- 1,084 platform project revisions plus three pinned device extraction projects.
- Factory `stallion-cp3a.261005.005-factory-d1d25502.zip`, SHA-256
  `d1d2550268de9fd4bfdd4ff0910cc4471fec6ba361506278c25f34f312106675`.
- 6,360 generated vendor files, including stock kernel/modules, firmware and device
  configuration. Only paths, lengths and hashes are committed; no licensed binaries.
- Sixteen exact source overrides: fourteen attributed extraction-tool overlays,
  the vendor `AID_AOAD` compatibility ID, and extracted SELinux CIL integration.
  The original patches are retained with the stallion product work. Neverallow
  checks remain enabled; a source match does not prove policy runtime behavior.

The source input provenance is the separate Eliza development commit
`74504c953b`, fully identified in the lock. This is not a change to the current
`vendor/eliza` app/runtime pin. GrapheneOS supplies attributed extraction-tool and
compatibility references; the platform baseline is AOSP.

Run against an already prepared source checkout and retained factory archive:

```sh
node scripts/verify-pixel10a-source.mjs \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --out /absolute/new-source-check.json
```

The command reads files and Git state. It checks every listed project revision,
rejects additional tracked/untracked source changes and hidden index flags, compares
all reviewed overrides and the complete generated vendor inventory, and hashes the
factory archive. Ignored files are also checked: the recorded extraction-tool
dependency/build output tree has a complete aggregate hash, and ignored inputs
in any other project are refused. It writes only the explicitly requested new report. It neither
prepares nor patches a source tree. The top-level AOSP `out/` build outputs and the separately staged
`vendor/alphaphone` app payload are not covered by this source-input check; APK,
secure camera and listener admission still apply independently during staging.

On October 15 the actual prepared source passed all 1,087 revision checks, 16 override
checks, 6,360 generated-file checks and the factory hash. This establishes the
recorded development inputs, not a clean build from them or acceptance of current main.
The historical October 11 physical image used the older Eliza `91dc1919` app pin.
Read-only October 15 observation found Android 17 booted with enforcing SELinux and
Alpha HOME on the physical Pixel, but with an app override under `/data/app`.
Cuttlefish at the separately inspected target had Alpha under `/product/app` and
Alpha HOME. Neither observation qualifies the current app/runtime pin or signed updates.

## Release admission (issue #399)

On October 25 the lock was admitted for release: `developmentOnly` is `false` and
`android/aosp/pixel10a-product.json` pins its SHA-256
`760a7184c62c93aeac40595cf5733f8089aa16ccd28eb7a5f5ce41d4dae741d3`. Only that flag
changed; every source, override, generated-file and factory record is the one verified
on October 15 and 23. The two listener SystemUI manifests that pin the baseline lock
were re-pinned for the same reason, with their patches unchanged.

The retained source tree now also carries the listening-chip patch, so the plain verifier
refuses it. The admission evidence,
[pixel10a-source-verification-2026-10-25.json](pixel10a-source-verification-2026-10-25.json),
was produced with:

```sh
node scripts/verify-pixel10a-source.mjs \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --applied-systemui-patch chip --out /absolute/new-source-check.json
```

All 1,087 revisions, 16 overrides, 6,360 generated files and the factory hash matched the
admitted lock. The nine chip files matched their committed preimages at the pinned
`frameworks/base` revision and their postimages. `--applied-systemui-patch` accepts only a
reviewed listener bundle whose manifest pins this lock, refuses overlap with lock overrides,
and leaves every other check unchanged.

Admission lets production staging get past the source lock. Production staging still refuses
until the signing identities (decision A-06) are reviewed. Admission is not an image build,
signed image, boot or device result.

## Distribution gates

`android/aosp/pixel10a-qualification-gates.json` records each distribution gate on its own:
source admission, APK variants, Cuttlefish boot, physical device, signed update/recovery, and
user acceptance. A gate is `passed` only with release-level evidence of its own. Development
boot evidence, such as the [October 19 image](pixel10a-code6-boot-evidence.md) or a
[development Cuttlefish observation](evidence/cuttlefish-observation-2026-10-25.json), keeps a
gate at `development`. The signed update/recovery gate cannot pass while any drill in
`android/aosp/pixel10a-ota-channel.json` is not `passed`. User acceptance cannot pass before
every other gate has. `scripts/pixel10a-gates.mjs` enforces these rules (`test/pixel10a-gates.test.mjs`).
The product descriptor's `releaseQualified` and `deviceAcceptanceVerified` stay `false`.

Remaining work includes integrating these inputs with the current admitted APK and
listener, rebuilding/booting exact images, native runtime and speech execution,
physical hardware/user tests, managed release signing, signed update/interruption,
and compatible recovery drills. Release qualification is explicitly false in both
the lock and every verifier result. Keep #377, #399 and #400 open until their full
acceptance criteria are supported by the appropriate evidence.
