// 0.8.4 the Claude route, WIRING (Builder B): every site that turns a chain into a roster goes through the route (derived from the source of src/, with the reason for each site that does not). The list of entry points is DERIVED from the code: a new call of
// resolveChainSeats outside the ones named here fails this test, so a site added later cannot skip the route in silence. NO RED OF ITS OWN: no function argument; on the tree before this unit it fails at the first assertion (the call sites differ).
// RE-DERIVE AFTER A MERGE: the counts below are the counts of this tree; a merge that adds or removes a call (the ladder's) moves them, and the new total is read, not guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('RS-1: every site that turns a chain into a roster goes through the route; the sites that do not are the ones named here, with their reason', () => {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
  const found = new Map();
  for (const f of walk(join(root, 'src'))) {
    const n = (readFileSync(f, 'utf8').match(/\bresolveChainSeats\(/g) ?? []).length;
    if (n) found.set(f.slice(root.length + 1), n);
  }
  // the places resolveChainSeats is still called by name, and why each is not behind the route. chain.js: its definition, runChain's own second pass (idempotent) and nothing else; resolve-run.js: the one caller that routes; chain-lint.js: reads the roster of the config it is
  // given (a routed config resolves to itself); cli.js: the route-decide verb (reads a run's chain for its seat keys only) and the digest verb's policy read, the resolution by the unrouted view for the fingerprint, and the fallback when a route stop leaves the CLI to report it;
  // server.js: the fall-back to the unrouted roster after a stop in the caps read and in the price-raise read (the child reports the stop), and the paid-seat read (paid either way); providers.js: a comment.
  // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: 'src/resolve-run.js': 3 (Builder B's fix-up moved the pin from 2 to 3 because the tree before the session route already had 3 of them: the unrouted view, the priced-on helper and the final return). NEW: 4: the session branch of resolveRun resolves the converted chain once more, and it IS the one caller that routes. WHY: the count is read from the source; re-derived with grep -o on this tree.
  const EXPECTED = { 'src/chain.js': 2, 'src/resolve-run.js': 4, 'src/chain-lint.js': 3, 'src/cli.js': 2, 'src/mcp/server.js': 3, 'src/providers.js': 1 };      // providers.js: a comment that names it
  assert.deepEqual(Object.fromEntries([...found].sort()), Object.fromEntries(Object.entries(EXPECTED).sort()), 'a new call site of resolveChainSeats must either go through resolveRun (src/resolve-run.js) or be named here with its reason');
  // and the sites that route: each of these files calls resolveRun (or routeRun / routedRoster, which call it)
  for (const [file, re] of [['src/cli.js', /\brouteRun\(/g], ['src/tree-start.js', /\bresolveRun\(/g], ['src/api.js', /\bresolveRun\(/g], ['src/mcp/server.js', /\broutedRoster\(/g]]) {
    assert.ok((readFileSync(join(root, file), 'utf8').match(re) ?? []).length >= 1, `${file} routes`);
  }
  const cliText = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  assert.ok((cliText.match(/\brouteRun\(/g) ?? []).length >= 5, 'the CLI routes at the main run, the handoff, the rematch, the replay and the replay hook');
  assert.ok(/resolveRun\(cfg, \{ env: process\.env \}\)/.test(cliText), 'doctor lists the roster as the route sends it');
});
