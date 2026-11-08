# Home launcher failure notices

`HomeFailureNotice` observes every shared launcher update delivered to the
installed Home host. The model records the last error, status and app-list
identity and whether a launch toast already accounts for the next read.
Home publishes a new error or a newly failed inventory that removes a
favorite. The drawer, edit bar and other app views own their own surfaces.

Nine source schedules compare 71 checkpoints. They use the actual shared
launcher and Home callback with controlled inventory, launch and favorites
ports. They cover repeated read failures, recovery, failed launch followed
by failed refresh, stale app rejection, edit save failure and a launch
settling after navigation. The adapter records actual emitted toasts and
reads the four private notice fields through a build-time observer.

The campaign starts with a settled inventory and bounds snapshot identities
and notice history. Native activity launch, inventory lifecycle, multiple
profiles and favorites durability remain separate obligations.

```sh
node --test test/quint-home-failure-notice.test.mjs
```
