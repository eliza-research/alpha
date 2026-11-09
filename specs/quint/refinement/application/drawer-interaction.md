# Apps drawer interaction

`DrawerInteraction` follows the mounted Alpha Home adapter and shared React
Apps drawer. It models a held pointer, current menu ownership, focus inside
and outside the drawer, search and inventory changes, the Home pin command,
and App Info dispatch by exact component and profile.

The source campaign mounts the actual drawer in Chromium and compares 134
checkpoints in 22 schedules. It drives real DOM handlers and React commits
with controlled timer, package inventory, storage and App Info ports.
It observes the committed menu, actual focus and both launcher handoff
targets. A retained timer cannot reopen a removed entry, and the restored
tile loses focus when a subsequent launch temporarily disables it.

App Info failure can arrive after the drawer closes or its target is
removed. The campaign keeps that same Home owner mounted and checks the
current failure notice without disturbing a newer menu. It bounds two
app identities and pointer IDs, four query classes and one App Info request.
Owner replacement, concurrent native handoffs, physical touch and actual
Android screen delivery require separate evidence.

```sh
node --test test/quint-drawer-interaction.test.mjs
```
