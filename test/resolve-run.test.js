// 0.8.4 the Claude route, WIRING (Builder B): src/resolve-run.js, the ONE place a run's chain gets its Claude route (resolveRun = read the setting, ask whether the chain has a direct Claude seat, decide from the keys, route, resolve), and what it hands the sites.
// SHAPE (the twin-cost pattern, C&C 10 Nov 2026): each property is a CHECK that takes the function under test as an argument. The checks run on the real resolveRun and then on hand-made WRONG functions in this file, each of which must fail at the check's own assertion
// (an AssertionError, not a TypeError), so a check that could not fail is caught. The module is read through a dynamic import: on a tree without it every test shows red by name instead of the file failing to load.
// WHAT IS PINNED, by test: RR-1..RR-5 (checks with wrong functions; RR-5b counts them): a dry run is never stopped by a key state; a value that is not a route refuses the start on ANY chain, from the flag and from COUNCIL_CLAUDE_ROUTE; a chain with no direct Claude seat is never stopped by a key state
// (a malformed Anthropic key does not stop a mock or China chain), while a mock chain whose security review is on DOES have one (the default reviewer); every slot everySeatSlotsOf lists, the default security reviewer and preflight.seats included, is routed and
// nothing is left direct; an existing run is never moved by its run.json (a planted route can only cause a refusal; the person's own choice is obeyed). RR-6: resolving twice gives the same chain (resolveVendorSeat is idempotent on its own marker, and a seat the person
// seated on OpenRouter keeps going through its identity row). RR-7: the key view (mergedKeyEnv) equals what the CLI's real key check sees, and a project .env can never set COUNCIL_CLAUDE_ROUTE. RR-8: the cache fingerprint is made from the chain WITHOUT the route.
// RR-9: every shipped chain routes with no direct Claude seat left, every routed model has a price row and a window; the lint of a routed chain reports what the direct one does. RR-10: plan-claude-council routed end to end: the eight keys, the dry run's row labels,
// the twins' "-2" rows, a routed copy that lost its key throws. (RR-11, every call site of the route, is test/route-call-sites.test.js.)
// CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: `session` was a value that was refused on any chain, from the flag and from COUNCIL_CLAUDE_ROUTE (with a code of its own), and a run.json that said `session` read as a direct run. NEW: `session` is a route, decided before any key is looked at (RR-S1..RR-S9 below);
// only a value that is not one of the four refuses a start (RR-1), `recordedRouteOf` reads `session`, and a bare resume of a session run stays a session run (RR-S7). WHY: the session route is built (src/resolve-run.js step 1b). The new exports (stillBillingOf, sessionModelOf) are read through a namespace, so on an older tree each test fails by itself instead of the whole file at load.
// NO RED OF THEIR OWN (named up front; their can-fail evidence is the wrong functions of RR-1..RR-5): RR-6, RR-7, RR-8, RR-9 and RR-10 take no function argument (and RS-1 in test/route-call-sites.test.js); on the tree before this unit they fail at their first assertion because resolveRun does not exist (a missing
// export is not a red: the PASS names these).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChainSeats, everySeatOf, everySeatSlotsOf, checkSeats } from '../src/chain.js';
import { resolveVendorSeat } from '../src/providers.js';
import { claudeRouteFacts } from '../src/claude-route.js';
import { applyEnvFile } from '../src/env-file.js';
import { fingerprintInputs } from '../src/cache-integrity.js';
import { registerSeatKeys, seatKeyOf, assertSeatKeyed } from '../src/seat-key.js';
import { estimateChainRows } from '../src/cost.js';
import { twinViolations } from './helpers/twin-rows.js';
import { lintChain } from '../src/chain-lint.js';
import { contextWindowOf } from '../src/context-window.js';
import { OPEN_INFERENCE } from '../src/host-block.js';
import { DEFAULT_SECURITY_REVIEWER_SEAT } from '../src/security-review.js';

const RR = await import('../src/resolve-run.js').catch(() => ({}));
const CR = await import('../src/claude-route.js').catch(() => ({}));      // namespace read: sessionModelOf and applySessionRoute may not exist on an older tree
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));

// ---- the fixtures -------------------------------------------------------------------------------------------------------------------------------------------------------------------
const KEY = { usable: 'sk-test-dummy-key', malformed: 'sk-test-dummy\nkey' };
const envOf = (anthropic, openrouter, extra = {}) => ({ ...(anthropic !== 'absent' ? { ANTHROPIC_API_KEY: KEY[anthropic] } : {}), ...(openrouter !== 'absent' ? { OPENROUTER_API_KEY: KEY[openrouter] } : {}), ...extra });
const mock = model => ({ provider: 'mock', model });
const claude = (model, extra = {}) => ({ provider: 'anthropic', model, ...extra });
const small = () => ({ name: 'small', seats: { criteria: mock('mock-criteria'), builder: mock('mock-builder'), critics: [claude('claude-sonnet-5-5', { lab: 'sonnet5.5', layer: 1 }), claude('claude-haiku-5-5', { lab: 'haiku5.5', layer: 1 })] } });
const noClaude = () => ({ name: 'no-claude', seats: { builder: mock('mock-builder'), critics: [{ provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', lab: 'qwen' }, mock('mock-critic-a')] } });
const mockOnly = (extra = {}) => ({ name: 'mock-only', seats: { criteria: mock('mock-criteria'), builder: mock('mock-builder'), critics: [mock('mock-critic-a')] }, ...extra });
// the slot names are READ from src/chain.js (they are not exported; chain.js is a ladder file), as test/claude-route.test.js CR-12 does: a slot added later is given a Claude seat here
const slotKeysOf = name => { const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(readFileSync(join(root, 'src', 'chain.js'), 'utf8')); assert.ok(m, `${name} is declared in src/chain.js`); return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]); };
const everySlot = ({ explicitReviewer = false } = {}) => {
  let n = 0;
  const next = () => claude(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'][n++ % 4], { lab: `lab${n}` });
  const seats = {};
  for (const k of slotKeysOf('SINGLE_SEAT_KEYS')) if (k !== 'security_reviewer' || explicitReviewer) seats[k] = next();
  for (const k of slotKeysOf('LIST_SEAT_KEYS')) seats[k] = [next(), mock('mock-builder')];
  seats.descending = { one: next(), two: mock('mock-builder') };
  return { name: 'every-slot', security_review: { enabled: true }, seats, preflight: { seats: [next(), mock('mock-critic-a')] } };
};
const directSeats = c => everySeatOf(c).filter(s => s.provider === 'anthropic');

// ---- the checks: each takes the function under test ------------------------------------------------------------------------------------------------------------------------------
// CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: the values refused were `session`, ' Session ', 'nonsense' and '1', and `session` had a code of its own. NEW: `session` is a route (RR-S1), so it is no longer in the list; every value left has the code unknown_value and the sentence is asserted WHOLE, ending in the four routes (SSW-w6). WHY: the session route exists.
const checkValueErrors = resolve => {
  for (const [name, cfgOf] of [['a Claude chain', small], ['a chain with no Claude seat', noClaude], ['a mock chain', mockOnly]]) {
    for (const value of ['nonsense', '1', 'openrouters', 'sessions']) {
      for (const via of ['the flag', 'the setting']) {
        const r = resolve(cfgOf(), via === 'the flag' ? { flag: value, env: envOf('usable', 'absent') } : { env: envOf('usable', 'absent', { COUNCIL_CLAUDE_ROUTE: value }) });
        const where = `${name}, ${via} ${JSON.stringify(value)}`;
        assert.equal(r.stop, true, `${where}: the start is refused`);
        assert.equal(r.code, 'unknown_value', where);
        assert.equal(r.message, `${via === 'the flag' ? '--claude-route' : 'COUNCIL_CLAUDE_ROUTE'}: ${JSON.stringify(value)} is not a Claude route. Use auto, anthropic, openrouter or session. Nothing was started and nothing was spent.`, `${where}: the whole sentence, naming where the value came from and all four routes`);
      }
    }
  }
};
const checkNothingToRoute = resolve => {
  for (const [name, cfgOf] of [['a chain with no Claude seat', noClaude], ['a mock chain', mockOnly]]) {
    for (const o of [{ env: envOf('malformed', 'malformed') }, { env: envOf('malformed', 'usable'), flag: 'openrouter' }, { env: envOf('absent', 'malformed') }]) {
      const r = resolve(cfgOf(), o);
      assert.equal(r.stop, undefined, `${name}, ${JSON.stringify(Object.keys(o.env))}: no key state stops a chain with nothing to route`);
      assert.equal(r.route, 'anthropic'); assert.equal(r.why, 'no_claude_seat'); assert.deepEqual(r.routed, []);
      assert.deepEqual(r.config, resolveChainSeats(cfgOf()), `${name}: the chain comes back as it always did`);
    }
  }
  // the default security reviewer IS a direct Claude seat that no chain file names: a mock chain with the review on has one, so a malformed Anthropic key stops it, and with only an OpenRouter key the reviewer is routed
  const stopped = resolve(mockOnly({ security_review: { enabled: true } }), { env: envOf('malformed', 'usable') });
  assert.equal(stopped.stop, true, 'a mock chain with the security review on has a direct Claude seat (the default reviewer)'); assert.equal(stopped.code, 'anthropic_key_malformed');
  const routed = resolve(mockOnly({ security_review: { enabled: true } }), { env: envOf('absent', 'usable') });
  assert.equal(routed.route, 'openrouter'); assert.equal(routed.config.seats.security_reviewer.provider, 'openrouter'); assert.equal(routed.config.seats.security_reviewer.model, 'anthropic/claude-fable-5.1');
};
const checkEverySlot = resolve => {
  for (const explicitReviewer of [false, true]) {
    const c = everySlot({ explicitReviewer });
    const before = everySeatSlotsOf(c);
    const claudeBefore = before.filter(x => x.seat.provider === 'anthropic');
    assert.ok(before.length >= slotKeysOf('SINGLE_SEAT_KEYS').length + 2 * slotKeysOf('LIST_SEAT_KEYS').length + 4, 'the fixture fills every slot everySeatSlotsOf lists');
    assert.equal(claudeBefore.some(x => x.role === 'security_reviewer (default)'), !explicitReviewer, 'the default reviewer is listed exactly when no reviewer is named');
    const r = resolve(c, { flag: 'openrouter', env: envOf('absent', 'usable') });
    assert.equal(r.route, 'openrouter');
    const after = everySeatSlotsOf(r.config);
    assert.equal(after.length, before.length, `${explicitReviewer ? 'explicit' : 'default'} reviewer: the same number of slots is listed after the route`);
    assert.deepEqual(directSeats(r.config), [], 'no direct Claude seat is left in ANY slot');
    assert.equal(after.filter(x => x.seat.originalProvider === 'anthropic').length, claudeBefore.length, 'every direct Claude seat came back routed');
    for (const { seat } of after.filter(x => x.seat.originalProvider === 'anthropic')) {
      assert.equal(seat.provider, 'openrouter'); assert.match(seat.model, /^anthropic\/claude-/);
      assert.ok(seat.extra.provider.ignore.includes(OPEN_INFERENCE), 'the host ban rides every routed seat');
    }
    assert.equal(r.config.preflight.seats[0].provider, 'openrouter', 'preflight.seats is routed AND resolved (resolveChainSeats visits it)');
    assert.equal(r.config.preflight.seats[1], c.preflight.seats[1], 'a seat that is not Claude is the very same object');
  }
};
const checkRecorded = resolve => {
  const c = () => small();
  const stopsWith = (o, keep, change) => {
    const r = resolve(c(), o);
    assert.equal(r.stop, true, JSON.stringify(o)); assert.equal(r.code, 'route_changed');
    assert.ok(r.message.includes(keep) && r.message.includes(change) && /Nothing was started and nothing was spent\.$/.test(r.message), r.message);
  };
  // an auto decision that differs from the route the run began with STOPS and names both ways out (the default wording: "--claude-route <route>")
  stopsWith({ env: envOf('usable', 'absent'), recorded: { route: 'openrouter' } }, '--claude-route openrouter', '--claude-route anthropic');
  stopsWith({ env: envOf('absent', 'usable'), recorded: { route: 'anthropic' } }, '--claude-route anthropic', '--claude-route openrouter');
  // an entry point that words the choice differently names ITS way
  const mcp = resolve(c(), { env: envOf('usable', 'absent'), recorded: { route: 'openrouter' }, choose: r => `the claude_route argument set to "${r}"` });
  assert.ok(mcp.stop && mcp.message.includes('the claude_route argument set to "openrouter"') && !mcp.message.includes('--claude-route'), 'the MCP wording names the argument, not a flag');
  // the person's own choice is obeyed, whatever the file says: a PLANTED route never moves a seat
  const planted = resolve(c(), { flag: 'anthropic', env: envOf('usable', 'usable'), recorded: { route: 'openrouter' } });
  assert.equal(planted.stop, undefined); assert.equal(planted.route, 'anthropic'); assert.equal(directSeats(planted.config).length, 2, 'a run.json that says openrouter does not move a seat the person sent to Anthropic');
  const asked = resolve(c(), { flag: 'openrouter', env: envOf('usable', 'usable'), recorded: { route: 'anthropic' } });
  assert.equal(asked.route, 'openrouter'); assert.deepEqual(directSeats(asked.config), [], 'a route the person asks for on a resume is used');
  // the same decision as the run began with: nothing to say
  for (const [o, route] of [[{ env: envOf('usable', 'absent'), recorded: { route: 'anthropic' } }, 'anthropic'], [{ env: envOf('absent', 'usable'), recorded: { route: 'openrouter' } }, 'openrouter']]) {
    const r = resolve(c(), o); assert.equal(r.stop, undefined, JSON.stringify(o)); assert.equal(r.route, route);
  }
  // a run folder from BEFORE this unit (a run.json with no claude_route at all) resumes direct with no stop, by a person with an Anthropic key; and the stop for a person who now holds only an OpenRouter key is the route_changed one above
  const oldFolder = { chain: 'small', task: 'tasks/x.md', cwd: '/x', startedAt: '2026-10-01T10:00:00.000Z' };
  assert.equal(typeof RR.recordedRouteOf, 'function');
  const old = resolve(c(), { env: envOf('usable', 'absent'), recorded: { route: RR.recordedRouteOf(oldFolder) } });
  assert.equal(old.stop, undefined, 'a run folder from before the route resumes with no stop'); assert.equal(old.route, 'anthropic'); assert.equal(directSeats(old.config).length, 2, 'and direct');
  // a run with no record is a direct run: recordedRouteOf (the CLI reads run.json through it) says anthropic
  assert.equal(typeof RR.recordedRouteOf, 'function'); assert.equal(RR.recordedRouteOf({}), 'anthropic'); assert.equal(RR.recordedRouteOf(undefined), 'anthropic'); assert.equal(RR.recordedRouteOf({ claude_route: 'openrouter' }), 'openrouter');
  // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: recordedRouteOf({ claude_route: 'session' }) was 'anthropic' (a value that is not a route in a file reads as the default). NEW: it is 'session' (a run that began as a session run says so); a value that is not a route in a file still reads as the default. WHY: `session` is a route, and a bare resume of a session run must stay one (RR-S7).
  assert.equal(RR.recordedRouteOf({ claude_route: 'session' }), 'session', 'a run that began as a session run says so');
  assert.equal(RR.recordedRouteOf({ claude_route: 'anthropic' }), 'anthropic'); assert.equal(RR.recordedRouteOf({ claude_route: 'nonsense' }), 'anthropic', 'a value that is not a route in a file reads as the default, and never moves a seat');
};

const checkDry = resolve => {
  // a DRY RUN calls nothing and needs no key: a key state that stops a start never stops it, and it is priced on the direct route
  // CHANGED ACCEPTED (10 Nov 2026, C3): OLD: all three cells priced direct. NEW: the cell (Anthropic absent, OpenRouter malformed) is priced through OpenRouter, because that is the route the start takes once the person mends the only key they have; a direct figure there priced a route that start would never take. The two malformed-Anthropic cells stay direct (mending the key gives the direct route).
  for (const [env, route] of [[envOf('malformed', 'usable'), 'anthropic'], [envOf('malformed', 'absent'), 'anthropic'], [envOf('absent', 'malformed'), 'openrouter']]) {
    const where = JSON.stringify(Object.keys(env));
    assert.equal(resolve(small(), { env }).stop, true, `${where}: the start path stops on these keys`);
    const r = resolve(small(), { env, dry: true });
    assert.equal(r.stop, undefined, `${where}: the dry run does not`); assert.equal(r.route, route, `${where}: priced on the route the start takes once the key is mended`);
    assert.equal(directSeats(r.config).length, route === 'anthropic' ? 2 : 0, route === 'anthropic' ? 'it is priced on the direct route' : 'no Claude seat is left direct');
    assert.equal(r.why, route === 'anthropic' ? 'key_state' : 'no_anthropic_key');
  }
  // an existing run (resume, rematch, replay, price raise) is priced on the route it began with while a KEY is unusable (the key state never stops a dry run), whichever way the keys would have chosen: began through OpenRouter + a malformed Anthropic key -> OpenRouter ('recorded'); began direct + only a malformed OpenRouter key -> direct
  const recOr = resolve(small(), { env: envOf('malformed', 'usable'), recorded: { route: 'openrouter' }, dry: true });
  assert.equal(recOr.stop, undefined); assert.equal(recOr.route, 'openrouter'); assert.equal(recOr.why, 'recorded'); assert.equal(directSeats(recOr.config).length, 0, 'a run that began through OpenRouter is priced through it');
  const recDirect = resolve(small(), { env: envOf('absent', 'malformed'), recorded: { route: 'anthropic' }, dry: true });
  assert.equal(recDirect.stop, undefined); assert.equal(recDirect.route, 'anthropic'); assert.equal(directSeats(recDirect.config).length, 2, 'a run that began direct is priced direct');
  assert.equal(recDirect.why, 'recorded');
  // the real resume of these two stops on the key (exit 5 at the CLI) and the dry run says so, with the real stop's own sentence; a start's dry run says nothing of the key
  assert.match(recOr.stopNote ?? '', /^ANTHROPIC_API_KEY is set, but .*--claude-route openrouter.*Nothing was started and nothing was spent\.$/, 'a person-set openrouter route runs despite the malformed Anthropic key: the sentence names it');
  assert.match(recDirect.stopNote ?? '', /^OPENROUTER_API_KEY is set, but .*Nothing was started and nothing was spent\.$/);
  assert.equal(resolve(small(), { env: envOf('malformed', 'usable'), dry: true }).stopNote, undefined, 'a start\'s dry run says nothing of the key');
  // the keys now would choose the OTHER route: a real resume stops (route_changed) and so does its dry run, which never shows a price for a resume the real verb would refuse; the stop names the flag that prices the other route, and that flag is obeyed by the dry run
  for (const [env, recorded, chose] of [[envOf('usable', 'absent'), 'openrouter', 'anthropic'], [envOf('absent', 'usable'), 'anthropic', 'openrouter']]) {
    const stopped = resolve(small(), { env, recorded: { route: recorded }, dry: true });
    assert.equal(stopped.stop, true, 'a dry run of an existing run stops when the keys would choose the other route'); assert.equal(stopped.code, 'route_changed'); assert.ok(stopped.message.includes(`--claude-route ${chose}`), stopped.message);
    const asked = resolve(small(), { flag: chose, env, recorded: { route: recorded }, dry: true });
    assert.equal(asked.stop, undefined, 'the person-asked change is priced, not stopped'); assert.equal(asked.route, chose);
  }
  // a value that is not a route still refuses a dry run
  // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: the value used here was 'session'. NEW: 'nonsense' (a session dry run is priced, never refused: RR-S1). WHY: `session` is a route.
  assert.equal(resolve(small(), { flag: 'nonsense', env: envOf('usable', 'absent'), dry: true }).stop, true, 'a value that is not a route refuses a dry run too');
  assert.equal(resolve(small(), { env: envOf('absent', 'usable'), dry: true }).route, 'openrouter', 'with only an OpenRouter key the dry run prices the routed chain');
};

// ---- the wrong functions: each is the real one with ONE rule taken away ------------------------------------------------------------------------------------------------------------
const real = (...a) => RR.resolveRun(...a);
const WRONG = {
  valueErrors: { 'ignores the setting': (c, o) => real(c, { ...o, flag: undefined, env: { ...o.env, COUNCIL_CLAUDE_ROUTE: undefined } }) },
  nothingToRoute: {
    'looks at the key before it asks whether there is a Claude seat': (c, o) => { const f = claudeRouteFacts(o.env ?? {}); return f.anthropicKey === 'malformed' ? { stop: true, code: 'anthropic_key_malformed', message: 'x' } : real(c, o); },
    'forgets the default reviewer is a Claude seat': (c, o) => real({ ...c, security_review: undefined }, o),
  },
  everySlot: {
    'drops preflight.seats': (c, o) => real({ ...c, preflight: undefined }, o),
    'forgets the default reviewer': (c, o) => real({ ...c, security_review: { enabled: false } }, o),
    'routes only the first seat of a list': (c, o) => { const r = real(c, o); return { ...r, config: { ...r.config, seats: { ...r.config.seats, critics: [c.seats.critics[0], r.config.seats.critics[1]] } } }; },
  },
  recorded: {
    'obeys the file': (c, o) => real(c, { ...o, flag: o.recorded ? o.recorded.route : o.flag, recorded: undefined }),
    'never checks the record': (c, o) => real(c, { ...o, recorded: undefined }),
  },
  dry: {
    'a key stop refuses the dry run too': (c, o) => real(c, { ...o, dry: false }),
    'a dry run skips the value check as well': (c, o) => (o.dry ? real(c, { ...o, flag: undefined, env: { ...o.env, COUNCIL_CLAUDE_ROUTE: undefined } }) : real(c, o)),
  },
};
const CHECKS = { valueErrors: checkValueErrors, nothingToRoute: checkNothingToRoute, everySlot: checkEverySlot, recorded: checkRecorded, dry: checkDry };
const ORDER = Object.keys(CHECKS);
ORDER.forEach((name, i) => {
  const titles = { valueErrors: 'a value that is not a route refuses the start on ANY chain, from the flag and from the setting, with the whole sentence (all four routes named, nothing started)',
    nothingToRoute: 'a chain with no direct Claude seat is never stopped by a key state; a mock chain with the security review on has one (the default reviewer)',
    everySlot: 'every slot everySeatSlotsOf lists, the default security reviewer and preflight.seats included, comes back routed and resolved, and no direct Claude seat is left',
    recorded: 'an existing run is never moved by its run.json: an auto decision that differs stops and names both ways out; the person\'s own choice is obeyed; no record is a direct run',
    dry: 'a dry run is never stopped by a key state (it needs no key) and is priced on the route the start takes once the key is mended; a value that is not a route still refuses it' };
  test(`RR-${i + 1}: ${titles[name]} (the check, then ${Object.keys(WRONG[name]).length} wrong function(s) that must fail it)`, () => {
    assert.equal(typeof RR.resolveRun, 'function', 'src/resolve-run.js exports resolveRun');
    CHECKS[name](RR.resolveRun);
    for (const [why, wrong] of Object.entries(WRONG[name])) assert.throws(() => CHECKS[name](wrong), { name: 'AssertionError' }, `the wrong function that ${why} must fail ${name} at an assertion`);
  });
});
test('RR-5b: the registry counts both ways: every check has its test and at least one wrong function, and every wrong function belongs to a check', () => {
  assert.deepEqual(Object.keys(WRONG), ORDER);
  for (const name of ORDER) assert.ok(Object.keys(WRONG[name]).length >= 1, `${name} has a wrong function`);
  assert.equal(ORDER.reduce((n, k) => n + Object.keys(WRONG[k]).length, 0), 10, 'ten wrong functions in all');
});

// ---- no function argument: NO RED OF THEIR OWN -----------------------------------------------------------------------------------------------------------------------------------------
test('RR-6: resolving twice gives the same chain, and the key of a repeated model survives it; a seat the person seated on OpenRouter still goes through its identity row', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const r = RR.resolveRun(everySlot(), { flag: 'openrouter', env: envOf('absent', 'usable') });
  assert.deepEqual(resolveChainSeats(r.config), r.config, 'the config is resolved once by the command line and again by runChain: the second pass changes nothing (no "no route" for anthropic/... under openrouter)');
  const seat = r.config.seats.critics[0];
  assert.equal(resolveVendorSeat(seat, 'openrouter'), seat, 'a seat this function already rewrote comes back as it is');
  const own = { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', lab: 'meta' };
  const once = resolveVendorSeat(own, 'openrouter');
  assert.notEqual(once, own, 'a seat seated on OpenRouter by the person has no originalProvider: it still goes through its identity row, as before');
  assert.equal(once.originalProvider, 'openrouter');
  assert.equal(resolveVendorSeat(once, 'openrouter'), once, 'and a second pass keeps it');
});
test('RR-7: mergedKeyEnv gives the key check\'s own answer for every combination of the shell and the project .env, never changes the process environment, and a project .env can never set COUNCIL_CLAUDE_ROUTE', () => {
  assert.equal(typeof RR.mergedKeyEnv, 'function');
  const keyText = { usable: `ANTHROPIC_API_KEY=${KEY.usable}\n`, malformed: 'ANTHROPIC_API_KEY=${user_config.anthropic}\n', absent: '' };      // `malformed` here is an unfilled template (the host's placeholder): the file sets it, the key check reads it as no key
  const saved = process.env.ANTHROPIC_API_KEY; const savedOr = process.env.OPENROUTER_API_KEY; const savedPlugin = process.env.COUNCIL_PLUGIN_ANTHROPIC_API_KEY;
  try {
    for (const shell of ['usable', 'malformed', 'absent']) for (const file of ['usable', 'malformed', 'absent']) for (const dialog of [false, true]) {
      const processEnv = { ...(shell !== 'absent' ? { ANTHROPIC_API_KEY: KEY[shell] } : {}), ...(dialog ? { COUNCIL_PLUGIN_ANTHROPIC_API_KEY: KEY.usable } : {}) };
      const frozen = JSON.stringify(processEnv);
      const merged = RR.mergedKeyEnv(processEnv, keyText[file]);
      assert.equal(JSON.stringify(processEnv), frozen, 'the process environment is never changed');
      // the CLI's own way: the file applied to the real environment, then the key check (src/chain.js checkSeats -> keyFor) reads it
      delete process.env.ANTHROPIC_API_KEY; delete process.env.COUNCIL_PLUGIN_ANTHROPIC_API_KEY; delete process.env.OPENROUTER_API_KEY;
      for (const [k, v] of Object.entries(processEnv)) process.env[k] = v;
      applyEnvFile(keyText[file], process.env);
      const checkSays = checkSeats([claude('claude-sonnet-5-5')]).length === 0 ? 'usable' : 'not usable';
      const factSays = claudeRouteFacts(merged).anthropicKey === 'usable' ? 'usable' : 'not usable';
      assert.equal(factSays, checkSays, `shell ${shell}, file ${file}, dialog ${dialog}: the route's fact equals the key check's answer`);
    }
  } finally {
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved], ['OPENROUTER_API_KEY', savedOr], ['COUNCIL_PLUGIN_ANTHROPIC_API_KEY', savedPlugin]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.equal(claudeRouteFacts(RR.mergedKeyEnv({ ANTHROPIC_API_KEY: KEY.malformed }, `ANTHROPIC_API_KEY=${KEY.usable}\n`)).anthropicKey, 'malformed', 'a malformed value in the shell is not replaced by a usable one in the file (the real environment wins)');
  const planted = RR.mergedKeyEnv(envOf('usable', 'absent'), 'COUNCIL_CLAUDE_ROUTE=openrouter\n');
  assert.equal(planted.COUNCIL_CLAUDE_ROUTE, undefined, 'a project .env cannot set the route');
  assert.equal(RR.resolveRun(small(), { env: planted }).route, 'anthropic', 'and it moves no seat');
  const plantedSession = RR.mergedKeyEnv(envOf('usable', 'absent'), 'COUNCIL_CLAUDE_ROUTE=session\n');      // the session route is operator-only too: a project file can never hand the person's text to a session, or take a Claude seat off the API
  assert.equal(plantedSession.COUNCIL_CLAUDE_ROUTE, undefined, 'a project .env cannot set the session route');
  assert.equal(RR.resolveRun(small(), { env: plantedSession }).route, 'anthropic', 'and it moves no seat');
  assert.equal(RR.mergedKeyEnv({ COUNCIL_CLAUDE_ROUTE: 'openrouter', ...envOf('usable', 'usable') }, 'COUNCIL_CLAUDE_ROUTE=anthropic\n').COUNCIL_CLAUDE_ROUTE, 'openrouter', 'the real environment\'s setting stands');
});
test('RR-8: the cache fingerprint is made from the chain WITHOUT the route, so a route change never makes a finished stage stale', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const r = RR.resolveRun(small(), { flag: 'openrouter', env: envOf('absent', 'usable') });
  const view = x => ({ ...r.config, seats: x.seats, ...(x.preflight !== undefined ? { preflight: x.preflight } : {}) });
  const direct = fingerprintInputs('A task.', resolveChainSeats(small()));
  assert.equal(fingerprintInputs('A task.', view(r.unrouted)), direct, 'the chain without the route hashes as the direct chain does');
  assert.notEqual(fingerprintInputs('A task.', r.config), direct, 'the routed chain itself hashes differently: this is the difference the view removes');
  const again = RR.resolveRun(small(), { flag: 'anthropic', env: envOf('usable', 'usable') });
  assert.equal(fingerprintInputs('A task.', view(again.unrouted)), direct, 'the same on the other route');
});
test('RR-9: every shipped chain routes with no direct Claude seat left; every routed model has a price row and a window; the lint of the routed chain reports what the direct one does', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const dir = join(root, 'chains');
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 7, `the shipped chains were read (${files.length})`);
  let withClaude = 0;
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const r = RR.resolveRun(structuredClone(cfg), { flag: 'openrouter', env: envOf('absent', 'usable') });
    assert.equal(r.stop, undefined, `${f}: routes`);
    assert.deepEqual(directSeats(r.config), [], `${f}: no direct Claude seat is left`);
    if (r.routed.length) withClaude++;
    for (const s of everySeatOf(r.config).filter(x => x.originalProvider === 'anthropic')) {
      assert.ok(PRICES[`openrouter/${s.model}`], `${f}: ${s.model} has a price row`);
      assert.ok(contextWindowOf(s) > 0, `${f}: ${s.model} has a window (its own row, or the direct model's)`);
    }
    const kinds = list => list.map(x => `${x.id ?? x.rule ?? x.code ?? x.kind}`).sort();
    assert.deepEqual(kinds(lintChain(r.config, join(dir, f))), kinds(lintChain(structuredClone(cfg), join(dir, f))), `${f}: the routed chain lints as the direct one does`);
    const direct = RR.resolveRun(structuredClone(cfg), { flag: 'anthropic', env: envOf('usable', 'usable') });
    assert.deepEqual(direct.config, resolveChainSeats(cfg), `${f}: the direct route changes nothing`);
  }
  assert.ok(withClaude >= 4, `the shipped chains with Claude seats were routed (${withClaude})`);
});
test('RR-10: plan-claude-council routed end to end: the same eight seat keys, the same dry run row labels, every row priced, the twins\' "-2" rows cost what their siblings cost, and a routed copy that lost its key throws', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const chain = JSON.parse(readFileSync(join(root, 'chains', 'plan-claude-council.json'), 'utf8'));
  // CHANGED ACCEPTED (0.8.4 cache part (b)2 step (a), 10 Nov 2026; found by the box set). OLD the shipped chain had no prompt_cache switch. NEW it carries it, and while the order's words are not recorded a direct Claude seat has the older exchange-mark rows (-x2 / -x3) that a routed seat does not (its mark exists only under the recorded order: test/routed-claude-mark.test.js RM-5). WHY: this test is about the ROUTE changing no row of the dry run, which is independent of caching, so the chain is taken without the switch; the marks of both routes are pinned in test/cache-marks.test.js and test/routed-claude-mark.test.js.
  delete chain.prompt_cache;
  const direct = resolveChainSeats(structuredClone(chain)); registerSeatKeys(direct);
  const r = RR.resolveRun(structuredClone(chain), { flag: 'openrouter', env: envOf('absent', 'usable') });
  registerSeatKeys(r.config);
  const keys = c => c.seats.critics.map(seatKeyOf);
  assert.equal(new Set(keys(r.config)).size, 8, 'eight distinct keys');
  assert.deepEqual(keys(r.config), keys(direct), 'the routed roster has the direct roster\'s keys, in order');
  assert.ok(r.config.seats.critics.every(s => s.provider === 'openrouter'), 'every judge goes through OpenRouter');
  for (const maximum of [false, true]) {
    const rows = estimateChainRows(r.config, { maximum }); const was = estimateChainRows(direct, { maximum });
    assert.deepEqual(rows.map(x => x.label), was.map(x => x.label), `${maximum ? 'upper' : 'expected'}: every row of the dry run keeps its label`);
    assert.equal(new Set(rows.map(x => x.label)).size, rows.length, 'and the labels are unique');
    assert.ok(rows.filter(x => !/^(mock|external)\//.test(x.seat)).every(x => x.priced), `${maximum ? 'upper' : 'expected'}: every routed row is priced`);
  }
  // CHANGED ACCEPTED TEST (0.8.4 apply, the twin-row bar of C&C, 12 Nov; the same change as PCC-6 in test/plan-claude-council.test.js). OLD: a twin's "-2" rows equal [input, output, usd, times] of the sibling's (red from dc60423a: the twin's persona name adds one token per call, job 105). NEW: for every twin row family of the routed chain, in both modes (the persona names are read from r.config): times, output and the price row are exactly equal, every priced system-text variant equals the sibling's once the persona names are removed, and the per-call input gap is derived from the two names
  // (test/helpers/twin-rows.js); the routed chain is checked, so a price row or a window that routing changed would show. WHY: the persona name is the one legitimate difference; the red source (a twin with another maxTokens fails on the output line) is asserted in PCC-6.
  const { violations, rowsChecked } = twinViolations(r.config);
  assert.ok(rowsChecked > 0, 'twin rows were checked on the routed chain');
  assert.deepEqual(violations, [], 'the routed chain\'s twin rows are priced like their siblings except for the persona name');
  const twin = r.config.seats.critics[1];
  assert.equal(seatKeyOf(twin), 'haiku5.5-l1-2');
  assert.throws(() => assertSeatKeyed({ ...twin }), undefined, 'a routed copy of a repeated seat that lost its key is refused, loudly');
});


// ============ THE SESSION ROUTE (0.8.4 session switch; Helper A, Agent B): every Claude seat answered by the person's own Claude Code session ============
// SHAPE: the same as RR-1..RR-5: a check takes the function under test; the real resolveRun passes it and hand-made WRONG functions (the real one with ONE rule taken away) must fail it at an assertion. Each check asserts `stop`, `route`, `why` BEFORE it reads `config` or `routed`, so a wrong function that stops fails
// with an AssertionError and never a TypeError. The ids are RR-S1..RR-S9 (RR-6..RR-10 above are fixed names). RR-S8 and RR-S9 take no function argument: NO RED OF THEIR OWN (they fail at their first assertion on a tree without the new exports).
const SESSION_KEY_STATES = [['usable', 'usable'], ['malformed', 'usable'], ['absent', 'usable'], ['usable', 'absent'], ['malformed', 'malformed'], ['absent', 'absent'], ['absent', 'malformed'], ['usable', 'malformed'], ['malformed', 'absent']];
const orClaude = (model, extra = {}) => ({ provider: 'openrouter', model, ...extra });      // a Claude model the person seated through OpenRouter: still a Claude seat (found by its model)
const qwen = () => ({ provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', lab: 'qwen' });
const mixed = () => ({ name: 'mixed', seats: { criteria: mock('mock-criteria'), builder: mock('mock-builder'), critics: [claude('claude-sonnet-5-5', { lab: 'sonnet5.5', layer: 1 }), qwen(), orClaude('anthropic/claude-haiku-5.5', { lab: 'haiku5.5-or' })] } });
const DATED = 'claude-haiku-4-5-20251001';
const withDated = () => { const c = small(); c.seats.critics.push(claude(DATED, { lab: 'old' })); return c; };
const SMALL_CONVERTED = [['external', 'subscription:sonnet-5.5', 'sonnet5.5', 1], ['external', 'subscription:haiku-5.5', 'haiku5.5', 1]];
const seatRows = seats => seats.map(s => [s.provider, s.model, s.lab, s.layer]);

const checkSessionChosen = resolve => {
  for (const typed of [{ flag: 'session' }, { flag: ' Session ' }, { flag: 'SESSION' }, { setting: 'session' }]) {
    for (const [a, b] of SESSION_KEY_STATES) for (const dry of [false, true]) {
      const where = `${JSON.stringify(typed)}, anthropic key ${a}, openrouter key ${b}, ${dry ? 'dry run' : 'start'}`;
      const r = resolve(small(), { ...(typed.flag !== undefined ? { flag: typed.flag } : {}), env: envOf(a, b, typed.setting !== undefined ? { COUNCIL_CLAUDE_ROUTE: typed.setting } : {}), dry });
      assert.equal(r.stop, undefined, `${where}: the session route needs no key, so no key state stops it (a dry run too)`);
      assert.equal(r.route, 'session', where); assert.equal(r.why, 'chosen', where);
      assert.equal(r.stopNote, undefined, `${where}: it says nothing about a key`);
      assert.deepEqual((r.routed ?? []).map(x => [x.slot, x.model, x.now, x.layer, x.lab]), [['critics', 'claude-sonnet-5-5', 'subscription:sonnet-5.5', 1, 'sonnet5.5'], ['critics', 'claude-haiku-5-5', 'subscription:haiku-5.5', 1, 'haiku5.5']], `${where}: the converted seats, in order`);
      assert.deepEqual(r.stillBilling, [], `${where}: nothing still bills`);
      assert.deepEqual(seatRows(r.config?.seats?.critics ?? []), SMALL_CONVERTED, `${where}: every Claude seat is an external seat for its session, lab and layer kept`);
      assert.deepEqual(directSeats(r.config), [], `${where}: no direct Claude seat is left`);
      assert.equal(r.config.seats.builder.provider, 'mock', 'a mock seat is left as it is');
      assert.deepEqual(r.unrouted, resolveChainSeats(small()), `${where}: the chain without the route is the direct chain (the cache fingerprint is made from it)`);
    }
  }
};
const checkSessionEverySlot = resolve => {
  for (const explicitReviewer of [false, true]) {
    const c = everySlot({ explicitReviewer });
    const before = everySeatSlotsOf(c); const claudeBefore = before.filter(x => x.seat.provider === 'anthropic');
    const r = resolve(c, { flag: 'session', env: envOf('absent', 'absent') });
    const where = `${explicitReviewer ? 'explicit' : 'default'} reviewer`;
    assert.equal(r.stop, undefined, where); assert.equal(r.route, 'session', where);
    assert.equal((r.routed ?? []).length, claudeBefore.length, `${where}: every Claude seat of every slot is listed as converted`);
    assert.equal((r.routed ?? []).some(x => x.slot === 'security_reviewer (default)'), !explicitReviewer, `${where}: the default security reviewer is converted exactly when no reviewer is named`);
    assert.deepEqual(directSeats(r.config), [], `${where}: no direct Claude seat is left in ANY slot`);
    const after = everySeatSlotsOf(r.config);
    assert.equal(after.length, before.length, `${where}: the same number of slots is listed after the route (the default reviewer is written into seats.security_reviewer)`);
    for (const x of claudeBefore) {
      const role = x.role === 'security_reviewer (default)' ? 'security_reviewer' : x.role;
      const seat = after.find(y => y.role === role)?.seat;
      assert.equal(seat?.provider, 'external', `${where}: ${role} is an external seat now`); assert.match(seat?.model ?? '', /^subscription:(opus|sonnet|haiku|fable)-\d/, `${where}: ${role} names its session`);
    }
    assert.equal(r.config.preflight?.seats?.[0]?.provider, 'external', `${where}: preflight.seats is converted`);
    assert.equal(r.config.preflight.seats[1].provider, 'mock'); assert.equal(r.config.preflight.seats[1].model, 'mock-critic-a', 'a seat that is not Claude is left as it is');
  }
};
const checkSessionMixed = resolve => {
  for (const [a, b] of [['usable', 'usable'], ['absent', 'absent'], ['malformed', 'malformed']]) for (const dry of [false, true]) {
    const r = resolve(mixed(), { flag: 'session', env: envOf(a, b), dry }); const where = `anthropic ${a}, openrouter ${b}, ${dry ? 'dry run' : 'start'}`;
    assert.equal(r.stop, undefined, where); assert.equal(r.route, 'session', where);
    assert.deepEqual((r.routed ?? []).map(x => [x.model, x.now, x.lab]), [['claude-sonnet-5-5', 'subscription:sonnet-5.5', 'sonnet5.5'], ['anthropic/claude-haiku-5.5', 'subscription:haiku-5.5', 'haiku5.5-or']], `${where}: a Claude model seated through OpenRouter converts too`);
    assert.deepEqual(r.stillBilling, [{ role: 'critics[1]', provider: 'openrouter' }], `${where}: the other paid seat is named with its role and provider, and nothing else is`);
    assert.deepEqual(seatRows(r.config?.seats?.critics ?? []).map(x => x.slice(0, 2)), [['external', 'subscription:sonnet-5.5'], ['openrouter', 'qwen/qwen3.8-max-0902'], ['external', 'subscription:haiku-5.5']], `${where}: the seat that is not Claude still bills as it did`);
  }
};
const checkSessionNoSeat = resolve => {
  for (const [name, cfgOf] of [['a chain with no Claude seat', noClaude], ['a mock chain', mockOnly]]) for (const [a, b] of [['malformed', 'malformed'], ['absent', 'absent'], ['usable', 'usable']]) for (const dry of [false, true]) {
    const where = `${name}, anthropic ${a}, openrouter ${b}, ${dry ? 'dry run' : 'start'}`;
    const r = resolve(cfgOf(), { flag: 'session', env: envOf(a, b), dry });
    assert.equal(r.stop, undefined, where); assert.equal(r.route, 'anthropic', where); assert.equal(r.why, 'no_claude_seat', where);
    assert.deepEqual(r.routed, [], where); assert.deepEqual(r.config, resolveChainSeats(cfgOf()), `${where}: the chain comes back as it always did`);
  }
  // the default security reviewer IS a Claude seat: a mock chain with the review on has one, and the session route converts it (else it would stay a paid direct seat)
  const r = resolve(mockOnly({ security_review: { enabled: true } }), { flag: 'session', env: envOf('absent', 'absent') });
  assert.equal(r.stop, undefined); assert.equal(r.route, 'session', 'a mock chain with the security review on has a Claude seat');
  assert.deepEqual((r.routed ?? []).map(x => x.slot), ['security_reviewer (default)']);
  assert.match(r.routed[0].now, /^subscription:fable-\d/, `the default reviewer (${DEFAULT_SECURITY_REVIEWER_SEAT.model}) names its session`);
  assert.equal(r.config.seats.security_reviewer.provider, 'external', 'it is written into seats.security_reviewer, where the stage looks first');
  assert.deepEqual(r.stillBilling, [], 'and nothing bills');
};
const checkSessionUnmapped = resolve => {
  const one = 'The session route cannot name a Claude Code session for the Claude seat critics ("claude-haiku-4-5-20251001"): only models called claude-opus, claude-sonnet, claude-haiku or claude-fable with a version are known. Choose another route. Nothing was started and nothing was spent.';
  const two = 'The session route cannot name a Claude Code session for the Claude seats builder ("claude-haiku-4-5-20251001"), critics ("claude-haiku-4-5-20251001"): only models called claude-opus, claude-sonnet, claude-haiku or claude-fable with a version are known. Choose another route. Nothing was started and nothing was spent.';
  const twoSeats = () => { const c = withDated(); c.seats = { criteria: c.seats.criteria, builder: claude(DATED, { lab: 'old-b' }), critics: c.seats.critics }; return c; };
  for (const [a, b] of [['usable', 'usable'], ['malformed', 'malformed'], ['absent', 'absent']]) for (const dry of [false, true]) for (const via of ['the flag', 'the setting']) {
    const where = `anthropic ${a}, openrouter ${b}, ${dry ? 'dry run' : 'start'}, ${via}`; const o = via === 'the flag' ? { flag: 'session' } : { env: envOf(a, b, { COUNCIL_CLAUDE_ROUTE: 'session' }) };
    const r = resolve(withDated(), { ...o, env: o.env ?? envOf(a, b), dry });
    assert.equal(r.stop, true, `${where}: refused, a dry run too (nothing may be priced as a session run that cannot be one)`); assert.equal(r.code, 'session_model_unmapped', where);
    assert.equal(r.message, one, `${where}: the whole sentence names the slot and the model`); assert.equal(r.config, undefined, 'no roster comes back');
    assert.equal(resolve(twoSeats(), { ...o, env: o.env ?? envOf(a, b), dry }).message, two, `${where}: several seats are named in the plural`);
  }
};
const checkAutoNeverSession = resolve => {
  for (const typed of [undefined, 'auto', ' AUTO ']) for (const [a, b] of SESSION_KEY_STATES) for (const dry of [false, true]) {
    const r = resolve(small(), { ...(typed !== undefined ? { flag: typed } : {}), env: envOf(a, b), dry });
    assert.ok(r.stop === true || r.route !== 'session', `auto never picks session (${JSON.stringify(typed)}, anthropic ${a}, openrouter ${b}, ${dry ? 'dry' : 'start'}): ${r.route}`);
  }
  assert.equal(resolve(small(), { env: envOf('absent', 'absent') }).route, 'anthropic', 'with no key at all auto says anthropic, so the key check speaks');
  assert.equal(resolve(small(), { env: envOf('absent', 'usable') }).route, 'openrouter', 'with only an OpenRouter key auto goes through OpenRouter, as before');
  assert.equal(resolve(small(), { env: envOf('usable', 'usable') }).route, 'anthropic', 'with an Anthropic key auto is direct, as before');
};
const checkSessionRecorded = resolve => {
  for (const [a, b] of SESSION_KEY_STATES) for (const dry of [false, true]) {
    const where = `anthropic ${a}, openrouter ${b}, ${dry ? 'dry run' : 'start'}`;
    // a bare resume (no route typed) of a run that began as a session run stays one, whatever the keys: it needs no key, and a key must never move it to the API (money rule)
    const bare = resolve(small(), { env: envOf(a, b), recorded: { route: 'session' }, dry });
    assert.equal(bare.stop, undefined, `${where}: a recorded session run is never stopped by a key it does not need, and never by route_changed`);
    assert.equal(bare.route, 'session', `${where}: a bare resume of a session run is a session run`); assert.equal(bare.why, 'recorded', where);
    assert.deepEqual(directSeats(bare.config), [], `${where}: no seat goes to the API`);
    const typedAuto = resolve(small(), { flag: 'auto', env: envOf(a, b), recorded: { route: 'session' }, dry });
    assert.equal(typedAuto.route, 'session', `${where}: a typed auto is no route`);
  }
  // THE ENVIRONMENT PATH OF THE MONEY RULE (the MCP server's environment carries the variable and submit_stage resumes with no argument): a shell variable naming another route does NOT move a recorded session run; only a flag or argument typed for this invocation does
  for (const value of ['anthropic', 'openrouter', 'auto']) for (const dry of [false, true]) {
    const viaEnv = resolve(small(), { env: envOf('usable', 'usable', { COUNCIL_CLAUDE_ROUTE: value }), recorded: { route: 'session' }, dry });
    assert.equal(viaEnv.stop, undefined, `COUNCIL_CLAUDE_ROUTE=${value} on a recorded session run stops nothing`);
    assert.equal(viaEnv.route, 'session', `COUNCIL_CLAUDE_ROUTE=${value} does not move a recorded session run to the API`); assert.equal(viaEnv.why, 'recorded');
    assert.deepEqual(directSeats(viaEnv.config), [], `COUNCIL_CLAUDE_ROUTE=${value}: no seat goes to the API`);
  }
  // a route the person TYPES on a resume is the person's change: obeyed, with no route_changed stop
  for (const dry of [false, true]) {
    const toApi = resolve(small(), { flag: 'anthropic', env: envOf('usable', 'usable'), recorded: { route: 'session' }, dry });
    assert.equal(toApi.stop, undefined, 'a typed anthropic on a session run is the person\'s change'); assert.equal(toApi.route, 'anthropic'); assert.equal(toApi.why, 'chosen'); assert.equal(directSeats(toApi.config).length, 2, 'the seats go to the API again');
    const toOr = resolve(small(), { flag: 'openrouter', env: envOf('absent', 'usable'), recorded: { route: 'session' }, dry });
    assert.equal(toOr.stop, undefined); assert.equal(toOr.route, 'openrouter'); assert.deepEqual(directSeats(toOr.config), []);
    for (const was of ['anthropic', 'openrouter', 'session']) {
      const toSession = resolve(small(), { flag: 'session', env: envOf('malformed', 'absent'), recorded: { route: was }, dry });
      assert.equal(toSession.stop, undefined, `a run that began ${was} can be moved to session by the person`); assert.equal(toSession.route, 'session'); assert.equal(toSession.why, 'chosen');
    }
  }
  const viaSetting = resolve(small(), { env: envOf('usable', 'usable', { COUNCIL_CLAUDE_ROUTE: 'session' }), recorded: { route: 'anthropic' } });
  assert.equal(viaSetting.route, 'session', 'the operator setting moves a direct run to session too'); assert.equal(viaSetting.why, 'chosen');
  // the other records are as they were: a recorded openrouter run under keys that would choose anthropic still stops and names both ways out
  const changed = resolve(small(), { env: envOf('usable', 'absent'), recorded: { route: 'openrouter' } });
  assert.equal(changed.stop, true); assert.equal(changed.code, 'route_changed');
  // a recorded session run whose chain no longer has a Claude seat just runs as it is
  const none = resolve(noClaude(), { env: envOf('usable', 'usable'), recorded: { route: 'session' } });
  assert.equal(none.stop, undefined); assert.equal(none.route, 'anthropic'); assert.equal(none.why, 'no_claude_seat');
};

const SWRONG = {
  chosen: {
    'refuses it like a value that is not a route': () => ({ stop: true, code: 'unknown_value', message: 'x. Nothing was started and nothing was spent.' }),
    'looks at the Anthropic key before it asks what was typed': (c, o) => (claudeRouteFacts(o.env ?? {}).anthropicKey === 'malformed' ? { stop: true, code: 'anthropic_key_malformed', message: 'x' } : real(c, o)),
    'wants a usable Anthropic key for it': (c, o) => (claudeRouteFacts(o.env ?? {}).anthropicKey !== 'usable' ? { stop: true, code: 'key_missing', message: 'x' } : real(c, o)),
    'converts only the first seat of a list': (c, o) => { const r = real(c, o); return { ...r, config: { ...r.config, seats: { ...r.config.seats, critics: [r.config.seats.critics[0], c.seats.critics[1]] } } }; },
    'prices a dry run on the direct route': (c, o) => (o.dry ? real(c, { ...o, flag: undefined, env: { ...o.env, COUNCIL_CLAUDE_ROUTE: undefined } }) : real(c, o)),
  },
  everySlot: {
    'drops preflight.seats': (c, o) => real({ ...c, preflight: undefined }, o),
    'forgets the default reviewer': (c, o) => real({ ...c, security_review: { enabled: false } }, o),
    'converts only the first seat of a list': (c, o) => { const r = real(c, o); return { ...r, config: { ...r.config, seats: { ...r.config.seats, critics: [c.seats.critics[0], r.config.seats.critics[1]] } } }; },
  },
  mixed: { 'forgets to name what still bills': (c, o) => ({ ...real(c, o), stillBilling: [] }) },
  noSeat: {
    'always answers session': (c, o) => ({ ...real(c, o), route: 'session', why: 'chosen' }),
    'forgets the default reviewer': (c, o) => real({ ...c, security_review: undefined }, o),
  },
  unmapped: { 'leaves out the seat it cannot name': (c, o) => real({ ...c, seats: { ...c.seats, critics: c.seats.critics.filter(s => s.model !== DATED) } }, o) },
  autoNever: { 'picks session when no Anthropic key is usable': (c, o) => (o.flag === undefined && claudeRouteFacts(o.env ?? {}).anthropicKey !== 'usable' ? real(c, { ...o, flag: 'session' }) : real(c, o)) },
  recorded: {
    'reads a recorded session run as a direct run': (c, o) => real(c, { ...o, recorded: o.recorded?.route === 'session' ? undefined : o.recorded }),
    'stops a route typed on a recorded session run': (c, o) => (o.recorded?.route === 'session' && o.flag !== undefined && o.flag !== 'session' && o.flag !== 'auto' ? { stop: true, code: 'route_changed', message: 'x' } : real(c, o)),
  },
};
const SCHECKS = { chosen: checkSessionChosen, everySlot: checkSessionEverySlot, mixed: checkSessionMixed, noSeat: checkSessionNoSeat, unmapped: checkSessionUnmapped, autoNever: checkAutoNeverSession, recorded: checkSessionRecorded };
const STITLES = {
  chosen: 'a typed `session` (flag, setting, any case) is decided before any key is looked at: no key state stops it, a dry run is priced on it, why is chosen, every Claude seat is an external seat with its lab and layer, nothing still bills',
  everySlot: 'every slot everySeatSlotsOf lists, the default security reviewer and preflight.seats included, is converted; no direct Claude seat is left; a seat that is not Claude is left as it is',
  mixed: 'a chain with another paid seat converts its Claude seats (a Claude model seated through OpenRouter too) and NAMES the seat that still bills, with its role and provider',
  noSeat: 'a chain with no Claude seat is not a session run (no_claude_seat, whatever the keys); a mock chain with the security review on has one, the default reviewer',
  unmapped: 'a Claude model the route cannot name a session for stops the start AND the dry run, with the whole sentence naming each slot and model, before anything is spent',
  autoNever: '`auto` never picks session, whatever the keys; the other two routes are chosen by the keys as before',
  recorded: 'a bare resume of a session run stays a session run whatever the keys; a route the person types is obeyed with no route_changed stop; the other records are as they were',
};
Object.keys(SCHECKS).forEach((name, i) => {
  test(`RR-S${i + 1}: ${STITLES[name]} (the check, then ${Object.keys(SWRONG[name]).length} wrong function(s) that must fail it)`, () => {
    assert.equal(typeof RR.resolveRun, 'function', 'src/resolve-run.js exports resolveRun');
    SCHECKS[name](RR.resolveRun);
    for (const [why, wrong] of Object.entries(SWRONG[name])) assert.throws(() => SCHECKS[name](wrong), { name: 'AssertionError' }, `the wrong function that ${why} must fail ${name} at an assertion`);
  });
});
test('RR-S7b: the registry counts both ways: every session check has its test and at least one wrong function, and every wrong function belongs to a check', () => {
  assert.deepEqual(Object.keys(SWRONG), Object.keys(SCHECKS));
  for (const name of Object.keys(SCHECKS)) assert.ok(Object.keys(SWRONG[name]).length >= 1, `${name} has a wrong function`);
  assert.equal(Object.keys(SCHECKS).reduce((n, k) => n + Object.keys(SWRONG[k]).length, 0), 15, 'fifteen wrong functions in all');
});

test('RR-S8: the cache fingerprint of a session run is made from the chain WITHOUT the route, so a change of mode (session, OpenRouter, direct) keeps every finished stage; the session chain itself hashes differently', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const base = resolveChainSeats(small());
  const view = x => ({ ...base, seats: x.seats, ...(x.preflight !== undefined ? { preflight: x.preflight } : {}) });
  const direct = fingerprintInputs('A task.', base);
  const s = RR.resolveRun(small(), { flag: 'session', env: envOf('absent', 'absent') });
  assert.equal(s.route, 'session');
  assert.equal(fingerprintInputs('A task.', view(s.unrouted)), direct, 'the chain without the route hashes as the direct chain does');
  assert.notEqual(fingerprintInputs('A task.', s.config), direct, 'the converted chain itself hashes differently: this is the difference the view removes');
  const o = RR.resolveRun(small(), { flag: 'openrouter', env: envOf('absent', 'usable') });
  assert.equal(fingerprintInputs('A task.', view(o.unrouted)), fingerprintInputs('A task.', view(s.unrouted)), 'a session run and an OpenRouter run of one chain keep the same stages');
});
test('RR-S9: stillBillingOf names every seat of a resolved chain that bills (role + provider): none for a session chain, the paid seat of a mixed one, the default security reviewer of a mock chain with the review on', () => {
  assert.equal(typeof RR.stillBillingOf, 'function', 'src/resolve-run.js exports stillBillingOf');
  assert.deepEqual(RR.stillBillingOf(resolveChainSeats(mockOnly())), []);
  assert.deepEqual(RR.stillBillingOf(resolveChainSeats(small())), [{ role: 'critics[0]', provider: 'anthropic' }, { role: 'critics[1]', provider: 'anthropic' }], 'a direct chain bills for its Claude seats');
  assert.deepEqual(RR.stillBillingOf(RR.resolveRun(small(), { flag: 'session', env: {} }).config), [], 'a fully converted chain bills for nothing');
  assert.deepEqual(RR.stillBillingOf(RR.resolveRun(mixed(), { flag: 'session', env: {} }).config), [{ role: 'critics[1]', provider: 'openrouter' }]);
  assert.deepEqual(RR.stillBillingOf(resolveChainSeats(mockOnly({ security_review: { enabled: true } }))), [{ role: 'security_reviewer (default)', provider: 'anthropic' }], 'the default reviewer bills when it is not converted');
  assert.equal(typeof CR.sessionModelOf, 'function', 'the model table is exported');
  assert.equal(CR.sessionModelOf('claude-opus-5-5'), 'subscription:opus-5.5');
});
