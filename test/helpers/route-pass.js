// S20 slice 2, control 1: the flag `--next-pass-layer-3` only RECORDS a request and exits 27; the pass starts at layer 3 after the handler's decision (`council route-decide`) and a plain resume. This helper does the first two steps for a test project `p`
// (any object with run(args) and runDir(), as the b3 tests build them) and returns both results; the plain resume that starts the pass is the caller's, so each test keeps its own assertions about it.
import assert from 'node:assert/strict';

// R2-tty (Mini-C&C R417, R418): a spawned child has no terminal, and the bare flag records a request only from one (the person's own), so the tests ask the relayed way: the handler session gives the person's words with `--person-words`.
// The terminal's own form is tested in process with scripted streams (test/route-tty.test.js).
export const PERSON_WORDS = 'Yes, start the next pass at layer 3.';
export const RECORDED = /a request to start the pass at layer 3 is recorded \(request \d+\)/;

export const routeNextPass = (p, { reason = 'the plan is ready for the overseer' } = {}) => {
  const flag = p.run(['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS]);
  assert.equal(flag.status, 27, `the flag records a request and exits 27: ${flag.stdout}${flag.stderr}`);
  const n = /\(request (\d+)\)/.exec(flag.stdout)?.[1];
  assert.ok(n, `the flag names its request: ${flag.stdout}`);
  const decision = p.run(['route-decide', p.runDir(), n, '--route', '--reason', reason]);
  assert.equal(decision.status, 0, `route-decide records the route: ${decision.stdout}${decision.stderr}`);
  return { flag, decision, request: Number(n) };
};
