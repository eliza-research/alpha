# Appearance preference admission

Alpha can save Light, Dark or System. An explicitly enabled development build
also accepts an initial `?theme` preview. At baseline `5b60285d61`, startup
ignored that query in a flag-off build while the Settings adapter still treated
it as a preview. The adapter skipped OS and browser listeners. The closed
fixture reproduced two lost System redraws and one lost browser storage update.

Startup and Settings now use the same explicit preview predicate. The adapter
follows System on native and browser shells. Browser shells also read back on
the exact preference storage key, storage clear and page restore. The existing
fixture-only startup fallback still runs through the fixture path.

The replay executes the actual startup choice, appearance listener setup and
cleanup, shell theme selector and toggle, Display row and update handler. It
controls storage, media and the shell commit boundary. Distinct marker objects
keep their identities across queued batches. The latest eligible read can
update the display without echoing its theme to storage. A Settings choice
writes once and carries the same mark into its redraw. An unmarked explicit
theme saves after commit if it changed. In a mixed batch, a new marker for the
same resulting theme suppresses writeback even if the batch also includes an
explicit action. Storage refusal preserves the session theme and reports the
failed write without replacing the saved choice.

The projection uses a stable startup URL and one non-fixture shell. React
scheduler interleavings, installed Android media and browser event delivery,
and physical storage durability remain separate.
