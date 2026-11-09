# Retained reminder tap admission

The reminder adapter checks the foreground, connection chooser, sensitive
context, and Calendar form before reading a saved notification link. It asks
the shell to open the exact reminder, then waits for the render callback
before acknowledging the token. At baseline `d7f851eca6`, a chooser, sensitive
context, or Calendar form could take precedence during that wait and the
original token was still consumed. Backgrounding already prevented consumption.

The adapter now checks the same eligibility after the render callback. It also
requires the exact reminder and the same Calendar navigation. If any check
fails, the adapter leaves the pending token in native custody. Closing the
chooser can start a fresh attempt through the existing connection listener.

The closed VM runs the actual reminder adapter and reminder row projector. A
synthetic shell holds the actual `setState` callback and records its view,
navigation and detail. Synthetic native custody records the token used in each
consume call and accepts it only if it matches the pending token. The replay
checks uninterrupted consumption, all four eligibility changes, chooser-close
retry, leaving and returning to the same detail, replacing the detail, and
replacement by a newer native token.

The scope is one reminder occurrence, two opaque tokens, and up to four
navigation calls. The replay covers the renderer admission decision and the
observed native port call. Actual Android delivery, encrypted custody and alert
removal, mounted DOM visibility, wake coalescing or mount replacement, and the
question review and draft lifecycle remain separate. The legacy
`reminderOpened` refresh path also has a separate navigation contract.
