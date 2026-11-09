# Shade notice question admission

The simulated development shade lets the owner review selected text from an
eligible Alpha notification. Approving the dialog closes it and starts a final
list read. At baseline `0f2aa1e931`, the older read could still populate the
composer after a successor review, a committed shade departure and reentry, or
a lock. A read after foreground loss also reported a retired diagnostic.

The adapter now retains the exact review lease when its own dialog closes for
approval. A successor review, committed shade departure or lock, visibility
loss, device-state change, or unmount retires it. The final list result must
still match the reviewed notification revision and excerpt. A failure or changed
row on the current lease retains the existing diagnostic. Late results for a
retired lease stay silent.

The closed replay runs the actual adapter, notification identity and excerpt
checks, and content-question buttons in JSDOM. The shell commits state through a
controlled port. It records the composer call and its exact source review,
without sending or storing a real draft. The bounded model compares two notices,
up to three review leases, the current dialog and held list reads, and observed
composition and diagnostic calls.

The scope is committed development-shade state. Real browser focus and top-layer
behavior, uncommitted view changes and page lifecycle ordering, Android delivery,
and provider effects remain separate.
