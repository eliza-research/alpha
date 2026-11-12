# Shared launcher ownership

`LauncherOwnership` follows the prepared shared launcher and system bridge.
An inventory read waits for both the installed list and the dial-role
readback. Only the current generation publishes either result. A native
handoff retains the exact package, activity and profile, or dispatches the
dial role. Retiring the controller fences both old reads and late handoff
replies while allowing reuse.

Fifteen source schedules compare 120 checkpoints. They execute the actual
shared controller with deferred system replies and a read-only observer for
generation and lifetime. They cover either reply order, overlapping reads,
retirement and reuse, duplicate and invalid installed entries, stale
components, launch failures with a fresh read, and a new launch settling
alongside a retired one. The bridge calls are checked for exact component or
role arguments.

The model bounds three app identities, two default readback classes, eight
generations and four launches. Builtin dispatch, package watchers, favorites
migration and real Android execution remain separate obligations.

```sh
bun test test/quint-launcher-ownership.test.mjs
```
