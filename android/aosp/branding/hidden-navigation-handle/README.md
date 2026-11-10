# Hide Alpha's taskbar navigation indicator

This patch changes only drawing for Launcher3's `R.id.stashed_handle` when the existing
`config_alpha_home_back_only` product flag is true. Other uses of `StashedHandleView`,
including the bubble-bar handle, call the original `View.draw()`. The view, its layout,
visibility, sampling, animations, touch regions, insets and accessibility properties stay
unchanged. No Home, Back, Recents or horizontal-switch behavior is changed here.

The physical inspection that motivated this candidate identified `Taskbar` as the visible
navigation window. The SystemUI fallback is handled separately by setting both
`navigation_bar_home_handle_*_color` resources to transparent in the existing
`AlphaSystemUIOverlay`. That shared paint also covers rotated SystemUI handles. Navigation
dimensions and button icon colors are not changed.

`manifest.json` binds the exact Launcher3 revision, preimage, patch and resulting source
hashes. Run these commands from this folder with installed Python, Git, a JDK17+ and an
Android API36 SDK:

```sh
python3 prepare.py
python3 test_hidden_handle.py
```

Generated baseline/staged source stays in ignored `.cache/`. Existing exact offline source
can be reused with `prepare.py --inputs-root /path/to/inputs` and
`ALPHA_HIDDEN_HANDLE_INPUTS=/path/to/inputs python3 test_hidden_handle.py`. Tests reuse the
portable tool discovery in the sibling `system-entry` package (`JAVA_HOME`, Android SDK
environment variables, or standard installed locations); nothing installs an SDK.

For owner-reviewed source admission, `apply.py /path/to/Launcher3` checks the exact Git
revision, affected-file hashes and the existing default-off Alpha bool supplied by
`home-back-keyboard.patch`. It makes no source changes unless `--apply` is added. Exact
already-applied source is recognized; drift, symlinks and partial state are rejected.

Host execution and API36 compilation cover the draw guard only. Full Launcher3/SystemUI
overlay compilation, packaged resource readback, image build/boot and physical verification
remain separate gates. Test the indicator across light/dark content, Home/app/lockscreen,
keyboard, rotation, transient taskbar states, and long press. Preserve working Home, edge
Back, IME and accessibility fallback. Confirm bubble-bar affordances still render. No wipe
or user-setting rewrite is part of this change.
