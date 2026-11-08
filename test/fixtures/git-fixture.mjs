import {execFileSync} from 'node:child_process';

// Fixture repositories ignore the developer's global and system Git config, so signing,
// hooks and identity settings there cannot break or change a test commit.
const env = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
const config = ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
  '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'init.defaultBranch=main'];

export function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...config, ...args], {env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
