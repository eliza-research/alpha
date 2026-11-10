# External Calendar editor verification

Use an owned English-language disposable emulator without personal accounts or
Calendar data. Build both Alpha distributions and their instrumentation APKs as
specified in the [verification guide](verification.md).

Provide the universal F-Droid Etar APK at
`artifacts/calendar-external/ws.xsoh.etar_57.apk`. The runner does not download it.
Required pins:

- Package: `ws.xsoh.etar`, version code 57.
- APK SHA-256: `dae01d93c8920aa63845868db2190bcc4aa6ff8410b1289de1ce27b1bb89c599`.
- Signer SHA-256: `3f3176c3ce189c98054ff9e1d32daecf00a41572f4c7bd2b2f80607252ddb06e`.

```sh
ALPHA_CALENDAR_TEST_SERIAL=emulator-N \
ALPHA_CALENDAR_TEST_AVD=owned-avd-name \
ALPHA_CALENDAR_TEST_ABI=x86_64 \
node scripts/test-calendar-regression.ts --external
```

The runner leases the emulator and refuses existing Alpha or Etar package
registrations. It installs the verified `artifacts/test-mocks/` pair (from
`npm run android:build -- --test-mocks`) into a fresh secondary user for each
Alpha distribution and scopes Calendar grants to that user. The upstream runner
checks installed APK bytes; the native test independently checks Etar's version
and signer. A mismatched dependency fails before instrumentation. Use
`--variant=standalone` or `--variant=launcher` to select one distribution.

The exact test is
`CalendarExternalEditorInstrumentedTest#complexExistingEventOpensEtarCancelsAndSavesSameProviderRow`,
with `externalCalendar=true`. It creates a uniquely named local calendar and
an overnight event, opens Alpha's Edit control through the real implicit Etar
handoff, cancels and checks unchanged provider fields, then saves a title-only
edit. Readback must preserve the row, calendar, epochs, timezone and other event
fields. Alpha must display the edited event after returning.

Etar can reopen exact-alarm Settings while access is denied. The fixture returns
through the actual Home key and Alpha launcher intent in that case; it does not
grant that access or claim ordinary Back succeeds. Native assertions verify
fixture calendar removal and unchanged timezone.

Retain the raw instrumentation, APK hashes, exact method result and package/user
cleanup evidence under `test-results/calendar-regression-*`. Uncertain cleanup
retains the owned fixture for recovery. A passing run qualifies this overnight
editor scenario only, not recurring-series choices, DST-fold editing, account
sync, physical devices, visual acceptance or Alpha's HOME role. An earlier build's
results do not qualify the current APKs.
