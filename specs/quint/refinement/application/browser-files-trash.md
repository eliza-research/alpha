# Browser Files Trash journal custody

The driver executes the prepared `BrowserStorageVolume` and storage model from the pinned shared Files plugin. The browser wrapper supplies the Alpha Trash folder and journal namespace. The authenticated repair in `0510aba06f1382c1b91dee895b5e7cf0657c7ba8` serializes Trash, Restore, Empty and the listing that prunes markers. The two original race tests reproduced an empty listing after a held Trash or Restore erased the wrong marker.

`BrowserFilesTrash` projects one namespace, two volume instances and two files. A single waiting request covers the selected source schedules. Each request tracks the volume, operation and exact subject. Physical row location, temporary naming, UUID-backed markers and the raw journal are separate observations. The driver checks complete listed record metadata against the journal and the physical file. The count for confirmed Empty comes from the source reply.

The driver holds the real source at deferred library calls. It verifies one active and one pending request with Node Web Locks, and verifies the corresponding entry and settlement order with the source's same-realm fallback. In both modes it exercises six schedules.

- Hold Trash across a peer listing and then restore the exact marker.
- Hold Restore across a peer Trash write and keep the second marker visible.
- Hold Trash across confirmed Empty of an older reviewed marker and retain the newer marker.
- Refuse the initial journal write and observe the queued request and a later Trash complete.
- Restore and retrash one file, refuse stale or absent confirmation, and check the exact 30-day retention boundary.
- Refuse the move after the temporary rename during both Trash and Restore.

The last schedule preserves an independent source discrepancy. A failed Trash clears the just-written record but leaves the source row under a hidden `.moving-*` name. A failed Restore leaves a hidden row and a dangling marker. A fresh Restore returns missing, and the next list prunes that marker without restoring the hidden row. `AllRowsReachVisiblePlace` records this discrepancy separately from the custody safety invariant. The port refusal in these schedules occurs before moving the row.

The executable fixture uses an in-memory CAS library and journal, real Node Web Locks, and a controlled wall clock. Browser tabs backed by actual IndexedDB, process interruption, mutation from outside the namespace lock, later storage write failures and larger batches remain separate obligations.

Run the source replay with Node 26 after preparing the client projection.

```sh
node scripts/prepare-client-features.mjs
node --test test/quint-browser-files-trash-refinement.test.mjs
```
