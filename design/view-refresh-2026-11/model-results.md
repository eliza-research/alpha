# View refresh models: Quint results (2026-11-08)

The four design models are Quint modules in `specs/quint/legacy/`: CameraSession,
PhotosLibrary, NotesView and FilesBrowser. Their configurations, sources and provenance are in
`specs/quint/legacy/view-refresh.manifest.json`. Each original TLA+ configuration is one
checker initializer. `checkerInit` is the proposed design. Each `checkerAsBuilt*` initializer
models today's code with one fix turned off, and each `checkerAblate*` initializer removes one
design rule. The historical TLC runs are in `tla/results.md`.

All checks used Quint 0.33.1 (`node_modules/.bin/quint`). The repository runner,
`npm run quint:*` from `specs/quint/README.md`, registers these modules once the central
framework lands.

## Scenario tests (`quint test --main=<M>`)
| Model | Tests | Result |
|---|---|---|
| CameraSession | 9 (design paths + 5 as-built counterexamples) | 9 passing |
| FilesBrowser | 8 (incl. AsBuilt_Categories, AsBuilt_Identity, Ablate_Conflict) | 8 passing |
| NotesView | 10 (incl. AsBuilt_Cap/Segments/StreamAsr/Hidden, Ablate_RestoreFolder) | 10 passing |
| PhotosLibrary | 11 (incl. AsBuilt_Window/Patch/FavToggle/Cap) | 11 passing |

Every as-built and ablation counterexample from the TLA+ configurations is reproduced as a test.

## Random simulation of the design (`quint run --init=checkerInit --invariant=safety`, 2000 samples × 40 steps, seed 20261108)
No violation in any of the four models.

## Exhaustive checking of the design (`quint verify --backend=tlc --init=checkerInit`)
| Model | Property | Distinct states | Result | TLA+ parity |
|---|---|---|---|---|
| CameraSession | safety | 2,742 | no violation | model extended with the chat-sheet grace rule (TLA+ 1,344 before it) |
| CameraSession | CheckedTemporal (fairness ⇒ liveness) | 2,742 | no violation | |
| NotesView | safety | 8,398,068 | no violation | identical to TLA+ |
| NotesView | CheckedTemporal | — | **not concluded**: the TLC JVM crashed (exit 139) under system memory pressure | passed under TLA+/TLC on the same 8,398,068-state model |
| FilesBrowser | safety | 1,763,736 | no violation | identical to TLA+ |
| FilesBrowser | CheckedTemporal | 1,763,736 | no violation | |
| PhotosLibrary | safety | 7,272,244 | no violation | larger than TLA+ (204,208): the port added open/share/Replace |
| PhotosLibrary | CheckedTemporal | 7,272,244 | no violation | |

Open item: re-run `quint verify --backend=tlc --main=NotesView --init=checkerInit --step=step --temporal=CheckedTemporal specs/quint/legacy/NotesView.qnt` with JVM_ARGS=-Xmx8g on a machine with free memory.
