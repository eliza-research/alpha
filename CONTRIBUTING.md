# Contributing

Read [README.md](README.md), [docs/development.md](docs/development.md) and [AGENTS.md](AGENTS.md) first.

## Engineering rules

1. Update the existing code. Do not patch over legacy behaviour or add a new version beside the old one.
2. Do not add a flag to introduce a change. Change the underlying code to be the new thing.
3. Env vars and flags are only for values that are really configurable: secrets, machine paths,
   and settings a person changes between runs.
4. Add a test only when it tests new features or functionality.
5. Add a script only when it does something no existing script does.
6. Deduplicate, consolidate and clean up as you go.
7. Change existing code rather than adding a new conditional path, unless there is a strong
   reason for the branch; state that reason in the change.

## Android packaging

Alpha has one launcher product/flavor. Every APK packages the resident runtime,
on-device voice and local embeddings. Run `bun run android:build:local` and
`bun run android:verify`; retain debug, release and instrumentation evidence
separately. Browser test mocks do not define another APK lane.

## Formal models

Run the Quint models and LemmaScript proofs locally before merging a PR:
`bun run quint:check`, `bun run quint:tests` and `bun run lemma:check`. That is the only point
at which running them is required. They are not part of `bun run verify` or of PR and push CI; CI runs them only
when `develop` is promoted to `main`. Proofs need Dafny 4.11.0 on `PATH`.

`quint:check` typechecks, runs the scenarios of and simulates every model registered in
`specs/quint/*/manifest.json`. `quint:tests` runs `test/quint-*`: owning tests compare product
behavior with model transitions. New implementation refinement must import or compile the whole
source file. Do not add new source slices, source-text assertions or JavaScript restatements of
the model. Existing authenticated member-level tests with unique effect, refusal, ownership or
recovery coverage remain explicitly scoped partial-source contract regressions. Retain those
checks until a qualified whole-file test covers their behavior; do not describe them as whole-file
refinement. Keep owning tests together where their product component is shared and remove duplicate
aggregate runners. The evidence classes and retained partial-source inventory are documented in
[specs/quint/README.md](specs/quint/README.md).

## Browser tests

Run `bun run test:browser` and `bun run test:browser:production` locally before finalising a PR,
and state in the PR description that they were run and are final. PR CI runs only
`bun run verify`; the browser tests run in CI only when `develop` is promoted to `main`.
