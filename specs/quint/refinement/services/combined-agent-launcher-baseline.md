# Combined launcher baseline before custody repair

Git commit `3ef046a271bf538215723f56262aec5619ad5859` preserves the exact
launcher, Quint model, source fixture and focused test used for this
observation.

The baseline receipt `CombinedAgentLauncherBaseline.json` in the campaign
output recorded 20 source schedules and 156 checkpoints. Its SHA-256 was
`3c736151de342ce2a8aba8a319f0c3f2f120de561f468277de5eccda4a42c3c3`.
The launcher SHA-256 was
`ec24f6c9e8a50f99e2a1702a86b9ad13b759850a412265b412f4258690f5375e`.
The model SHA-256 was
`49b901bcb8d2385e041089681141d03703b50a63595c941e3f7d3215ff6e269f`.
The focused campaign can be replayed from that commit.

In the `metadata-write` schedule, the child process returned before
`process.json` was written. A private scratch directory obstructed the
write. The launcher import rejected with EISDIR and the child still
acknowledged boot over private IPC. Metadata was absent, supervision had
never been attached, the log was open and
`ChildCustodyAfterLaunch` was false. The baseline harness reaped its own
child after collecting the observation.

The corrected source uses separate current model checks and receipts.
