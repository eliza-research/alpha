# Shared launcher favorites

`LauncherFavorites` follows the real mobile launcher, local favorites store
and Alpha product registry. It distinguishes a missing setting, an explicit
empty choice, malformed bytes and the two record versions. Legacy view IDs
resolve to canonical Home views even if a migration write is refused.
The old default inventory can be trimmed while its original order remains
available as rollback evidence. An external choice made during inventory
loading owns the next visible favorites list.

The source campaign checks 126 checkpoints in 21 schedules. It compares the
actual saved record, captured starting choice, pending migration flags,
listed and visible app identities, attempted edits and successful writes.
It covers storage refusal and recovery, recreation, an explicit edit during
a held load, capability-driven visibility and visible reorder around an
uninstalled favorite. The same package's primary and work-profile keys
remain distinct.

The model bounds two product views, one legacy alias, three installed
app identities, one uninstalled identity and one held load. Real browser
storage durability, overlapping inventory reads, native package effects
and pointer handling have separate scope.

```sh
node --test test/quint-launcher-favorites.test.mjs
```
