# Browser Files Trash journal custody

The driver executes the prepared `BrowserStorageVolume` and storage model from the pinned shared Files plugin. The browser wrapper supplies the Alpha Trash folder and journal namespace. The authenticated repair in `0510aba06f1382c1b91dee895b5e7cf0657c7ba8` serializes Trash, Restore, Empty and the listing that prunes markers. The two original race tests reproduced an empty listing after a held Trash or Restore erased the wrong marker.

`BrowserFilesTrash` projects one namespace, two volume instances and two files. A single waiting request covers the selected source schedules. Each request tracks the volume, operation and exact subject. Physical row location, UUID-backed markers and the raw journal are separate observations. The driver checks complete listed record metadata against the journal and physical file. The count for confirmed Empty comes from the source reply.

The driver holds the real source at deferred library calls. It verifies one active and one pending request with Node Web Locks, and verifies the corresponding entry and settlement order with the source's same-realm fallback. In both modes it exercises six schedules.

- Hold Trash across a peer listing and then restore the exact marker.
- Hold Restore across a peer Trash write and keep the second marker visible.
- Hold Trash across confirmed Empty of an older reviewed marker and retain the newer marker.
- Refuse the initial journal write and observe the queued request and a later Trash complete.
- Restore and retrash one file, refuse stale or absent confirmation, and check the exact 30-day retention boundary.
- Refuse placement during Trash and Restore. The live row survives failed Trash and the exact marker survives failed Restore.

The baseline in `458ae1b8e20cd49790cb5dd3d8cfa939270ccc33` preserves two source replays that failed after a temporary rename. A failed Trash cleared its just-written record but left the original row under a hidden `.moving-*` name. A failed Restore left a hidden row and dangling marker. A fresh Restore returned missing, and the next list pruned the marker. That baseline uses the same two lock paths and retains the actual source observation in `AllRowsReachVisiblePlace`.

Placement now checks the original file revision and changes its parent and name in one IndexedDB transaction. The focused Chromium regression uses a synthetic origin and two actual library connections. It holds a transaction before admission and then removes its destination, changes the original revision, or creates a destination collision. The refused placements preserve the exact affected rows and their appropriate journal state. The same marker can be restored later under a clash-free name, while the new file keeps its name and identity.

The Quint replay uses an in-memory CAS library and journal, real Node Web Locks, and a controlled wall clock. The model groups placement settlement and the journal update into one transition. LocalStorage and IndexedDB still commit separately. Legacy hidden rows, interruptions, failed journal writes after placement, cross-tab scheduling and larger batches remain separate obligations.

Run the focused checks with Node 26 after preparing the client projection and installing Playwright Chromium.

```sh
node scripts/prepare-client-features.mjs
node --test test/quint-browser-files-trash-refinement.test.mjs test/files-browser-atomic-placement.test.mjs
```
