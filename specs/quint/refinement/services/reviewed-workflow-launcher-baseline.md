# Reviewed workflow launcher baseline before custody repair

Git commit `eadc3dd782c7dace9017329074216c86b1c02a3e` preserves the exact
baseline launcher, Quint model, source fixture and focused test. The launcher
SHA-256 was
`52b6ae41e1a758b2b15f4e5dbec31e888c04cb11262c7e40445c6289e515babd`.
The model SHA-256 was
`b20768e933bedd3255bfaedaf4020ad746dfa387b55b885360c0f68423af2fc8`.

The archived default receipt recorded 15 schedules and 84 checkpoints, with
SHA-256 `315010ba3c758ecbf6aa9ef2997b1398633d1a51bbe18e9884366e57bc67d28f`.
The opt-in Bun 1.4.2 receipt recorded 18 schedules and 108 checkpoints, with
SHA-256 `35a882428db48cce6b8940af90a8fb720eb214a0988a9e55311a4cd80df61de1`.
Both focused campaigns can be replayed from the baseline commit.

The `git-metadata` schedule refused the post-spawn Git revision query.
The `write-metadata` schedule obstructed `process.json` with a private scratch
directory. In both schedules, the launcher import rejected before installing
signal and exit handlers, and the synthetic child still answered over
private IPC. The fixture reaped its own child after collecting evidence.

The corrected launcher captures the revision before spawn and holds child
custody through receipt publication. Its current results use separate
receipts and a safety invariant for failed-handoff cleanup.
