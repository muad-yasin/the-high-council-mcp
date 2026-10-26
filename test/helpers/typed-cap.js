// Tests that start a PAID chain through the CLI (a keyed seat on a local stub server) meet the typed limit (0.8.3 M6 typed cap T4a): the start exits 21 with the screen on disk, a person types a limit, `--resume` continues.
// This answers the pending limit gate through the SAME answerGate the terminal form calls (channel cli, the person's typed text parsed against the bound ceiling): a test does what a person does, and no bypass exists in the product.
// Not a test file.
import { answerGate, listGates, readGateAnswer, RUN_CAP_KIND } from '../../src/gate.js';

/** Types `typed` dollars for the run folder's newest PENDING limit gate; returns the gate id. Throws when there is none (a test that expected exit 21 and got something else should fail here, loudly). */
export function typeCap(runDir, typed = '100') {
  const gates = listGates(runDir) ?? [];
  const pending = gates.map(g => ({ id: g.id, state: readGateAnswer(runDir, g.id) })).filter(g => g.state.status === 'pending' && g.state.gate?.kind === RUN_CAP_KIND).at(-1);
  if (!pending) throw new Error(`typeCap: ${runDir} has no pending limit gate (${JSON.stringify(gates)})`);
  const r = answerGate(runDir, pending.id, { channel: 'cli', shownSha256: pending.state.gate.sha256, decision: 'approved', actor: 'test', tty: true, typedCap: typed });
  if (!r.ok) throw new Error(`typeCap: ${r.code}: ${r.message}`);
  return pending.id;
}

/**
 * Starts a paid run the way a person must now: the start (`startArgs`) exits 21 and waits; the limit is typed for the pending gate (`typed` dollars); `--resume <runDir>` continues the same run and its outcome is returned.
 * `run(args)` is the test's own way to spawn the CLI and must resolve to an object with `code` (or `status`). A start that does NOT exit 21 (a refusal before the gate, a free chain) is returned unchanged, so the same call serves tests of those too.
 * `runDir` is the run folder, or a function that finds it once the start has made it.
 */
export async function startTyped(run, startArgs, runDir, typed = '100') {
  const first = await run(startArgs);
  if ((first.code ?? first.status) !== 21) return first;
  const dir = typeof runDir === 'function' ? runDir() : runDir;
  typeCap(dir, typed);
  return run(['--resume', dir]);
}
