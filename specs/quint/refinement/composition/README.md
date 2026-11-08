# Application composition campaigns

`ApplicationComposition` retains the combined Identity, Calendar, Inbox, Voice,
Resident and Reset contracts. Its original browser campaign checks account and
inference replacement through the actual renderer coordinator.

`ControllerComposition` adds nine bounded browser schedules through the actual
ConnectionController, Calendar host and shared voice session. Native storage,
Cloud responses, microphone and speaker remain controlled external ports. The
new campaign separates native credential activation from renderer publication,
keeps already-dispatched Calendar effects with their captured owner, and checks
voice retirement when identity controls open or the document becomes hidden.

The two models preserve separate scopes. The controller campaign's native
authentication transitions are contract macros. Intermediate subscriber ordering,
full Inbox/Resident/Reset composition and installed provider behavior still need
separate evidence.

```sh
node --import=tsx specs/quint/refinement/composition/index.mjs
node --test test/quint-composition-refinement.test.mjs
```

Receipts are written under `test-results/quint-refinement`. Each binds model,
manifest, driver and implementation inputs captured before source execution.
