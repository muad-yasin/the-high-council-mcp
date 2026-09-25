import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// How the person at the terminal can type this CLI again. A hint that says `council doctor` is a
// dead end for someone who started with `npx the-high-council demo`, as the README's first
// screen tells them to: `council` is only on PATH after `npm install -g`. npx (npm 7+) runs a
// package's bin with npm_command=exec in its environment; a global install or a clone does not.
export function councilCommand(env = process.env) {
  return env.npm_command === 'exec' ? 'npx the-high-council' : 'council';
}

// Is `.env` in this directory one `git add -A` away from being committed? Vibecoders often let
// an agent commit everything, and the key file sits in their own project because that is where
// council reads it. `git check-ignore -q` exits 0 when ignored, 1 when not, 128 outside a repo;
// only 1 is worth a warning. No git on PATH, or no .env: nothing to say. Local only, no network.
export function unignoredEnvFile(dir, { exec } = {}) {
  if (!existsSync(join(dir, '.env'))) return false;
  try {
    (exec || execFileSync)('git', ['check-ignore', '-q', '.env'], { cwd: dir, stdio: 'ignore' });
    return false;
  } catch (err) {
    return err?.status === 1;
  }
}
