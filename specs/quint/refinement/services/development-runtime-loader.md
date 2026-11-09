# Development runtime loader source refinement

`DevelopmentRuntimeLoader` models two serial invocations of
`loadPinnedRuntime()` in one process. The observable phases are development
flag admission, pinned Git source authentication, resolver and patch
preparation, the build boundary, generated artifact, authenticated source
map, private state and salt readback, and fixed-URL module import.

The source driver copies the exact loader, pin verifier, resolver and patch
hooks into private scratch. A synthetic Git repository exercises real
authentication and manifest selection. The driver runs actual filesystem
writes and imports synthetic ESM. The child environment contains only its
private home and temporary directory, local tool paths, and Git configuration
isolation. The probe imports only its synthetic modules and uses only its scratch state
directory. Observations contain salt presence and equality classes.

The default campaign uses a closed build port and the actual resolver and
transform callbacks. It exercises disabled mode, wrong and dirty pins,
skip-worktree changes, ignored untracked files, duplicate and undeclared
source declarations, a bad patch digest, thrown and unsuccessful builds, missing
selected transformations, failed source-map publication, state and salt
filesystem failures, successful default and explicit state use, and retries.
The optional Bun schedule compiles actual synthetic TypeScript through the
same loader, source resolver and authenticated patch plugins.

A build can leave generated output when publishing the source map fails.
A previously loaded module stays cached under the loader's fixed URL, even
when a later successful build replaces the artifact and receipt. With Bun
1.4.2, the second real compiler invocation writes artifact and receipt version
2, then returns module version 1. The closed Node import campaign also
reproduces cached evaluation rejection after a replacement emits valid
source. These are observed baseline behaviors. The model's separate
`ReturnedCurrentArtifact` predicate is false at the successful rebuild.
The development entrypoints normally start one loader invocation per process.

The model assumes serial invocation, one selected state directory, normal
creation or readback of a valid generated salt, and bounded errors. Concurrent builds, process crash recovery, legacy salt contents, actual runtime
compilation, backend initialization, and the installed development
environment are separate verification obligations.

Run the focused test with Node 26.

```sh
node --test test/quint-development-runtime-loader-refinement.test.mjs
ALPHA_QUINT_BUN=/absolute/path/to/bun node --test test/quint-development-runtime-loader-refinement.test.mjs
```
