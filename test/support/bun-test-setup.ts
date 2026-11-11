// Loaded before every `bun test` file (bunfig.toml). Bun's default per-test limit is five
// seconds; this suite compiles Java and runs model checkers inside tests and states its own
// limit where one matters, as it did under a runner with no default.
import { setDefaultTimeout } from 'bun:test';

setDefaultTimeout(600_000);
