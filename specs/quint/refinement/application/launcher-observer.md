# Shared launcher observer

`LauncherObserver` follows the prepared shared `observeLauncher` and system
launcher bridge. Package notifications, document resume and visible
visibility changes share one 120 ms timeout. Retirement disarms that timeout
and claims listener cleanup once, including when registration settles late.
Late package notifications leave a retired observer idle.

The source campaign executes twelve schedules with a real `EventTarget` and
controlled timer and native listener ports. It observes the actual debounce
handle, refresh calls and cleanup calls before and after each operation.
The schedules cover notifications while hidden, overlapping signals, late
registration, repeated retirement, registration failure and rejected removal.

The model bounds one observer, one subscription and four refreshes.
Inventory loading and native launch have separate models. A rejected remove
leaves the OS-level listener outcome unresolved.

```sh
node --test test/quint-launcher-observer.test.mjs
```
