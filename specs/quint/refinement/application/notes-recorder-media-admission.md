# Notes recorder media admission

The mounted canonical Notes renderer exercises its real **Play recording**,
**Back to notes**, and **Record voice note** controls. A separate schedule invokes
the same control that `notes_record` uses. The browser retains a synthetic audio
blob in the actual Notes recording store. Chromium media and the canonical
transport use closed fixtures.

At baseline `13f7b2496d`, both recorder entry points reached `recording` while
the saved playback stop was held. The browser port recorded a microphone start
between `stop-request` and `stop-confirmed`. The agent-facing control already
reported `started` while the stop was held.

The recorder now awaits the media drain in the same startup epoch that owns the
canonical Notes destination. It rechecks that epoch, destination and active view
before asking the capture port to start. An unconfirmed stop blocks fresh capture
and gives the current recorder an error message. A retired attempt does not
publish or claim a replacement attempt’s result.

The Quint replay compares the mounted recorder phase, canonical owner, shell
view and exact startup attempt. It also compares the shutdown outcome and the
identity and timing of the synthetic microphone call. The schedule families cover
the mounted button and agent-facing control, a refused stop, a fresh Notes visit
after leaving during the wait, and canonical owner replacement. A raw late-capture
claim is checked as disabled in Quint after owner replacement.

The bound is one saved audio session, two canonical owners, two recorder start
epochs and one agent-facing control result per schedule. Installed Android audio
focus and microphone access, recovered recordings, pause and resume, recording
save, and interactions with other speech and app surfaces remain separate.
