// 0.8.4 the OpenRouter switch, first group (Builder B): src/claude-route.js, the pure module that decides where the Claude seats go and routes them.
// PINNED: the setting is auto | anthropic | openrouter | session; a MALFORMED Anthropic key never routes silently; a routed seat keeps its lab and its seat key and
// carries the zero-retention host ban (the repo's own slug); a direct run is the same object back; the input is never changed.
// CHANGED ACCEPTED TEST (0.8.4 session switch; the header and the checks below): OLD: `session` was REFUSED as reserved (code session_reserved), reserved for a later unit so nobody who expects no API spend is billed. NEW: `session` is a route: the setting reads it in any case, the decision gives { route: 'session', why: 'chosen' } with every key state and `auto` never picks it, and applySessionRoute (+ sessionModelOf, routeLines for the session) is the module's second routing function; the section "THE SESSION ROUTE" below pins it (SS-1..SS-8, CR-12b). WHY: Muad's answers to the session switch (C&C rulings): the person's own Claude Code session answers every Claude seat, with no API cost for those seats.
// SHAPE (the twin-cost pattern; C&C, 10 Nov 2026: no known-bad module, one named source line only): each property is a CHECK that takes the function under test as an argument. The checks run on the real module (CR-1..CR-7), and each runs on a
// hand-made WRONG function in this file (CR-8) and must fail at its own named assertion, so a check that could not fail is caught. The module is read through a dynamic import: on a tree without it the real tests fail by name and CR-8 still runs.
// NOT here (the wiring group): the flag/env/MCP readers, resolveRun, the key check, the records. LIMIT: no routed seat resolves end to end in this group (providers.js has no 5.5 map rows yet), so the resolve step uses the one mapped model, claude-sonnet-5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { labOf } from '../src/stage-system.js';
import { resolveVendorSeat } from '../src/providers.js';
import { registerSeatKeys, seatKeyOf, keepSeatKey } from '../src/seat-key.js';
import { OPEN_INFERENCE } from '../src/host-block.js';
import { everySeatSlotsOf, everySeatOf, duplicateLabSlots } from '../src/chain.js';
import { companyOfModel, companyOfSeat } from '../src/answered-by.js';
import { cacheUsableSeat } from '../src/prompt-cache.js';
import { DEFAULT_SECURITY_REVIEWER_SEAT } from '../src/security-review.js';
import { missingKeyLines } from '../src/run-preflight.js';
import { extraWithHighDefault, loweringReasons, withoutNativeHigh, hasOwnNativeReasoning } from '../src/reasoning.js';
import { pinnedExtra } from '../src/price-pin.js';

const Route = await import('../src/claude-route.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const cfg = () => ({
  name: 'route-fixture',
  seats: {
    criteria: { provider: 'anthropic', model: 'claude-sonnet-5-5', lab: 'sonnet5.5', maxTokens: 128000 },
    builder: { provider: 'external', model: 'claude-code-session' },
    reviser: { provider: 'mock', model: 'mock-builder' },
    proposers: [{ provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'openai', model: 'gpt-6.1-sol', lab: 'gpt' }],
    critics: [
      { provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1, extra: { provider: { ignore: ['some-host'] } } },
      { provider: 'anthropic', model: 'claude-sonnet-5', layer: 2 },
      { provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', lab: 'qwen', layer: 2 },
    ],
    descending: { answer: { provider: 'anthropic', model: 'claude-opus-5-5' }, plain: { provider: 'mock', model: 'mock-builder' } },      // a MAP stage -> seat (src/chain.js seatSlotsOf: the role is "descending.<stage>")
  },
  preflight: { seats: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }, { provider: 'mock', model: 'mock-critic-a' }] },      // OUTSIDE config.seats (src/chain.js everySeatSlotsOf adds it)
});
const twins = () => ({ seats: { critics: [
  { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'tw', layer: 1 }, { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'tw', layer: 1 }, { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'tw', layer: 2 },
  { provider: 'mock', model: 'mock-critic-a', lab: 'm', layer: 2 },
] } });

// ---- the checks: each takes the function(s) under test ---------------------------------------------------------------------------------------------------------------------------------
const checkSettingReads = read => {
  for (const v of [undefined, null, '', '   ']) assert.deepEqual(read(v), { ok: true, setting: 'auto' }, 'nothing or blank is auto');
  for (const [v, want] of [['auto', 'auto'], [' Anthropic ', 'anthropic'], ['OpenRouter', 'openrouter'], ['session', 'session']]) assert.deepEqual(read(v), { ok: true, setting: want }, `the name ${v} is read`);
  const odd = read('opne\nrouter', '--claude-route');
  assert.equal(odd.code, 'unknown_value', 'an unknown value is refused'); assert.ok(odd.message.includes('"opne router"') && !odd.message.includes('\n'), 'a hostile value is shown on one line');
  // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: /Use auto, anthropic or openrouter\.$/ (three names). NEW: /Use auto, anthropic, openrouter or session\.$/ (SSW-w6, A-DRAFT, asserted whole). WHY: `session` is a route, so the sentence for an unknown value names all four.
  assert.equal(odd.message, '--claude-route: "opne router" is not a Claude route. Use auto, anthropic, openrouter or session.', 'the unknown-value sentence names all four routes');
  assert.equal(read(42).code, 'unknown_value', 'a non-string value is refused');
  assert.ok(read('x'.repeat(500)).message.length < 200, 'a long value is cut');
};
// CHANGED ACCEPTED TEST (0.8.4 session switch; was checkSessionRefused): OLD: `session` came back { ok: false, code: 'session_reserved' } with the sentence "... is reserved for a mode that is not built yet, so it cannot be chosen. Use auto, anthropic or openrouter.", in any case. NEW: `session` is READ as a setting, in any case and with spaces around it, and no sentence of "reserved" is left. WHY: the session route exists; a person's own choice is never refused by this module.
const checkSessionRead = read => {
  for (const v of ['session', 'SESSION', ' Session ']) assert.deepEqual(read(v, '--claude-route'), { ok: true, setting: 'session' }, `session is read as a setting (${JSON.stringify(v)})`);
  assert.equal(read('session').code, undefined, 'session has no refusal code');
};
const checkAutoTable = of => {
  assert.deepEqual(of('auto', 'usable', 'usable'), { route: 'anthropic', why: 'default' }, 'a usable Anthropic key stays direct');
  assert.deepEqual(of('auto', 'usable', 'absent'), { route: 'anthropic', why: 'default' });
  assert.deepEqual(of('auto', 'absent', 'usable'), { route: 'openrouter', why: 'no_anthropic_key' }, 'no Anthropic key and a usable OpenRouter key goes to OpenRouter');
  assert.deepEqual(of('auto', 'absent', 'absent'), { route: 'anthropic', why: 'default' }, 'neither key: the key check speaks, as today');
  // CHANGED ACCEPTED (10 Nov 2026, the OpenRouter switch, C&C's blocker 6 (A)): OLD: assert.deepEqual(of('auto', 'absent', 'malformed'), { route: 'anthropic', why: 'default' }) -- a malformed OpenRouter key with no Anthropic key fell to anthropic/default and the key check named a MISSING Anthropic key. NEW: it stops (openrouter_key_malformed, checked in checkMalformedStops). WHY: the person who set an OpenRouter key must be told about THAT key; a malformed key never silently changes the route.
  assert.equal(of('auto', 'absent', 'malformed').stop, true, 'a malformed OpenRouter key with no Anthropic key stops, it does not fall to the Anthropic route');
  assert.deepEqual(of(undefined, 'usable', 'usable'), { route: 'anthropic', why: 'default' }, 'no setting is auto');
  assert.deepEqual(of('openrouter', 'usable', 'usable'), { route: 'openrouter', why: 'chosen' });
  assert.deepEqual(of('openrouter', 'malformed', 'usable'), { route: 'openrouter', why: 'chosen' }, 'asked for by the person: not a silent route');
  assert.deepEqual(of('anthropic', 'absent', 'usable'), { route: 'anthropic', why: 'chosen' });
};
const checkMalformedStops = of => {
  for (const open of ['usable', 'absent']) {
    const stop = of('auto', 'malformed', open);
    assert.equal(stop.stop, true, 'a malformed Anthropic key stops, it does not route'); assert.equal(stop.code, 'anthropic_key_malformed'); assert.equal(stop.route, undefined, 'no route is chosen');
    assert.match(stop.message, /^ANTHROPIC_API_KEY is set, but it contains a line break or another control character/);
    assert.match(stop.message, /No other route was chosen for you\. To use OpenRouter instead, choose it with --claude-route openrouter; that needs OPENROUTER_API_KEY\.$/);
  }
  const orStop = of('auto', 'absent', 'malformed');
  assert.equal(orStop.stop, true, 'a malformed OpenRouter key with no Anthropic key stops'); assert.equal(orStop.code, 'openrouter_key_malformed'); assert.equal(orStop.route, undefined, 'no route is chosen for a malformed OpenRouter key');
  assert.match(orStop.message, /^OPENROUTER_API_KEY is set, but it contains a line break or another control character/);
  assert.match(orStop.message, /There is no ANTHROPIC_API_KEY to fall back on, so no route was chosen for you\. To use Anthropic instead, set ANTHROPIC_API_KEY\.$/);
  assert.equal(of('auto', 'usable', 'malformed').stop, undefined, 'a malformed OpenRouter key does not stop a run that holds a usable Anthropic key');
  const mcp = of('auto', 'malformed', 'usable', 'the claude_route argument "openrouter"');
  assert.match(mcp.message, /choose it with the claude_route argument "openrouter"; that needs OPENROUTER_API_KEY\.$/, 'the way out is the caller\'s own');
};
// CHANGED ACCEPTED TEST (0.8.4 session switch; was checkSessionStops): OLD: `session` stopped with code session_reserved whatever the keys were. NEW: `session` routes ({ route: 'session', why: 'chosen' }) with EVERY key state of both keys (9 cells, in any case of the name): it needs no key at all, a malformed key included; and `auto` never picks it, whatever the keys. WHY: the session route reads no key (the person's own Claude Code session answers the seats); only the person chooses it.
const checkSessionRoutes = of => {
  for (const setting of ['session', 'SESSION', ' Session ']) for (const a of KEY_STATES) for (const o of KEY_STATES) assert.deepEqual(of(setting, a, o), { route: 'session', why: 'chosen' }, `session needs no key: Anthropic key ${a}, OpenRouter key ${o} (as ${JSON.stringify(setting)})`);
  for (const a of KEY_STATES) for (const o of KEY_STATES) assert.notEqual(of('auto', a, o).route, 'session', `auto never picks session: Anthropic key ${a}, OpenRouter key ${o}`);
  assert.equal(of('nonsense', 'absent', 'usable').code, 'unknown_value');
};
const checkApplyRoutes = apply => {
  const c = cfg();
  assert.equal(apply(c, 'anthropic').config, c, 'anthropic returns the same config'); assert.deepEqual(apply(c, 'anthropic').routed, []);
  const before = JSON.stringify(c);
  const r = apply(c, 'openrouter');
  assert.equal(JSON.stringify(c), before, 'the input is unchanged'); assert.notEqual(r.config, c); assert.equal('transport' in r.config, false, 'no chain-level transport');
  assert.deepEqual(r.routed.map(x => [x.slot, x.model, x.layer, x.lab]), [['criteria', 'claude-sonnet-5-5', null, 'sonnet5.5'], ['proposers', 'claude-opus-5-5', null, 'anthropic'], ['critics', 'claude-haiku-5-5', 1, 'haiku5.5'], ['critics', 'claude-sonnet-5', 2, 'anthropic'], ['descending.answer', 'claude-opus-5-5', null, 'anthropic'], ['preflight.seats', 'claude-haiku-5-5', null, 'anthropic']], 'every Anthropic seat in every slot is routed, the descending map and preflight.seats included');
  const s = r.config.seats;
  for (const seat of [s.criteria, s.proposers[0], s.critics[0], s.critics[1], s.descending.answer, r.config.preflight.seats[0]]) { assert.equal(seat.transport, 'openrouter', 'a routed seat carries transport'); assert.equal(seat.provider, 'anthropic', 'the provider is rewritten later by resolveChainSeats, not here'); }
  for (const [a, b] of [[s.builder, c.seats.builder], [s.reviser, c.seats.reviser], [s.proposers[1], c.seats.proposers[1]], [s.critics[2], c.seats.critics[2]], [s.descending.plain, c.seats.descending.plain], [r.config.preflight.seats[1], c.preflight.seats[1]]]) assert.equal(a, b, 'mock, external and other labs\' seats are the very same object');
  assert.equal(s.criteria.maxTokens, 128000); assert.equal(s.critics[0].layer, 1);
  // 0.8.4 session switch (no change of this row, a note): applyClaudeRoute is the OpenRouter route's function and still refuses `session` with a RangeError; the session route has its own function, applySessionRoute (SS-1..SS-8, CR-12b).
  assert.throws(() => apply(c, 'session'), RangeError, 'session cannot be applied'); assert.throws(() => apply(c), RangeError);
};
const checkApplyBan = apply => {
  const c = cfg(); const s = apply(c, 'openrouter').config.seats;
  for (const seat of [s.criteria, s.proposers[0], s.critics[0], s.critics[1], s.descending.answer, apply(c, 'openrouter').config.preflight.seats[0]]) assert.ok(seat?.extra?.provider?.ignore?.includes(OPEN_INFERENCE), 'a routed seat carries the repo\'s host-ban slug');
  assert.deepEqual(s.critics[0].extra.provider.ignore, ['some-host', OPEN_INFERENCE], 'merged into the seat\'s own list'); assert.deepEqual(s.criteria.extra.provider.ignore, [OPEN_INFERENCE]);
  assert.deepEqual(c.seats.critics[0].extra.provider.ignore, ['some-host'], 'the original list is not touched');
  assert.deepEqual(apply(apply(c, 'openrouter').config, 'openrouter').config.seats.critics[0].extra.provider.ignore, ['some-host', OPEN_INFERENCE], 'applying twice adds the ban once');
};
const checkApplyKeepsLab = apply => {
  const before = cfg(), r = apply(cfg(), 'openrouter').config;
  for (const [a, b] of [[before.seats.criteria, r.seats.criteria], [before.seats.proposers[0], r.seats.proposers[0]], [before.seats.critics[0], r.seats.critics[0]], [before.seats.critics[1], r.seats.critics[1]]]) assert.equal(labOf(b), labOf(a), `labOf of ${a.model} does not move`);
  assert.equal(r.seats.critics[1].lab, 'anthropic', 'a routed seat with no lab is given its provider as its lab');
  const resolved = resolveVendorSeat(r.seats.critics[1], r.seats.critics[1].transport);
  assert.equal(resolved.provider, 'openrouter'); assert.equal(resolved.model, 'anthropic/claude-sonnet-5'); assert.equal(resolved.originalProvider, 'anthropic');
  assert.equal(labOf(resolved), 'anthropic', 'labOf does not move when the seat is resolved to the vendor'); assert.ok(resolved.extra.provider.ignore.includes(OPEN_INFERENCE), 'the ban survives the resolve');
};
const checkApplyKeepsKey = apply => {
  const direct = twins(); registerSeatKeys(direct);
  const directKeys = direct.seats.critics.map(seatKeyOf);
  assert.deepEqual(directKeys, ['tw', 'tw-l1-2', 'tw-l2', 'm'], 'the fixture really is a repeat with distinct keys');
  const copy = apply(direct, 'openrouter').config;
  assert.deepEqual(copy.seats.critics.map(seatKeyOf), directKeys, 'a routed copy keeps the key of the seat it copies');
  registerSeatKeys({ seats: {} });
  // the run's order: route first, resolve to the vendor, then register: the same keys as the direct roster
  const routed = apply(twins(), 'openrouter').config;
  routed.seats.critics = routed.seats.critics.map(s => (s.transport ? resolveVendorSeat(s, s.transport) : s));
  registerSeatKeys(routed);
  assert.deepEqual(routed.seats.critics.map(seatKeyOf), directKeys, 'route -> resolve -> register gives the direct keys');
  registerSeatKeys({ seats: {} });
};

// EVERY SLOT: the authority is src/chain.js everySeatSlotsOf (the one list the CLI's guards read). A config with a direct Claude seat in EVERY slot of that list (the single-seat slots, the list slots, the descending map, preflight.seats) is routed, and
// afterwards every slot that held a Claude seat holds a routed one (transport openrouter) while every other seat is the very same object. The default security reviewer is NOT in config.seats (everySeatSlotsOf adds it when security_review is on): it waits for the wiring group.
const claudeSeat = (n, extra = {}) => ({ provider: 'anthropic', model: 'claude-sonnet-5-5', lab: `lab${n}`, ...extra });
// WHAT CR-12 CATCHES, part by part. (1) The single and list slot names are READ from src/chain.js (SINGLE_SEAT_KEYS and LIST_SEAT_KEYS are not exported; chain.js is a ladder file), not typed here: a slot added to either list later is given a Claude seat and must be routed,
// or the check fails (the module walks every config.seats entry, so a new key of those shapes is routed anyway; this pins it). (2) A NEW KIND of slot (another map like `descending`, another entry outside config.seats) is caught by a SHAPE GUARD: the bodies of
// seatSlotsOf and everySeatSlotsOf in src/chain.js hold exactly five `.push(` calls = the five shapes (the single slots, the list slots, the descending map, preflight.seats, the default security reviewer; CHANGED ACCEPTED in the wiring unit: the default reviewer is now routed too, pinned in test/resolve-run.test.js RR-3); a sixth fails CR-12 by name.
// The guard reads the text of those two functions, so a pure refactor of them can trip it too: then update the count here on purpose. (3) everySeatSlotsOf is the authority for the roles compared before and after.
const slotKeysOf = name => { const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(readFileSync(join(root, 'src', 'chain.js'), 'utf8')); assert.ok(m, `${name} is declared in src/chain.js`); return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]); };
const everySlotConfig = () => {
  let n = 0;
  const seats = {};
  for (const k of slotKeysOf('SINGLE_SEAT_KEYS')) seats[k] = claudeSeat(++n);
  for (const k of slotKeysOf('LIST_SEAT_KEYS')) seats[k] = [claudeSeat(++n), { provider: 'mock', model: 'mock-builder' }];
  seats.descending = { one: claudeSeat(++n), two: { provider: 'mock', model: 'mock-builder' } };
  return { name: 'every-slot', seats, preflight: { seats: [claudeSeat(++n), { provider: 'mock', model: 'mock-critic-a' }] } };
};
const slotShapeCount = () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const body = name => { const i = src.indexOf(`export function ${name}(`); assert.ok(i >= 0, `${name} is declared in src/chain.js`); const j = src.indexOf('\n}\n', i); return src.slice(i, j); };
  return (body('seatSlotsOf').match(/\.push\(/g) ?? []).length + (body('everySeatSlotsOf').match(/\.push\(/g) ?? []).length;
};
const checkApplyAllSlots = apply => {
  assert.equal(slotShapeCount(), 5, 'seatSlotsOf and everySeatSlotsOf build their slots in exactly five shapes (single, list, descending map, preflight.seats, default reviewer): a new kind of slot needs a routing rule here');
  const c = everySlotConfig();
  const before = new Map(everySeatSlotsOf(c).map(({ role, seat }) => [role, seat]));
  assert.ok(slotKeysOf('SINGLE_SEAT_KEYS').length >= 14 && slotKeysOf('LIST_SEAT_KEYS').length >= 4, 'the slot lists were read from src/chain.js');
  assert.equal(before.size, slotKeysOf('SINGLE_SEAT_KEYS').length + 2 * slotKeysOf('LIST_SEAT_KEYS').length + 2 + 2, 'the fixture fills EVERY slot everySeatSlotsOf lists: the single slots, two seats per list slot, the descending map (two) and preflight.seats (two)');
  const after = new Map(everySeatSlotsOf(apply(c, 'openrouter').config).map(({ role, seat }) => [role, seat]));
  assert.deepEqual([...after.keys()], [...before.keys()], 'the same slots are listed after the route');
  for (const [role, seat] of before) {
    if (seat.provider === 'anthropic') assert.equal(after.get(role).transport, 'openrouter', `slot ${role}: a direct Claude seat is routed`);
    else assert.equal(after.get(role), seat, `slot ${role}: a seat that is not Claude is the very same object`);
  }
};

// CR-12b EVERY SLOT, THE SESSION ROUTE (0.8.4 session switch, added): the same walk, the other function. A Claude seat in each of the single-seat slots, the list slots, the descending map and preflight.seats becomes an external seat 'subscription:sonnet-5.5' that keeps its lab; every other seat is the very same object;
// and the DEFAULT security reviewer (a Claude seat no chain file names, listed by everySeatSlotsOf only when security_review is on and no reviewer is named) is written into seats.security_reviewer as an external seat, with the DEFAULT's own lab and maxTokens; with the review off nothing is added.
const checkApplySessionAllSlots = apply => {
  assert.equal(slotShapeCount(), 5, 'seatSlotsOf and everySeatSlotsOf build their slots in exactly five shapes (single, list, descending map, preflight.seats, default reviewer): a new kind of slot needs a rule for the session route here too');
  const c = everySlotConfig();
  const before = new Map(everySeatSlotsOf(c).map(({ role, seat }) => [role, seat]));
  const r = apply(c);
  const after = new Map(everySeatSlotsOf(r.config).map(({ role, seat }) => [role, seat]));
  assert.deepEqual([...after.keys()], [...before.keys()], 'the same slots are listed after the route');
  for (const [role, seat] of before) {
    if (seat.provider === 'anthropic') { const out = after.get(role); assert.equal(out.provider, 'external', `slot ${role}: a direct Claude seat is converted`); assert.equal(out.model, 'subscription:sonnet-5.5', `slot ${role}: it names the session`); assert.equal(out.lab, seat.lab, `slot ${role}: its lab is kept`); }
    else assert.equal(after.get(role), seat, `slot ${role}: a seat that is not Claude is the very same object`);
  }
  // the default reviewer: the review is on, no reviewer is named
  const d = everySlotConfig(); delete d.seats.security_reviewer; d.security_review = { enabled: true };
  assert.ok(everySeatSlotsOf(d).some(x => x.role === 'security_reviewer (default)'), 'the fixture lists the default reviewer');
  const dr = apply(d);
  assert.deepEqual(dr.config.seats.security_reviewer, { provider: 'external', model: 'subscription:fable-5.1', lab: DEFAULT_SECURITY_REVIEWER_SEAT.lab, maxTokens: DEFAULT_SECURITY_REVIEWER_SEAT.maxTokens }, 'the default security reviewer is converted: a direct Claude seat would stay a paid call');
  assert.ok((dr.converted ?? []).some(x => x.slot === 'security_reviewer (default)'), 'the default reviewer is in the converted list');
  assert.equal(DEFAULT_SECURITY_REVIEWER_SEAT.provider, 'anthropic', 'the default seat constant itself is not changed');
  // the review off: no reviewer is added
  const off = everySlotConfig(); delete off.seats.security_reviewer;
  assert.equal('security_reviewer' in apply(off).config.seats, false, 'with the review off no default reviewer is written');
};

// THE FULL MATRIX (a fix-up pinning every cell; C&C's PASS, 10 Nov 2026): every setting x every Anthropic key state x every OpenRouter key state, written out by hand as the RESULT each cell must give. Rows are the Anthropic key
// (usable, malformed, absent), columns the OpenRouter key (usable, absent, malformed). A result is "<route>/<why>" or "stop:<code>". `anthropic` and `openrouter` chosen are never refused here whatever the keys (a missing key of the chosen way
// is the key check's business, as today); `session` routes to session/chosen whatever the keys are, and an unknown value stops whatever the keys are; a malformed Anthropic key stops under auto; nothing or blank is auto.
// CHANGED ACCEPTED TEST (0.8.4 session switch): OLD: the `session` row was ALL('stop:session_reserved'). NEW: ALL('session/chosen'). WHY: session is a route that needs no key (the person's own Claude Code session answers the seats).
// THE CELL THE SIXTH WIRING BLOCKER MOVED: (auto, Anthropic key absent, OpenRouter key malformed) was anthropic/default and is now the stop openrouter_key_malformed (the CHANGED ACCEPTED below, and in checkAutoTable / checkMalformedStops).
// CHANGED ACCEPTED (10 Nov 2026, C&C's blocker 6 (A)): the (auto, Anthropic absent, OpenRouter malformed) cell, the last of the `absent` row. OLD: 'anthropic/default' (the key check then named a missing Anthropic key). NEW: 'stop:openrouter_key_malformed'. WHY: the person is told about the key they actually set.
const AUTO = { usable: ['anthropic/default', 'anthropic/default', 'anthropic/default'], malformed: ['stop:anthropic_key_malformed', 'stop:anthropic_key_malformed', 'stop:anthropic_key_malformed'], absent: ['openrouter/no_anthropic_key', 'anthropic/default', 'stop:openrouter_key_malformed'] };
const ALL = r => ({ usable: [r, r, r], malformed: [r, r, r], absent: [r, r, r] });
const MATRIX = { auto: AUTO, undefined: AUTO, '': AUTO, anthropic: ALL('anthropic/chosen'), openrouter: ALL('openrouter/chosen'), session: ALL('session/chosen'), nonsense: ALL('stop:unknown_value') };
const KEY_STATES = ['usable', 'absent', 'malformed'];      // the column order of a matrix row
const encode = r => (r?.stop ? `stop:${r.code}` : `${r?.route}/${r?.why}`);
const decode = s => (s.startsWith('stop:') ? { stop: true, code: s.slice(5), message: 'x' } : { route: s.split('/')[0], why: s.split('/')[1] });
const fromMatrix = m => (setting, a, o) => decode(m[String(setting)][a][KEY_STATES.indexOf(o)]);
const checkDecisionMatrix = of => {
  let cells = 0;
  for (const [setting, rows] of Object.entries(MATRIX)) for (const a of ['usable', 'malformed', 'absent']) for (const [i, o] of KEY_STATES.entries()) {
    const arg = setting === 'undefined' ? undefined : setting;
    assert.equal(encode(of(arg, a, o)), rows[a][i], `the decision for setting ${JSON.stringify(arg)}, Anthropic key ${a}, OpenRouter key ${o}`); cells++;
  }
  assert.equal(cells, 7 * 9, 'every cell was checked');
};

// THE LIST: every check is registered ONCE here; the real-module tests run them through run(), CR-8 requires a wrong-function case for each name in this very list, and CR-10 compares the two sets and prints both counts.
const CHECKS = { settingReads: checkSettingReads, sessionRead: checkSessionRead, autoTable: checkAutoTable, malformedStops: checkMalformedStops, sessionRoutes: checkSessionRoutes, applyRoutes: checkApplyRoutes, applyBan: checkApplyBan, applyKeepsLab: checkApplyKeepsLab, applyKeepsKey: checkApplyKeepsKey, decisionMatrix: checkDecisionMatrix, applyAllSlots: checkApplyAllSlots, applySessionAllSlots: checkApplySessionAllSlots };
const nameOfCheck = fn => Object.keys(CHECKS).find(k => CHECKS[k] === fn);
const ran = new Set(), shownFailing = new Set(); let wrongFunctions = 0;
const run = (name, ...args) => { const out = CHECKS[name](...args); ran.add(name); return out; };      // counted AFTER it returns: a check that threw (or a module that is missing) is not a pass

// ---- the real module ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const real = {
  read: (v, s) => Route.readClaudeRouteSetting(v, s),
  of: (setting, anthropicKey, openRouterKey, wayOut) => Route.claudeRouteOf({ setting, anthropicKey, openRouterKey, ...(wayOut ? { wayOut } : {}) }),
  apply: (c, r) => Route.applyClaudeRoute(c, r),
  applySession: c => Route.applySessionRoute(c),
};

test('CR-1 the setting: nothing or blank is auto, the four names are read (any case), anything else is refused with the four names, a hostile value is shown short and on one line', () => { run('settingReads', real.read); });
// CHANGED ACCEPTED TEST (0.8.4 session switch): OLD title: 'CR-2 `session` is REFUSED as reserved, with the exact sentence, in any case (...)' (checks sessionRefused + sessionStops). NEW: session is READ as a setting and ROUTES with every key state, and auto never picks it (checks sessionRead + sessionRoutes). WHY: session is a route now.
test('CR-2 `session` is a ROUTE: it is read as a setting in any case, it gives { route: session, why: chosen } with every state of both keys (a malformed key included: it needs no key), and `auto` never picks it', () => { run('sessionRead', real.read); run('sessionRoutes', real.of); });
test('CR-3 the decision: auto goes to OpenRouter only with NO Anthropic key and a usable OpenRouter key; the person\'s own choice is never refused here', () => { run('autoTable', real.of); assert.deepEqual(Route.claudeRouteOf(), { route: 'anthropic', why: 'default' }); });
test('CR-11 the whole decision matrix: 7 settings (auto, none, blank, anthropic, openrouter, session, an unknown value) x 3 Anthropic key states x 3 OpenRouter key states = 63 cells, each with its result written out by hand (a chosen route whose key is missing is still returned: the key check speaks)', () => { run('decisionMatrix', real.of); });
test('CR-4 a MALFORMED Anthropic key never routes silently: it stops with the key problem, says no other route was chosen, and names the caller\'s own way to OpenRouter (and that it needs OPENROUTER_API_KEY)', () => { run('malformedStops', real.of); });
test('CR-5 applyClaudeRoute: anthropic returns the SAME config; openrouter routes every Anthropic seat in every slot, leaves mock, external and other labs\' seats as the very same objects, sets no chain-level transport, never changes its input, and (it is the OpenRouter route\'s function; the session route has applySessionRoute) throws a RangeError for `session`', () => { run('applyRoutes', real.apply); });
test('CR-6 a routed seat carries the repo\'s zero-retention host ban (the slug of src/host-block.js, which every shipped OpenRouter seat carries too), merged into its own list and never twice', () => {
  run('applyBan', real.apply);
  assert.equal(OPEN_INFERENCE, 'open-inference');
  const seen = [];
  const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.provider === 'openrouter' && typeof x.model === 'string') seen.push(x); Object.values(x).forEach(walk); } };
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')).seats ?? {});
  assert.ok(seen.length > 20, `shipped OpenRouter seats were found (${seen.length})`);
  for (const seat of seen) assert.ok(seat.extra?.provider?.ignore?.includes(OPEN_INFERENCE), `${seat.model}: a shipped OpenRouter seat carries the same slug`);
});
test('CR-7 a routed seat keeps its LAB (a seat with none is given its provider; labOf does not move, nor after the resolve to the vendor, with claude-sonnet-5, the one mapped model) and its SEAT KEY (plan section 14: the same keys as the direct roster, whether the keys stand or are registered after the route)', () => { run('applyKeepsLab', real.apply); run('applyKeepsKey', real.apply); });
test('CR-12 EVERY slot of src/chain.js everySeatSlotsOf: a direct Claude seat in each of the single-seat slots, the list slots, the descending map and preflight.seats is routed (the default security reviewer, which is not in config.seats, is routed by the wiring unit: test/resolve-run.test.js RR-3); every other seat is the very same object', () => { run('applyAllSlots', real.apply); });
test('CR-12b EVERY slot, the SESSION route: a Claude seat in each single-seat slot, list slot, the descending map and preflight.seats becomes an external session seat with its lab kept; the DEFAULT security reviewer (review on, none named) is converted too and written into seats.security_reviewer; every other seat is the very same object', () => { run('applySessionAllSlots', real.applySession); });
test('CR-13 NOTHING TO ROUTE: a shipped chain with no direct Claude seat comes back unchanged with an empty routed list (so a malformed Anthropic key has no business stopping it: the wiring asks applyClaudeRoute, or this walk, before it asks the decision); a chain with Claude seats lists exactly the ones everySeatSlotsOf shows', () => {
  let withClaude = 0, without = 0;
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const config = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    // CHANGED ACCEPTED (wiring unit, 10 Nov 2026): OLD the default security reviewer ('security_reviewer (default)', a direct Claude seat that no chain file names) was left out of this list, because applyClaudeRoute did not route it. NEW it is routed (a routed copy is written
    // into seats.security_reviewer when the review is on and no reviewer is named), so the routed list IS the Claude seats everySeatSlotsOf shows, the default reviewer included. WHY: blocker 1 of the wiring GO (every slot routed). The one shipped chain this moves is mock-security-review.
    const claude = everySeatSlotsOf(config).filter(({ seat }) => seat?.provider === 'anthropic');
    const out = real.apply(config, 'openrouter');
    assert.equal(out.routed.length, claude.length, `${f}: the routed list is the Claude seats everySeatSlotsOf shows`);
    if (claude.length === 0) { assert.deepEqual(out.config, config, `${f}: nothing to route, nothing changes`); without++; } else withClaude++;
  }
  assert.ok(withClaude >= 5 && without >= 5, `both kinds of shipped chain were seen (${withClaude} with Claude seats, ${without} without)`);
});
test('CR-14 TODAY, a pin (C&C result (i)): a malformed ANTHROPIC_API_KEY does not stop a chain with nothing to route. The start-path key check (run-preflight.js missingKeyLines) reads only the providers a chain seats: a China chain (external and OpenRouter seats) and a mock chain pass it, a chain with a direct Anthropic seat (plan-mini-council) is refused -- so the wiring must keep that (it asks "is there a Claude seat" before it lets the decision stop a run)', () => {
  const names = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'COUNCIL_PLUGIN_ANTHROPIC_API_KEY', 'COUNCIL_PLUGIN_OPENROUTER_API_KEY'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]));
  try {
    delete process.env.COUNCIL_PLUGIN_ANTHROPIC_API_KEY; delete process.env.COUNCIL_PLUGIN_OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-bad\nsk-ant-two-lines'; process.env.OPENROUTER_API_KEY = 'sk-or-v1-dummy';
    const linesFor = f => { const config = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')); return missingKeyLines(config, everySeatOf(config)); };
    assert.equal(linesFor('plan-china-medium-council.json'), null, 'a China chain is not stopped by an unused malformed key');
    assert.equal(linesFor('plan-china-high-council.json'), null);
    assert.equal(linesFor('mock.json'), null, 'a mock chain is not stopped by it either');
    assert.ok(Array.isArray(linesFor('plan-mini-council.json')) && linesFor('plan-mini-council.json').length > 0, 'a chain that seats Anthropic directly IS refused (the known-bad input: the row can fail)');
  } finally { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } }
});
test('CR-7b the facts from an environment object (a GUARD with no red of its own, named as such): usable, malformed (a control character), absent (unset, blank, an unfilled template); the plugin dialog\'s variable counts; a key value is never returned', () => {
  assert.deepEqual(Route.claudeRouteFacts({ ANTHROPIC_API_KEY: 'sk-ant-secret-1', OPENROUTER_API_KEY: 'sk-or-secret-2' }), { anthropicKey: 'usable', openRouterKey: 'usable' });
  assert.deepEqual(Route.claudeRouteFacts({}), { anthropicKey: 'absent', openRouterKey: 'absent' }); assert.deepEqual(Route.claudeRouteFacts(), { anthropicKey: 'absent', openRouterKey: 'absent' });
  assert.deepEqual(Route.claudeRouteFacts({ ANTHROPIC_API_KEY: '   ', OPENROUTER_API_KEY: '${user_config.openrouter_key}' }), { anthropicKey: 'absent', openRouterKey: 'absent' });
  assert.deepEqual(Route.claudeRouteFacts({ ANTHROPIC_API_KEY: 'sk-ant-secret-3\nsk-ant-secret-4' }), { anthropicKey: 'malformed', openRouterKey: 'absent' });
  assert.deepEqual(Route.claudeRouteFacts({ COUNCIL_PLUGIN_ANTHROPIC_API_KEY: 'sk-ant-dialog' }), { anthropicKey: 'usable', openRouterKey: 'absent' });
  assert.deepEqual(Route.claudeRouteFacts({ ANTHROPIC_API_KEY: 'sk-ant-bad\u0007', COUNCIL_PLUGIN_ANTHROPIC_API_KEY: 'sk-ant-dialog' }), { anthropicKey: 'usable', openRouterKey: 'absent' });
  assert.ok(!JSON.stringify(Route.claudeRouteFacts({ ANTHROPIC_API_KEY: 'sk-ant-secret-1' })).includes('secret'));
});

test('CR-9 what a routed seat carries at the call, for EVERY direct Claude seat of the shipped chains as the chain files write them: the PRICE PIN from its routed price row (provider.max_price, src/price-pin.js), the host ban, and effort HIGH in OpenRouter\'s field (reasoning.effort), never lowered, none of the direct seat\'s output_config / thinking -- Haiku 5.5 and Opus 5.5 (own default medium) included', () => {
  const pricing = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
  const ROUTED = { 'claude-haiku-5-5': 'anthropic/claude-haiku-5.5', 'claude-opus-5-5': 'anthropic/claude-opus-5.5', 'claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5', 'claude-fable-5-2': 'anthropic/claude-fable-5.2' };
  const shipped = [];
  const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.provider === 'anthropic' && typeof x.model === 'string') shipped.push(x); Object.values(x).forEach(walk); } };
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')).seats ?? {});
  assert.ok(shipped.length >= 20, `shipped direct Claude seats were found (${shipped.length})`);
  // the seat as resolveVendorSeat leaves it (src/providers.js, its return line): the provider is the vendor, originalProvider keeps the real one, the native high is dropped (withoutNativeHigh), a seat\'s own other reasoning field is kept and flagged (hasOwnNativeReasoning -> keepOwnReasoning); the host ban is added by hand here (claude-route.js does it)
  const resolvedOf = (seat, id) => { const r = { ...seat, provider: 'openrouter', model: id, lab: seat.lab || seat.provider, originalProvider: seat.provider, ...withoutNativeHigh(seat), ...(hasOwnNativeReasoning(seat) ? { keepOwnReasoning: true } : {}) }; return { ...r, extra: { ...(r.extra ?? {}), provider: { ...(r.extra?.provider ?? {}), ignore: [...(r.extra?.provider?.ignore ?? []), OPEN_INFERENCE] } } }; };
  const carriesFor = (direct, build = seat => pinnedExtra(seat, extraWithHighDefault(seat), { promptTokens: 1000 })) => {
    const id = ROUTED[direct.model], seat = resolvedOf(direct, id), where = `${direct.model} (${direct.lab ?? direct.provider})`;
    assert.equal(hasOwnNativeReasoning(direct), false, `${where}: no reasoning field of its own that would stop the harness writing high`);
    const extra = build(seat), row = pricing[`openrouter/${id}`];
    assert.ok(row, `${where}: the routed price row exists`);
    assert.equal(extra.reasoning?.effort, 'high', `${where}: effort high in OpenRouter's field`);
    assert.equal('output_config' in extra || 'thinking' in extra, false, `${where}: none of the direct seat's reasoning fields`);
    assert.deepEqual(loweringReasons(extra, seat), [], `${where}: nothing lowers the seat`);
    assert.deepEqual([extra.provider?.max_price?.prompt, extra.provider?.max_price?.completion], [row.in, row.out], `${where}: the price pin is the routed row's own figures`);
    assert.ok(extra.provider.ignore.includes(OPEN_INFERENCE), `${where}: the host ban is carried`);
  };
  for (const direct of shipped) carriesFor(direct);
  const opus = shipped.find(s => s.model === 'claude-opus-5-5');
  // the checks can fail: a lowered effort, a missing pin, a direct-style field and a seat with its own reasoning field are each caught
  assert.throws(() => carriesFor(opus, () => ({ reasoning: { effort: 'low' }, provider: { ignore: [OPEN_INFERENCE], max_price: { prompt: 4.4, completion: 22 } } })), err => err instanceof assert.AssertionError && /effort high in OpenRouter's field/.test(err.message));
  assert.throws(() => carriesFor(opus, () => ({ reasoning: { effort: 'high' }, provider: { ignore: [OPEN_INFERENCE] } })), err => err instanceof assert.AssertionError && /the price pin is the routed row/.test(err.message));
  assert.throws(() => carriesFor(opus, () => ({ reasoning: { effort: 'high' }, output_config: { effort: 'high' }, provider: { ignore: [OPEN_INFERENCE], max_price: { prompt: 4.4, completion: 22 } } })), err => err instanceof assert.AssertionError && /none of the direct seat's reasoning fields/.test(err.message));
  assert.throws(() => carriesFor({ ...opus, extra: { thinking: { type: 'enabled', budget_tokens: 5000 } } }), err => err instanceof assert.AssertionError && /no reasoning field of its own/.test(err.message));
});

// ---- THE SESSION ROUTE (0.8.4 session switch): applySessionRoute, sessionModelOf and routeLines for the session. The module is read through the dynamic import above (`Route`), so on a tree without these exports each test below fails on its own. ----
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const isClaudeCfgSeat = s => !!s && s.provider !== 'external' && s.provider !== 'mock' && (s.provider === 'anthropic' || companyOfSeat(s) === 'anthropic');
const sessionFixture = () => ({
  name: 'session-fixture',
  security_review: { enabled: true },
  seats: {
    criteria: { provider: 'anthropic', model: 'claude-sonnet-5-5', lab: 'sonnet5.5', maxTokens: 128000, persona: 'Noah', temperature: 0.2, extra: { output_config: { effort: 'high' } } },
    builder: { provider: 'external', model: 'claude-code-session' },
    reviser: { provider: 'mock', model: 'mock-builder' },
    proposers: [{ provider: 'anthropic', model: 'claude-opus-5-5', transport: 'openrouter', extra: { provider: { ignore: ['open-inference'] } } }, { provider: 'openai', model: 'gpt-6.1-sol', lab: 'gpt' }],
    critics: [
      { provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'haiku5.5', layer: 1, persona: 'Matthew', maxTokens: 64000, extra: { output_config: { effort: 'high' } } },
      { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', layer: 2, extra: { provider: { ignore: ['some-host'] }, reasoning: { effort: 'high' } } },      // a Claude model through OpenRouter, no lab: its lab is its provider
      { provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', lab: 'qwen', layer: 2 },
    ],
    descending: { answer: { provider: 'anthropic', model: 'claude-fable-5-2', lab: 'fable5.2' }, plain: { provider: 'mock', model: 'mock-builder' } },
  },
  preflight: { seats: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }, { provider: 'mock', model: 'mock-critic-a' }] },
});
const rowText = x => `${x.slot} | ${x.model} | ${x.now} | ${x.layer} | ${x.lab}`;

test('SS-1 applySessionRoute converts a Claude seat in EVERY slot shape (a single seat, a list, the descending map, preflight.seats, the default security reviewer with the review on, a Claude model through OpenRouter) and nothing else: mock, external and other labs\' seats are the very same objects, the input is never changed, no chain-level transport, extra/transport/temperature are dropped, lab/layer/persona/maxTokens kept', () => {
  const c = deepFreeze(sessionFixture()); const before = JSON.stringify(c);
  const r = Route.applySessionRoute(c);
  assert.equal(JSON.stringify(c), before, 'the input is unchanged (it was frozen too)'); assert.notEqual(r.config, c);
  assert.equal('transport' in r.config, false, 'no chain-level transport'); assert.deepEqual(r.unmapped, []);
  assert.deepEqual(r.converted.map(rowText).sort(), [
    'security_reviewer (default) | claude-fable-5-1 | subscription:fable-5.1 | null | anthropic-security',
    'criteria | claude-sonnet-5-5 | subscription:sonnet-5.5 | null | sonnet5.5',
    'proposers | claude-opus-5-5 | subscription:opus-5.5 | null | anthropic',
    'critics | claude-haiku-5-5 | subscription:haiku-5.5 | 1 | haiku5.5',
    'critics | anthropic/claude-haiku-5.5 | subscription:haiku-5.5 | 2 | openrouter',
    'descending.answer | claude-fable-5-2 | subscription:fable-5.2 | null | fable5.2',
    'preflight.seats | claude-haiku-5-5 | subscription:haiku-5.5 | null | anthropic',
  ].sort(), 'every Claude seat in every slot is listed with what it is now');
  const s = r.config.seats;
  assert.deepEqual(s.criteria, { provider: 'external', model: 'subscription:sonnet-5.5', lab: 'sonnet5.5', maxTokens: 128000, persona: 'Noah' }, 'extra and temperature are dropped, lab, maxTokens and persona kept');
  assert.deepEqual(s.proposers[0], { provider: 'external', model: 'subscription:opus-5.5', lab: 'anthropic' }, 'a seat with a seat-level transport loses it; a lab is made explicit');
  assert.deepEqual(s.critics[0], { provider: 'external', model: 'subscription:haiku-5.5', lab: 'haiku5.5', layer: 1, persona: 'Matthew', maxTokens: 64000 });
  assert.deepEqual(s.critics[1], { provider: 'external', model: 'subscription:haiku-5.5', lab: 'openrouter', layer: 2 }, 'a Claude model through OpenRouter: converted, and its lab is the provider it had');
  assert.deepEqual(s.descending.answer, { provider: 'external', model: 'subscription:fable-5.2', lab: 'fable5.2' });
  assert.deepEqual(r.config.preflight.seats[0], { provider: 'external', model: 'subscription:haiku-5.5', lab: 'anthropic' });
  assert.deepEqual(s.security_reviewer, { provider: 'external', model: 'subscription:fable-5.1', lab: 'anthropic-security', maxTokens: 8000 }, 'the default security reviewer is written into seats.security_reviewer, converted');
  for (const [a, b] of [[s.builder, c.seats.builder], [s.reviser, c.seats.reviser], [s.proposers[1], c.seats.proposers[1]], [s.critics[2], c.seats.critics[2]], [s.descending.plain, c.seats.descending.plain], [r.config.preflight.seats[1], c.preflight.seats[1]]]) assert.equal(a, b, 'mock, external and other labs\' seats are the very same object');
  assert.equal(r.config.security_review, c.security_review); assert.equal(DEFAULT_SECURITY_REVIEWER_SEAT.provider, 'anthropic', 'the default seat constant is not changed');
  assert.equal(everySeatSlotsOf(r.config).filter(x => isClaudeCfgSeat(x.seat)).length, 0, 'no direct Claude seat is left anywhere');
});
test('SS-1b a NAMED Claude security reviewer is converted in its own slot (no default row); with the review off nothing is added to seats.security_reviewer', () => {
  const named = { name: 'n', security_review: { enabled: true }, seats: { critics: [{ provider: 'anthropic', model: 'claude-opus-5-5', lab: 'o' }], security_reviewer: { provider: 'anthropic', model: 'claude-sonnet-5-5', lab: 'sec' } } };
  const r = Route.applySessionRoute(deepFreeze(named));
  assert.deepEqual(r.converted.map(x => x.slot).sort(), ['critics', 'security_reviewer']); assert.equal(r.config.seats.security_reviewer.model, 'subscription:sonnet-5.5');
  const off = Route.applySessionRoute({ name: 'o', seats: { critics: [{ provider: 'anthropic', model: 'claude-opus-5-5', lab: 'o' }] } });
  assert.equal('security_reviewer' in off.config.seats, false); assert.equal(off.converted.length, 1);
});

test('SS-2 the converted plan-claude-council keeps the API roster\'s labOf, seat keys (twins and repeated models across layers) and every stage label, and its critics still pass duplicateLabSlots with no finding', () => {
  const council = () => JSON.parse(readFileSync(join(root, 'chains', 'plan-claude-council.json'), 'utf8'));
  const keysOf = config => everySeatSlotsOf(config).map(({ role, seat }) => [role, labOf(seat), seatKeyOf(seat)]);
  const labelsOf = config => [...config.seats.proposers.map(s => `propose-${seatKeyOf(s)}`), ...config.seats.critics.flatMap(s => [`panel-1-${seatKeyOf(s)}`, `panel-2-${seatKeyOf(s)}`, `judge-${seatKeyOf(s)}`, `debate-${seatKeyOf(s)}`])];
  try {
    const direct = council(); registerSeatKeys(direct);
    const apiKeys = keysOf(direct), apiLabels = labelsOf(direct);
    assert.deepEqual(direct.seats.critics.map(seatKeyOf), ['haiku5.5', 'haiku5.5-l1-2', 'sonnet5.5', 'sonnet5.5-l2', 'sonnet5.5-l2-2', 'opus5.5', 'fable5.2', 'opus5.5-l3'], 'the API roster\'s keys: twins and repeated models across layers');
    // (1) the run's own order: convert, then register
    const s1 = Route.applySessionRoute(council());
    assert.equal(s1.converted.length, 11, 'three proposers and eight judges convert'); assert.deepEqual(s1.unmapped, []);
    registerSeatKeys(s1.config);
    assert.deepEqual(keysOf(s1.config), apiKeys, 'labOf and seatKeyOf of every slot equal the API roster\'s');
    assert.deepEqual(labelsOf(s1.config), apiLabels, 'every stage label equals the API roster\'s');
    assert.deepEqual(duplicateLabSlots(s1.config), [], 'the converted critics still pass duplicateLabSlots');
    assert.deepEqual(duplicateLabSlots(direct), [], 'the baseline: the API roster passes it too');
    assert.deepEqual(s1.config.seats.critics.map(s => s.model), ['subscription:haiku-5.5', 'subscription:haiku-5.5', 'subscription:sonnet-5.5', 'subscription:sonnet-5.5', 'subscription:sonnet-5.5', 'subscription:opus-5.5', 'subscription:fable-5.2', 'subscription:opus-5.5']);
    assert.deepEqual(s1.config.seats.critics.map(s => s.persona), direct.seats.critics.map(s => s.persona), 'every persona is kept');
    assert.deepEqual(s1.config.seats.criteria, council().seats.criteria, 'the criteria seat (already external) is as the chain file has it');
    // (2) the keys registered BEFORE the conversion are kept by the copies (keepSeatKey)
    const pre = council(); registerSeatKeys(pre);
    const s2 = Route.applySessionRoute(pre);
    assert.deepEqual(s2.config.seats.critics.map(seatKeyOf), pre.seats.critics.map(seatKeyOf), 'a converted copy keeps the key of the seat it copies');
    // the check can fail: twins that are no longer one model collide on a lab
    registerSeatKeys(s1.config);
    const bad = { ...s1.config, seats: { ...s1.config.seats, critics: s1.config.seats.critics.map((s, i) => (i === 1 ? { ...s, model: 'subscription:sonnet-5.5' } : s)) } };
    assert.deepEqual(duplicateLabSlots(bad), [{ slot: 'critics', labs: ['haiku5.5'] }], 'two seats of one lab that are not one model ARE a finding');
  } finally { registerSeatKeys({ seats: {} }); }
});
test('SS-2b the criteria seat of plan-claude-council (already external, lab opus5.5-sub) and its builder, reviser, skeleton, handoff and decider are the very same objects after the conversion', () => {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'plan-claude-council.json'), 'utf8'));
  const r = Route.applySessionRoute(c);
  for (const k of ['criteria', 'skeleton', 'builder', 'reviser', 'handoff', 'decider']) assert.equal(r.config.seats[k], c.seats[k], `${k} is untouched`);
  assert.equal(c.seats.criteria.lab, 'opus5.5-sub');
});

// SS-3: the TABLE. Every Claude model id the repo knows is either mapped to a session string by hand here or refused BY NAME; a Claude model added later turns this red until someone decides.
const SESSION_MAPPED = { 'claude-opus-5': 'subscription:opus-5', 'claude-opus-5-5': 'subscription:opus-5.5', 'claude-sonnet-5': 'subscription:sonnet-5', 'claude-sonnet-5-5': 'subscription:sonnet-5.5', 'claude-haiku-5-5': 'subscription:haiku-5.5', 'claude-fable-5-1': 'subscription:fable-5.1', 'claude-fable-5-2': 'subscription:fable-5.2' };
const SESSION_REFUSED = new Set(['claude-haiku-4-5-20251001']);      // a dated id: no family-version string can be read from it
test('SS-3 every Claude model id of the shipped chains\' seats, of src/pricing.json (anthropic/<id> and openrouter/anthropic/<id>) and of the default security reviewer maps to a "subscription:..." string by company anthropic, or is refused BY NAME; the same API model always gives the same string', () => {
  const pricing = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
  const ids = new Set([DEFAULT_SECURITY_REVIEWER_SEAT.model]);
  for (const k of Object.keys(pricing)) { const m = /^(?:openrouter\/)?(anthropic\/claude-.+)$/.exec(k); if (m) ids.add(m[1]); }
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) for (const { seat } of everySeatSlotsOf(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')))) if (isClaudeCfgSeat(seat)) ids.add(seat.model);
  assert.ok(ids.size >= 8, `Claude ids were found (${ids.size})`);
  for (const raw of ids) {
    const norm = raw.replace(/^anthropic\//, '').replace(/\./g, '-'); const got = Route.sessionModelOf(raw);
    if (norm in SESSION_MAPPED) {
      assert.equal(got, SESSION_MAPPED[norm], `${raw} maps to ${SESSION_MAPPED[norm]}`);
      assert.equal(companyOfModel(got), 'anthropic', `${got}: company anthropic`); assert.equal(companyOfSeat({ provider: 'external', model: got }), 'anthropic');
      for (const variant of [norm, ` ${norm.toUpperCase()} `, `anthropic/${norm}`, norm.replace(/-(\d)-(\d)$/, '-$1.$2')]) assert.equal(Route.sessionModelOf(variant), got, `the same API model always gives the same string (${JSON.stringify(variant)})`);
    } else if (SESSION_REFUSED.has(norm)) assert.equal(got, null, `${raw} is refused by name`);
    else assert.fail(`the Claude model "${raw}" has no session mapping and no named refusal: add it to SESSION_MAPPED or SESSION_REFUSED (and to src/claude-route.js's reading)`);
  }
  assert.equal(Route.sessionModelOf('claude-opus-5'), 'subscription:opus-5', 'a model with no minor version maps without one'); assert.equal(Route.sessionModelOf('claude-sonnet-5'), 'subscription:sonnet-5');
  assert.equal(Route.sessionModelOf('anthropic/claude-haiku-5.5'), 'subscription:haiku-5.5'); assert.equal(Route.sessionModelOf('claude-fable-5-2'), 'subscription:fable-5.2');
  for (const bad of ['claude-haiku-4-5-20251001', 'claude-3-5-sonnet-latest', 'claude-opus', 'claude-opus-5-5-20260101', 'gpt-6.1-sol', 'subscription:opus-5.5', '', undefined, null, 42]) assert.equal(Route.sessionModelOf(bad), null, `${JSON.stringify(bad)} is not a session model`);
});

test('SS-4 a Claude seat whose model cannot be mapped is NOT converted and is listed in `unmapped` (slot and model), whatever else converts; when nothing converts the SAME config comes back', () => {
  const c = deepFreeze({ name: 'u', seats: {
    critics: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', lab: 'old', layer: 1 }, { provider: 'anthropic', model: 'claude-opus-5-5', lab: 'o', layer: 1 }],
    proposers: [{ provider: 'openrouter', model: 'anthropic/claude-3-5-sonnet-latest', lab: 'son' }],
  } });
  const r = Route.applySessionRoute(c);
  assert.deepEqual(r.unmapped.map(x => `${x.slot}|${x.model}`).sort(), ['critics|claude-haiku-4-5-20251001', 'proposers|anthropic/claude-3-5-sonnet-latest']);
  assert.equal(r.config.seats.critics[0], c.seats.critics[0], 'the unmapped seat is the very same object'); assert.equal(r.config.seats.proposers[0], c.seats.proposers[0]);
  assert.equal(r.config.seats.critics[1].provider, 'external', 'a mappable seat of the same chain still converts'); assert.equal(r.converted.length, 1);
  const only = deepFreeze({ name: 'u2', seats: { critics: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', lab: 'old' }] } });
  const r2 = Route.applySessionRoute(only);
  assert.equal(r2.config, only, 'nothing converted: the same object'); assert.deepEqual(r2.converted, []); assert.equal(r2.unmapped.length, 1);
});

test('SS-5 `prompt_cache` is dropped from the converted chain exactly when no seats.critics seat satisfies cacheUsableSeat (the lint\'s own predicate is the oracle), kept when a direct anthropic or openrouter judge is left, never added when absent; the input keeps it', () => {
  const claude = (extra = {}) => ({ provider: 'anthropic', model: 'claude-sonnet-5-5', lab: 'c', ...extra });
  const cases = [
    ['only Claude judges (direct and through OpenRouter)', [claude({ layer: 1 }), { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', lab: 'h', layer: 1 }], false],
    ['a Claude judge and a mock judge', [claude(), { provider: 'mock', model: 'mock-critic-a', lab: 'm' }], false],
    ['a Claude judge and an external judge', [claude(), { provider: 'external', model: 'claude-code-session', lab: 'x' }], false],
    ['a Claude judge and an OpenRouter judge of another lab', [claude(), { provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', lab: 'qwen' }], true],
    ['a Claude judge and a direct Anthropic judge that cannot be mapped (it stays direct)', [claude(), { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', lab: 'old' }], true],
  ];
  for (const [name, critics, kept] of cases) {
    const input = deepFreeze({ name: 'pc', prompt_cache: { enabled: true, ttl: '5m' }, seats: { critics } });
    const out = Route.applySessionRoute(input).config;
    const oracle = (out.seats.critics ?? []).some(cacheUsableSeat);
    assert.equal(oracle, kept, `${name}: the oracle says the switch is ${kept ? 'usable' : 'unusable'}`);
    assert.equal('prompt_cache' in out, kept, `${name}: prompt_cache is ${kept ? 'kept' : 'dropped'}`);
    if (kept) assert.equal(out.prompt_cache, input.prompt_cache, `${name}: the very same setting`);
    assert.deepEqual(input.prompt_cache, { enabled: true, ttl: '5m' }, `${name}: the input keeps it`);
  }
  const none = Route.applySessionRoute({ name: 'np', seats: { critics: [claude()] } }).config;
  assert.equal('prompt_cache' in none, false, 'a chain without the switch does not gain one');
});

test('SS-6 nothing to convert: the SAME config object comes back with empty lists (a mock chain, a chain of other labs, a shipped chain with no Claude seat, a chain whose security reviewer is named and not Claude, a `prompt_cache` that stays)', () => {
  const mine = [
    { name: 'a', seats: { critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'm' }, { provider: 'openai', model: 'gpt-6.1-sol', lab: 'gpt' }], builder: { provider: 'external', model: 'claude-code-session' } } },
    { name: 'b', security_review: { enabled: true }, prompt_cache: { enabled: true }, seats: { critics: [{ provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', lab: 'q' }], security_reviewer: { provider: 'mock', model: 'mock-security-clean', lab: 's' } } },
    { name: 'c' }, { name: 'd', seats: {} },
  ];
  let shipped = 0;
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) { const cfg = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')); if (!everySeatSlotsOf(cfg).some(x => isClaudeCfgSeat(x.seat))) { mine.push(cfg); shipped++; } }
  assert.ok(shipped >= 5, `shipped chains without a Claude seat were found (${shipped})`);
  for (const c of mine) { const r = Route.applySessionRoute(deepFreeze(c)); assert.equal(r.config, c, `${c.name}: the same object`); assert.deepEqual(r.converted, []); assert.deepEqual(r.unmapped, []); }
});

test('SS-7 every SHIPPED chain: the converted list plus the unmapped list is exactly the Claude seats everySeatSlotsOf shows (the default reviewer included), none of them is unmapped, and no direct Claude seat is left', () => {
  let withClaude = 0;
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const cfg = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    const claude = everySeatSlotsOf(cfg).filter(x => isClaudeCfgSeat(x.seat));
    const r = Route.applySessionRoute(cfg);
    assert.equal(r.converted.length + r.unmapped.length, claude.length, `${f}: every Claude seat is converted or named`);
    assert.deepEqual(r.unmapped, [], `${f}: every Claude model of a shipped chain can be mapped`);
    assert.equal(everySeatSlotsOf(r.config).filter(x => isClaudeCfgSeat(x.seat)).length, 0, `${f}: no direct Claude seat is left`);
    if (claude.length) withClaude++;
  }
  assert.ok(withClaude >= 5, `shipped chains with Claude seats were found (${withClaude})`);
});

test('SS-8 routeLines for the session: ONE line, the exact sentences (SSW-w1, A-DRAFT) for 1 and 3 seats, with and without seats that still bill; the providers are named once', () => {
  const routed = n => Array.from({ length: n }, (_, i) => ({ slot: 'critics', model: 'm', layer: i, lab: `l${i}` }));
  const one = 'Claude seats: 1 Claude seat is answered by your own Claude Code session, one session for each seat (no API cost for it).';
  const three = 'Claude seats: 3 Claude seats are answered by your own Claude Code sessions, one session for each seat (no API cost for them).';
  assert.deepEqual(Route.routeLines({ route: 'session', why: 'chosen', routed: routed(1) }), [one]);
  assert.deepEqual(Route.routeLines({ route: 'session', why: 'chosen', routed: routed(3), stillBilling: [] }), [three]);
  assert.deepEqual(Route.routeLines({ route: 'session', why: 'recorded', routed: routed(3) }), [three], 'the line does not depend on why');
  assert.deepEqual(Route.routeLines({ route: 'session', why: 'chosen', routed: routed(1), stillBilling: [{ role: 'judge', provider: 'openai' }] }), [`${one} 1 other seat still bills through openai: judge. The spending limit asked for covers it.`]);
  assert.deepEqual(Route.routeLines({ route: 'session', why: 'chosen', routed: routed(3), stillBilling: [{ role: 'proposers', provider: 'openai' }, { role: 'critics', provider: 'openrouter' }, { role: 'critics', provider: 'openrouter' }] }),
    [`${three} 3 other seats still bill through openai and openrouter: proposers, critics, critics. The spending limit asked for covers them.`]);
  assert.deepEqual(Route.routeLines({ route: 'session', why: 'chosen', routed: routed(3), stillBilling: [{ role: 'a', provider: 'openai' }, { role: 'b', provider: 'openai' }] }), [`${three} 2 other seats still bill through openai: a, b. The spending limit asked for covers them.`], 'one provider named once');
});

// ---- each check must FAIL on a hand-made wrong function (rule 7: evidence that a check can fail, with no source change) --------------------------------------------------------------------
// CHANGED ACCEPTED TEST (0.8.4 session switch): OLD title listed 'session accepted' as a wrong function (session was refused). NEW: session refused/stopped is the wrong function, and the CR-12b check has its own wrong functions (a slot left unconverted, a mock seat copied). WHY: accepting session is now the right behaviour.
test('CR-8 every check above FAILS, at its own named assertion, on a hand-made wrong function: session still refused or stopped (the old behaviour), a session slot left unconverted, a malformed key routed, the lab dropped, the seat key dropped, the input mutated, the ban missing, a chain-level transport set, the wrong way out', () => {
  const seatsMap = (config, f) => ({ ...config, seats: Object.fromEntries(Object.entries(config.seats).map(([k, v]) => [k, Array.isArray(v) ? v.map(f) : f(v)])) });
  const routeAll = (config, f) => seatsMap(config, s => (s.provider === 'anthropic' ? f(s) : s));
  const banExtra = s => ({ ...(s.extra ?? {}), provider: { ...(s.extra?.provider ?? {}), ignore: [...(s.extra?.provider?.ignore ?? []), OPEN_INFERENCE] } });
  const rows = config => Object.entries(config.seats).flatMap(([slot, v]) => (Array.isArray(v) ? v : [v]).filter(s => s.provider === 'anthropic').map(s => ({ slot, model: s.model, layer: Number.isInteger(s.layer) ? s.layer : null, lab: s.lab || s.provider })));
  const routeEverySlot = (config, f) => { const r = routeAll(config, f); const d = config.seats.descending ? Object.fromEntries(Object.entries(config.seats.descending).map(([k, s]) => [k, s.provider === 'anthropic' ? f(s) : s])) : null; return { ...r, seats: { ...r.seats, ...(d ? { descending: d } : {}) }, ...(config.preflight ? { preflight: { ...config.preflight, seats: config.preflight.seats.map(s => (s.provider === 'anthropic' ? f(s) : s)) } } : {}) }; };      // a wrong function that routes EVERY slot, so the check under test is the first to fail on the property it names
  const wrapApply = f => (c, r) => (r === 'anthropic' ? { config: c, routed: [] } : { config: f(c), routed: [] });
  const wrongApply = f => (c, r) => (r === 'anthropic' ? { config: c, routed: [] } : r === 'openrouter' ? { config: f(c), routed: rows(c) } : (() => { throw new RangeError('no'); })());
  const good = s => keepSeatKey(s, { ...s, lab: s.lab || s.provider, transport: 'openrouter', extra: banExtra(s) });
  // wrong functions for CR-12b: they never touch Route; each gets the model string and lab right, so it fails at its own assertion
  const sessSeat = s => keepSeatKey(s, { provider: 'external', model: s.model === 'claude-fable-5-1' ? 'subscription:fable-5.1' : 'subscription:sonnet-5.5', lab: s.lab || s.provider, ...(s.maxTokens ? { maxTokens: s.maxTokens } : {}) });
  const sessFake = (opts = {}) => c => {
    const conv = s => (s && s.provider === 'anthropic' ? sessSeat(s) : opts.copyMock && s?.provider === 'mock' ? { ...s } : s);
    const seats = Object.fromEntries(Object.entries(c.seats).map(([k, v]) => [k, k === 'descending' ? (opts.skipDescending ? v : Object.fromEntries(Object.entries(v).map(([a, s]) => [a, conv(s)]))) : Array.isArray(v) ? v.map(conv) : conv(v)]));
    if (!opts.skipDefault && c.security_review?.enabled === true && !c.seats.security_reviewer) seats.security_reviewer = sessSeat(DEFAULT_SECURITY_REVIEWER_SEAT);
    const preflight = c.preflight && !opts.skipPreflight ? { ...c.preflight, seats: c.preflight.seats.map(conv) } : c.preflight;
    return { config: { ...c, seats, ...(preflight ? { preflight } : {}) }, converted: [], unmapped: [] };
  };
  const cases = [
    // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD row 'session accepted' (checkSessionRefused, a fake that READ session, must fail at "session is refused"). NEW rows: a fake that still REFUSES session as reserved (the old behaviour), and one that reads it only in lower case, must fail at "session is read as a setting". WHY: the property flipped; the check must fail on the OLD function.
    ['session still refused as reserved (the old read)', checkSessionRead, (v) => (typeof v === 'string' && ['auto', 'anthropic', 'openrouter'].includes(v.trim().toLowerCase()) ? { ok: true, setting: v.trim().toLowerCase() } : typeof v === 'string' && v.trim().toLowerCase() === 'session' ? { ok: false, code: 'session_reserved', message: `--claude-route: "session" is reserved for a mode that is not built yet, so it cannot be chosen. Use auto, anthropic or openrouter.` } : { ok: true, setting: 'auto' }), /session is read as a setting/],
    ['session read only exactly as typed in lower case', checkSessionRead, (v) => (v === 'session' ? { ok: true, setting: 'session' } : { ok: false, code: 'unknown_value', message: 'x' }), /session is read as a setting/],
    ['a hostile value echoed raw', checkSettingReads, (v) => (typeof v === 'string' && ['auto', 'anthropic', 'openrouter', 'session'].includes(v.trim().toLowerCase()) ? { ok: true, setting: v.trim().toLowerCase() } : v === undefined || v === null || (typeof v === 'string' && !v.trim()) ? { ok: true, setting: 'auto' } : { ok: false, code: 'unknown_value', message: `x: "${v}" is not a Claude route. Use auto, anthropic, openrouter or session.` }), /one line/],
    ['the unknown-value sentence still names three routes (the old tail)', checkSettingReads, (v, s) => (typeof v === 'string' && ['auto', 'anthropic', 'openrouter', 'session'].includes(v.trim().toLowerCase()) ? { ok: true, setting: v.trim().toLowerCase() } : v === undefined || v === null || (typeof v === 'string' && !v.trim()) ? { ok: true, setting: 'auto' } : { ok: false, code: 'unknown_value', message: `${s}: ${JSON.stringify(String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 40))} is not a Claude route. Use auto, anthropic or openrouter.` }), /names all four routes/],
    ['a malformed key routed silently', checkMalformedStops, (setting, a, o) => (a === 'malformed' ? { route: 'openrouter', why: 'no_anthropic_key' } : { route: 'anthropic', why: 'default' }), /a malformed Anthropic key stops/],
    ['the wrong way out (always the flag)', checkMalformedStops, (setting, a, o, way) => (a === 'absent' && o === 'malformed' ? { stop: true, code: 'openrouter_key_malformed', message: 'OPENROUTER_API_KEY is set, but it contains a line break or another control character (a two-line paste?). Nothing was sent. Set the key again on one line. There is no ANTHROPIC_API_KEY to fall back on, so no route was chosen for you. To use Anthropic instead, set ANTHROPIC_API_KEY.' } : a === 'malformed' ? { stop: true, code: 'anthropic_key_malformed', message: 'ANTHROPIC_API_KEY is set, but it contains a line break or another control character. No other route was chosen for you. To use OpenRouter instead, choose it with --claude-route openrouter; that needs OPENROUTER_API_KEY.' } : { route: 'anthropic', why: 'default' }), /the way out is the caller/],
    ['auto routes with a key present', checkAutoTable, (setting, a, o) => (o === 'usable' ? { route: 'openrouter', why: 'no_anthropic_key' } : { route: 'anthropic', why: 'default' }), /stays direct/],
    ['openrouter chosen, refused when the OpenRouter key is absent', checkDecisionMatrix, fromMatrix({ ...MATRIX, openrouter: { ...MATRIX.openrouter, usable: ['openrouter/chosen', 'stop:no_key', 'openrouter/chosen'] } }), /setting "openrouter", Anthropic key usable, OpenRouter key absent/],
    ['auto routes to OpenRouter though the Anthropic key is usable and the OpenRouter key is malformed', checkDecisionMatrix, fromMatrix({ ...MATRIX, auto: { ...MATRIX.auto, usable: ['anthropic/default', 'anthropic/default', 'openrouter/no_anthropic_key'] } }), /setting "auto", Anthropic key usable, OpenRouter key malformed/],
    ['a malformed OpenRouter key falls to the Anthropic route (the old result)', checkMalformedStops, (setting, a, o, way) => (a === 'malformed' ? { stop: true, code: 'anthropic_key_malformed', message: `ANTHROPIC_API_KEY is set, but it contains a line break or another control character (a two-line paste?). Nothing was sent. Set the key again on one line. No other route was chosen for you. To use OpenRouter instead, choose it with ${way ?? '--claude-route openrouter'}; that needs OPENROUTER_API_KEY.` } : a === 'usable' || o !== 'usable' ? { route: 'anthropic', why: 'default' } : { route: 'openrouter', why: 'no_anthropic_key' }), /a malformed OpenRouter key with no Anthropic key stops/],
    ['the old matrix cell (a malformed OpenRouter key falls to anthropic/default)', checkDecisionMatrix, fromMatrix({ ...MATRIX, auto: { ...MATRIX.auto, absent: ['openrouter/no_anthropic_key', 'anthropic/default', 'anthropic/default'] } }), /setting "auto", Anthropic key absent, OpenRouter key malformed/],
    ['the descending map and preflight.seats not routed (the group-1 behaviour)', checkApplyAllSlots, wrapApply(c => routeAll(c, good)), /slot descending\.one: a direct Claude seat is routed/],
    ['preflight.seats not routed', checkApplyAllSlots, wrapApply(c => { const r = routeAll(c, good); return { ...r, seats: { ...r.seats, descending: Object.fromEntries(Object.entries(c.seats.descending).map(([k, s]) => [k, s.provider === 'anthropic' ? good(s) : s])) } }; }), /slot preflight\.seats\[0\]: a direct Claude seat is routed/],
    // CHANGED ACCEPTED TEST (0.8.4 session switch): OLD row 'session not stopped' (checkSessionStops: a fake that returned anthropic/default for session must fail at "session stops whatever keys exist"). NEW rows: a fake that still STOPS session (the old behaviour), one that needs a key, and one that lets `auto` pick session each fail at their own assertion. WHY: the property flipped.
    ['session still stopped as reserved (the old decision)', checkSessionRoutes, (setting, a, o) => (setting.trim().toLowerCase() === 'session' ? { stop: true, code: 'session_reserved', message: 'x' } : { route: 'anthropic', why: 'default' }), /session needs no key/],
    ['session needs an Anthropic key', checkSessionRoutes, (setting, a, o) => (setting.trim().toLowerCase() === 'session' ? (a === 'usable' ? { route: 'session', why: 'chosen' } : { stop: true, code: 'anthropic_key_missing', message: 'x' }) : { route: 'anthropic', why: 'default' }), /session needs no key: Anthropic key absent/],
    ['session routed as anthropic with no key', checkSessionRoutes, (setting, a, o) => ({ route: 'anthropic', why: 'chosen' }), /session needs no key/],
    ['auto picks session when there is no key at all', checkSessionRoutes, (setting, a, o) => (setting.trim().toLowerCase() === 'session' || (setting === 'auto' && a === 'absent' && o === 'absent') ? { route: 'session', why: setting === 'auto' ? 'default' : 'chosen' } : { route: 'anthropic', why: 'default' }), /auto never picks session/],
    ['session stopped when the OpenRouter key is absent (matrix cell)', checkDecisionMatrix, fromMatrix({ ...MATRIX, session: { ...MATRIX.session, usable: ['session/chosen', 'stop:no_key', 'session/chosen'] } }), /setting "session", Anthropic key usable, OpenRouter key absent/],
    ['session stopped when the Anthropic key is malformed (matrix cell)', checkDecisionMatrix, fromMatrix({ ...MATRIX, session: { ...MATRIX.session, malformed: ['stop:anthropic_key_malformed', 'session/chosen', 'session/chosen'] } }), /setting "session", Anthropic key malformed, OpenRouter key usable/],
    ['session in the matrix still the old stop', checkDecisionMatrix, fromMatrix({ ...MATRIX, session: { usable: ['stop:session_reserved', 'stop:session_reserved', 'stop:session_reserved'], malformed: ['stop:session_reserved', 'stop:session_reserved', 'stop:session_reserved'], absent: ['stop:session_reserved', 'stop:session_reserved', 'stop:session_reserved'] } }), /setting "session", Anthropic key usable, OpenRouter key usable/],
    ['a chain-level transport set', checkApplyRoutes, wrongApply(c => ({ ...routeAll(c, good), transport: 'openrouter' })), /no chain-level transport/],
    ['the input mutated', checkApplyRoutes, (c, r) => { if (r === 'anthropic') return { config: c, routed: [] }; if (r !== 'openrouter') throw new RangeError('no'); const out = routeAll(c, good); c.seats.criteria.transport = 'openrouter'; return { config: out, routed: rows(c) }; }, /the input is unchanged/],
    ['a direct run is a copy', checkApplyRoutes, (c, r) => (r === 'anthropic' ? { config: { ...c }, routed: [] } : wrongApply(x => routeAll(x, good))(c, r)), /anthropic returns the same config/],
    ['the ban missing', checkApplyBan, wrongApply(c => routeEverySlot(c, s => keepSeatKey(s, { ...s, lab: s.lab || s.provider, transport: 'openrouter', extra: { ...(s.extra ?? {}), provider: { ...(s.extra?.provider ?? {}) , ignore: [...(s.extra?.provider?.ignore ?? [])] } } }))), /the repo's host-ban slug|Cannot read/],
    ['the lab dropped', checkApplyKeepsLab, wrongApply(c => routeAll(c, s => keepSeatKey(s, { ...s, transport: 'openrouter', extra: banExtra(s) }))), /a routed seat with no lab is given its provider/],
    ['the seat key dropped', checkApplyKeepsKey, wrongApply(c => routeAll(c, s => ({ ...s, lab: s.lab || s.provider, transport: 'openrouter', extra: banExtra(s) }))), /a routed copy keeps the key/],
    ['session route: the descending map left direct', checkApplySessionAllSlots, sessFake({ skipDescending: true }), /slot descending\.one: a direct Claude seat is converted/],
    ['session route: preflight.seats left direct', checkApplySessionAllSlots, sessFake({ skipPreflight: true }), /slot preflight\.seats\[0\]: a direct Claude seat is converted/],
    ['session route: the default security reviewer left direct', checkApplySessionAllSlots, sessFake({ skipDefault: true }), /the default security reviewer is converted/],
    ['session route: a mock seat copied (not the very same object)', checkApplySessionAllSlots, sessFake({ copyMock: true }), /a seat that is not Claude is the very same object/],
  ];
  try {
  for (const [name, check, wrong, why] of cases) {
    assert.throws(() => check(wrong), err => err instanceof assert.AssertionError && why.test(`${err.message}`), `the check must fail on "${name}" at its own assertion`);
    assert.ok(nameOfCheck(check), `${name}: the check is on the registered list`); shownFailing.add(nameOfCheck(check)); wrongFunctions++;
  }
  // a ban added twice (a wrong function that never dedupes)
  const twice = wrongApply(c => routeEverySlot(c, s => keepSeatKey(s, { ...s, lab: s.lab || s.provider, transport: 'openrouter', extra: { ...(s.extra ?? {}), provider: { ...(s.extra?.provider ?? {}), ignore: [...(s.extra?.provider?.ignore ?? []), OPEN_INFERENCE] } } })));
  assert.throws(() => checkApplyBan(twice), err => err instanceof assert.AssertionError && /applying twice adds the ban once/.test(err.message), 'the check must fail on a ban added twice');
  shownFailing.add(nameOfCheck(checkApplyBan)); wrongFunctions++;
  } finally { registerSeatKeys({ seats: {} }); }
});

test('CR-10 the SAME list: the checks the real-module tests PASSED and the checks shown failing on a wrong function are exactly the registered checks (the count both ways is printed)', () => {
  const all = Object.keys(CHECKS).sort();
  console.log(`CLAUDE-ROUTE checks: ${all.length} registered, ${ran.size} passed on the real module, ${shownFailing.size} shown failing on a wrong function (${wrongFunctions} wrong functions)`);
  assert.deepEqual([...ran].sort(), all, 'every registered check passed on the real module');
  assert.deepEqual([...shownFailing].sort(), all, 'every registered check was shown failing on a wrong function');
});
