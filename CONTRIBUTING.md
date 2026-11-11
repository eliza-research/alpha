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

## Formal models

Run the Quint models and LemmaScript proofs locally before merging a PR:
`bun run quint:check`, `bun run quint:tests` and `bun run lemma:check`. That is the only point
at which running them is required. They are not part of `bun run verify` or of PR and push CI; CI runs them only
when `develop` is promoted to `main`. Proofs need Dafny 4.11.0 on `PATH`.
