# Historical Files browser source replay

The driver mounts the flag-off Files UI in Chromium with its actual shared
Files adapter, browser volume, and IndexedDB library. Each schedule starts
with isolated synthetic files. A real library import assigns each canonical
ID. The driver reads those IDs back through the actual storage APIs after
visible folder navigation, bulk selection, moves, Trash, restore, and
confirmed empty. Images opens its actual folder group. Downloads is checked
against the mounted list and the storage query.

The unchanged Design profile replays three bounded schedules. The driver
checks collision naming while retaining both original IDs, the effects of
cancelling and then confirming Empty Trash, document preview identity retiring
on Back, and an external removal that reaches the mounted selection through
the real storage-change notification. The reviewed move schedule starts at
the mounted Files runner. It checks refusal with no identity, refusal after a
same-path rewrite, and acceptance of a fresh exact identity. It does not
exercise the earlier agent proposal transport or installed Android storage.

The other three original profiles each have a separate expected observation
mismatch. Current Downloads does not include the unrelated Camera image.
A collision keeps both canonical files, and an old identity cannot move a
rewritten file at the same path. These differences leave the historical
profiles, configuration, and transition relation intact.

The projection represents the physical folders, canonical IDs and the two
observed filename classes. Browse, category groups, document preview,
confirmation UI and all but the selected external revision epoch remain
outside the historical state. No real files, sharing targets, device grants,
or provider effects are used.

With authenticated client features and Playwright Chromium prepared, run
`bun test ./test/quint-legacy-files-browser-refinement.test.mjs`.
