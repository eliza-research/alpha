# First-send draft migration

Alpha can copy a first-send draft from its no-conversation slot into the selected
conversation. The cleanup waits for the destination copy, reads the source
receipt, and clears the exact source bytes with compare-and-exchange. At
baseline `6108e927db`, a held source read could outlive the shell, the selected
binding, or the matching destination copy. The helper still issued the clear.

The helper now rechecks ownership after each read and confirms the destination
again after the source read. A changed binding or retired shell exits before
dispatch. A disagreeing destination can use the existing bounded retries. The
source receipt still carries its exact revision and sending marker. A newer
source revision rejects the old compare-and-exchange, even when its text matches.

The closed replay executes the actual Alpha helper and shared draft CAS over
two in-memory raw slots. It holds the reads, existing retry timers, and source
CAS. The model observes both records and read receipts, the shell binding and
lifetime, and the revision, ownership and destination snapshot at dispatch.
It covers destination disagreement, rebind, retirement, marked sources,
competing source revisions, recovery on retry, and a destination write after
clear dispatch.

The final confirmation and dispatch form one replay step. The two slots have
independent persistence. A destination change after that confirmation, including
while the source CAS is in flight, can still leave no saved copy of the original
text. The replay does not establish cross-slot atomicity, same-key binding
generation fencing, installed persistence, or conversation transport behavior.
