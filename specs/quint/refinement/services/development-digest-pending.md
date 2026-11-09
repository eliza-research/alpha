# Development digest pending storage

The as-built replay invokes `developmentDigestStore` and `localAgentStorage` using a closed request function and an in-memory filesystem. For a newly persisted reviewed request and an older saved record without a phase, writing the same payload with phase `dispatched` fails in the renderer before its CAS request reaches the host. The prior exact bytes remain stored. No provider call, credential, real profile or socket participates.
