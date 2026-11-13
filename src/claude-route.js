// 0.8.4 the Claude route (the OpenRouter switch, first group; Builder B; the session route, Helper A). Where the Claude seats of a chain are called: straight to Anthropic ("anthropic"), through OpenRouter ("openrouter"), or by the person's own Claude Code sessions ("session").
// The setting `claude_route` is auto | anthropic | openrouter | session. `auto` never picks `session`: it is only ever the person's own choice. A session run turns every Claude seat into an external seat (the run pauses at it, exit 3, the way it does at the handler's stages), so those seats cost no API money.
// This module is PURE: it reads no file and no environment variable of its own (the caller passes facts or an env object), imports neither chain.js nor providers.js, and changes nothing it is given.
// What is NOT here (the wiring group): the flag, the MCP argument and the .env/shell reader that call it; resolveRun (= applyClaudeRoute + resolveChainSeats, which lives in chain.js); the E001 text; the cap-screen line; the records.
import { keyEnvValue, keyProblem, MALFORMED_KEY_HINT } from './key-env.js';
import { keepSeatKey } from './seat-key.js';
import { OPEN_INFERENCE } from './host-block.js';
import { cacheUsableSeat } from './prompt-cache.js';      // the lint's own predicate (it imports nothing)
import { companyOfSeat } from './answered-by.js';      // the one model-to-company table: a Claude model is found by its model, not by `provider === 'anthropic'`, so one routed through OpenRouter is found too (it imports only hidden-chars.js)
import { DEFAULT_SECURITY_REVIEWER_SEAT } from './security-review.js';      // the default reviewer is a Claude seat that lives outside config.seats; its only import is container-text.js, so this module stays free of chain.js and providers.js      // the slug of the OpenRouter host this project never routes to (decision 8, 28 Okt 2026), the repo's one copy

export const CLAUDE_ROUTE_ENV = 'COUNCIL_CLAUDE_ROUTE';      // operator-only: refused from a project .env (src/env-file.js)
export const CLAUDE_ROUTE_SETTINGS = Object.freeze(['auto', 'anthropic', 'openrouter', 'session']);
const NAMES = `${CLAUDE_ROUTE_SETTINGS.slice(0, -1).join(', ')} or ${CLAUDE_ROUTE_SETTINGS.at(-1)}`;      // "auto, anthropic, openrouter or session"
const ZDR_IGNORED_HOST = OPEN_INFERENCE;      // every routed Claude seat carries it in extra.provider.ignore (src/price-pin.js adds it at the call whatever a chain says; this keeps the roster honest)

// A value from outside, shown back in a sentence: short, one line, quoted.
const shown = v => JSON.stringify(String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 40));

/**
 * The setting from a typed value. Nothing or blank is `auto`. -> { ok: true, setting } | { ok: false, code: 'unknown_value', message }.
 * `source` names where it came from (for the sentence): "--claude-route", "COUNCIL_CLAUDE_ROUTE", "the claude_route argument".
 */
export function readClaudeRouteSetting(value, source = CLAUDE_ROUTE_ENV) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return { ok: true, setting: 'auto' };
  const v = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (v !== null && CLAUDE_ROUTE_SETTINGS.includes(v)) return { ok: true, setting: v };
  return { ok: false, code: 'unknown_value', message: `${source}: ${shown(value)} is not a Claude route. Use ${NAMES}.` };
}

/** The facts the decision needs, from an environment object the caller passes: each key is 'usable', 'malformed' (set but unusable) or 'absent' (unset, blank or an unfilled template). The key value is never returned. */
export function claudeRouteFacts(env = {}) {
  const state = name => (keyEnvValue(name, env) ? 'usable' : keyProblem(name, env) === 'malformed' ? 'malformed' : 'absent');
  return { anthropicKey: state('ANTHROPIC_API_KEY'), openRouterKey: state('OPENROUTER_API_KEY') };
}

/**
 * Which way the Claude seats go. -> { route: 'anthropic' | 'openrouter' | 'session', why: 'chosen' | 'no_anthropic_key' | 'default' } or a STOP { stop: true, code, message } (nothing is routed).
 * auto routes to OpenRouter only when there is NO Anthropic key (absent) and a usable OpenRouter key; a MALFORMED Anthropic key never routes silently: it stops and names both ways out; with NO Anthropic key and a MALFORMED OpenRouter key it stops too and names that key.
 * `wayOut` names how THIS caller chooses OpenRouter (a command line says "--claude-route openrouter", an MCP caller says its argument), so the stop never points at a flag the caller does not have.
 * `anthropic`, `openrouter` and `session` are the person's choice and are never refused here (`session` needs no key at all) (a missing key for the chosen way is the key check's business, as today). With neither key set (both absent), auto says `anthropic`, so today's key check speaks.
 */
export function claudeRouteOf({ setting = 'auto', anthropicKey = 'absent', openRouterKey = 'absent', wayOut = '--claude-route openrouter' } = {}) {
  const read = readClaudeRouteSetting(setting);
  if (!read.ok) return { stop: true, code: read.code, message: read.message };
  if (read.setting === 'anthropic' || read.setting === 'openrouter' || read.setting === 'session') return { route: read.setting, why: 'chosen' };
  if (anthropicKey === 'usable') return { route: 'anthropic', why: 'default' };
  if (anthropicKey === 'malformed') return { stop: true, code: 'anthropic_key_malformed', message: `ANTHROPIC_API_KEY is set, but ${MALFORMED_KEY_HINT} No other route was chosen for you. To use OpenRouter instead, choose it with ${wayOut}; that needs OPENROUTER_API_KEY.` };
  if (openRouterKey === 'usable') return { route: 'openrouter', why: 'no_anthropic_key' };
  // No Anthropic key and an OpenRouter key that is set but cannot be used: the person is told about THAT key (the key check would name a missing Anthropic key instead); both ways out are named.
  if (openRouterKey === 'malformed') return { stop: true, code: 'openrouter_key_malformed', message: `OPENROUTER_API_KEY is set, but ${MALFORMED_KEY_HINT} There is no ANTHROPIC_API_KEY to fall back on, so no route was chosen for you. To use Anthropic instead, set ANTHROPIC_API_KEY.` };
  return { route: 'anthropic', why: 'default' };
}

const isSeat = x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.provider === 'string';
const routedSeat = seat => {
  const ignore = Array.isArray(seat.extra?.provider?.ignore) ? seat.extra.provider.ignore : [];
  const extra = { ...(seat.extra ?? {}), provider: { ...(seat.extra?.provider ?? {}), ignore: ignore.includes(ZDR_IGNORED_HOST) ? [...ignore] : [...ignore, ZDR_IGNORED_HOST] } };
  // `lab` is set when the seat has none: labOf (seat.lab || seat.provider) must not move when the provider changes underneath it. transport is the seat-level key resolveChainSeats reads; a chain-level transport is NEVER set (it would reroute other labs' seats).
  return keepSeatKey(seat, { ...seat, lab: seat.lab || seat.provider, transport: 'openrouter', extra });
};

// Every seat slot a route may rewrite, in ONE walk shared by both routes (so which seats are found cannot drift between them): the seats.* slots (a list, a single seat, and the MAP seats.descending), config.preflight.seats, and the default
// security reviewer. `fn(seat, slot)` returns the seat itself (not a Claude seat of this route) or its replacement. The input is never changed; the config comes back as it is when nothing was replaced would be the caller's to test.
function mapSeatSlots(config, fn) {
  const slots = {};
  // The default security reviewer (src/chain.js everySeatSlotsOf: "security_reviewer (default)") is a direct Claude seat that no chain file names. When the review is on and no reviewer is named, a COPY of the route's own seat is written into seats.security_reviewer, so the
  // stage's own fallback (`config.seats.security_reviewer || DEFAULT_SECURITY_REVIEWER_SEAT`) finds it and resolveChainSeats rewrites it with the rest. With the route anthropic nothing is added (the stage uses its constant, as today).
  if (config?.security_review?.enabled === true && !config.seats?.security_reviewer) slots.security_reviewer = fn(DEFAULT_SECURITY_REVIEWER_SEAT, 'security_reviewer (default)');
  for (const [slot, value] of Object.entries(config?.seats ?? {})) {
    if (slot === 'descending' && value && typeof value === 'object' && !Array.isArray(value) && !isSeat(value)) {      // a MAP stage -> seat (src/chain.js seatSlotsOf: the role is "descending.<stage>")
      slots[slot] = Object.fromEntries(Object.entries(value).map(([stage, seat]) => [stage, fn(seat, `descending.${stage}`)]));
    } else slots[slot] = Array.isArray(value) ? value.map(s => fn(s, slot)) : fn(value, slot);
  }
  // config.preflight.seats sits OUTSIDE config.seats (src/chain.js everySeatSlotsOf adds it): rewritten the same way, and the preflight object is the very same one when none of its seats is rewritten.
  const pre = config?.preflight;
  const preSeats = Array.isArray(pre?.seats) ? pre.seats.map(s => fn(s, 'preflight.seats')) : null;
  const preChanged = preSeats !== null && preSeats.some((s, i) => s !== pre.seats[i]);
  return { ...config, seats: slots, ...(preChanged ? { preflight: { ...pre, seats: preSeats } } : {}) };
}

/**
 * The chain with its Anthropic seats routed. -> { config, routed: [{ slot, model, layer, lab }] }.
 * 'anthropic': the SAME config object back, nothing routed (a direct run is byte-identical to today). 'openrouter': a new config in which every seat with provider "anthropic", in every seats.* slot (a list, a single seat, and the MAP seats.descending) and in config.preflight.seats, is a copy with transport "openrouter" and
 * "open-inference" in extra.provider.ignore (merged into a list the seat already has, never twice); mock, external and every non-Claude seat are the very same objects. Seat key, lab, persona, layer and maxTokens are kept.
 * The input is never changed. Call it BEFORE the seat keys are registered, then resolve the seats (chain.js) and register.
 */
export function applyClaudeRoute(config, route) {
  if (route === 'anthropic') return { config, routed: [] };
  if (route !== 'openrouter') throw new RangeError(`applyClaudeRoute: route must be "anthropic" or "openrouter", not ${shown(route)}`);
  const routed = [];
  const routeSeat = (seat, slot) => {
    if (!isSeat(seat) || seat.provider !== 'anthropic') return seat;
    const copy = routedSeat(seat);
    routed.push({ slot, model: seat.model, layer: Number.isInteger(seat.layer) ? seat.layer : null, lab: copy.lab });
    return copy;
  };
  return { config: mapSeatSlots(config, routeSeat), routed };
}

// ---- the session route: every Claude seat answered by the person's own Claude Code session ----

// The Claude models a session can stand in for, by the API id (a router prefix and dots are read: "anthropic/claude-haiku-5.5"). The seat becomes the external model string "subscription:<family>-<major>.<minor>"; the string is only a hint of which session the person should open
// (src/answered-by.js companyOfModel reads it by family). The same API model always gives the same string, so a repeated model in a layered panel is still the allowed repeat (src/seat-key.js repeatedModelKeys). A Claude id this does not read is refused, named, before anything is spent.
const SESSION_MODEL = /^(?:anthropic\/)?claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d+))?$/;      // the minor version is optional ("claude-opus-5"); a dated id ("claude-haiku-4-5-20251001") is not read
export const sessionModelOf = model => { const m = SESSION_MODEL.exec(String(model ?? '').trim().toLowerCase()); return m ? `subscription:${m[1]}-${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}` : null; };
const isClaudeSeat = seat => isSeat(seat) && seat.provider !== 'external' && seat.provider !== 'mock' && (seat.provider === 'anthropic' || companyOfSeat(seat) === 'anthropic');
// What the seat keeps: everything but what only an API call reads (`extra`: the effort field and the host choice; `transport`; `temperature`). `lab` is made explicit (labOf is `seat.lab || seat.provider` and must not move when the provider does), so labOf, the seat key and every stage
// label of the converted chain equal the API chain's; persona, layer and maxTokens stay.
const sessionSeat = (seat, model) => {
  const { extra, transport, temperature, ...rest } = seat;
  return keepSeatKey(seat, { ...rest, provider: 'external', model, lab: seat.lab || seat.provider });
};

/**
 * The chain with every Claude seat turned into the external form, in every slot the other route walks (mapSeatSlots), including the default security reviewer when the review is on (else it would stay a paid direct seat).
 * -> { config, converted: [{ slot, model, now, layer, lab }], unmapped: [{ slot, model }] }. Other labs' seats, mock seats and external seats are the very same objects. `prompt_cache` is removed when no judge seat that can use it is left (the lint refuses a chain that has one and no such seat). The input is never changed. A non-empty `unmapped` means the caller must refuse the run: nothing is spent.
 */
export function applySessionRoute(config) {
  const converted = [];
  const unmapped = [];
  const convert = (seat, slot) => {
    if (!isClaudeSeat(seat)) return seat;
    const now = sessionModelOf(seat.model);
    if (now === null) { unmapped.push({ slot, model: seat.model }); return seat; }
    const copy = sessionSeat(seat, now);
    converted.push({ slot, model: seat.model, now, layer: Number.isInteger(seat.layer) ? seat.layer : null, lab: copy.lab });
    return copy;
  };
  const out = mapSeatSlots(config, convert);
  if (converted.length === 0) return { config, converted, unmapped };
  // The lint (src/prompt-cache.js lintPromptCache) refuses `prompt_cache` when no judge seat of seats.critics can use it (cacheUsableSeat): the converted chain is asked the same question, by the lint's own predicate, and drops the switch when the answer is no.
  if (out.prompt_cache !== undefined && !(Array.isArray(out.seats?.critics) ? out.seats.critics : []).some(cacheUsableSeat)) { const { prompt_cache, ...rest } = out; return { config: rest, converted, unmapped }; }
  return { config: out, converted, unmapped };
}

/**
 * The line a start screen and a dry run print when the Claude seats go through OpenRouter, before anything is paid. A direct run prints nothing (its output is what it always was). `route`, `why` and `routed` are resolveRun's answer.
 * A-DRAFT (wording row SW2-w3, SW2-w4): the owner's yes comes with the one wording review.
 */
export function routeLines({ route, why, routed, stillBilling } = {}) {
  // THE SESSION ROUTE: ONE line (the cap screen and the handler's limit dialog take the first line), the Claude seats first, then, when anything still bills, which seats and that the limit typed is for them. A-DRAFT (wording row SSW-w1).
  if (route === 'session') {
    const n = (routed ?? []).length; const many = n !== 1;
    const head = `Claude seats: ${n} Claude seat${many ? 's are' : ' is'} answered by your own Claude Code session${many ? 's' : ''}, one session for each seat (no API cost for ${many ? 'them' : 'it'}).`;
    const paid = Array.isArray(stillBilling) ? stillBilling : [];
    if (paid.length === 0) return [head];
    const providers = [...new Set(paid.map(p => p.provider))];
    return [`${head} ${paid.length} other seat${paid.length === 1 ? '' : 's'} still bill${paid.length === 1 ? 's' : ''} through ${providers.join(' and ')}: ${paid.map(p => p.role).join(', ')}. The spending limit asked for covers ${paid.length === 1 ? 'it' : 'them'}.`];
  }
  // A DRY RUN that a key state would have stopped as a start is priced on the direct route and says so, naming the route and nothing about the key (a dry run needs no key). A direct run with a usable key prints nothing.
  if (route === 'anthropic' && (why === 'key_state' || why === 'recorded')) return ['Claude seats: priced as calls straight to Anthropic.'];
  if (route !== 'openrouter') return [];
  const n = (routed ?? []).length;
  const seats = `${n} Claude seat${n === 1 ? '' : 's'}`; const go = n === 1 ? 'goes' : 'go'; const bill = n === 1 ? 'It is' : 'They are';      // a mock chain with the security review on routes exactly one seat, the default reviewer
  return [why === 'no_anthropic_key'
    ? `Claude seats: ${seats} ${go} through OpenRouter, because no ANTHROPIC_API_KEY is set. ${bill} billed at OpenRouter's prices. To use Anthropic instead, set ANTHROPIC_API_KEY.`
    : why === 'recorded'      // a dry run of an existing run that began through OpenRouter, priced on that route while a key is unusable (SW2-w18)
      ? `Claude seats: ${seats} ${go} through OpenRouter, as this run began. ${bill} billed at OpenRouter's prices.`
      : `Claude seats: ${seats} ${go} through OpenRouter, as you chose. ${bill} billed at OpenRouter's prices.`];
}

/**
 * What the session route asks of the person's sessions AT LEAST, from the shape of the chain alone (not the cost estimator, which prices a session seat at $0): { stops, answers }. A stop is one pause of the run; a parallel stage (the proposals, a debate round, one layer of judges)
 * is ONE stop however many seats it has, and each seat of it is one answer. Counted: the proposals stage and the debate's first round (when the chain has them) for the converted proposers, and one stop per layer (or one for a flat panel) for the converted judges, in a run in which every
 * judge agrees at the first reading. A disagreement, a revision or a debate round beyond the first adds more; the stages the person's own session already answers in every plan chain (criteria, skeleton, build, revise, handoff) are not counted. Pure over `routed` (applySessionRoute's `converted`).
 */
export function sessionStopsOf(config, routed = [], { draft = false } = {}) {
  let stops = 0; let answers = 0;
  const proposers = routed.filter(r => r.slot === 'proposers').length;
  // the stage gates are runChain's own (src/chain.js): proposals run when the chain has them and no draft was handed in (--draft skips them); the debate runs when the chain has one and more than one proposal came back (here: more than one proposer seat)
  if (proposers > 0 && config?.proposals && !draft) {
    stops += 1; answers += proposers;
    if (config.debate && (config.seats?.proposers ?? []).length > 1) { stops += 1; answers += proposers; }
  }
  const groups = new Map();
  for (const r of routed) if (r.slot === 'critics') groups.set(r.layer, (groups.get(r.layer) ?? 0) + 1);
  for (const n of groups.values()) { stops += 1; answers += n; }
  return { stops, answers };
}

/** The dry run's one line about the session route, or []: what the sessions are asked at least (`opts.draft`: a draft was handed in, so no proposals). A-DRAFT (wording row SSW-w11). */
export function sessionStopsLines({ route, routed } = {}, config, opts) {
  if (route !== 'session') return [];
  const { stops, answers } = sessionStopsOf(config, routed ?? [], opts);
  if (answers === 0) return [];
  return [`Your sessions are asked at least ${answers} time${answers === 1 ? '' : 's'}, in at least ${stops} pause${stops === 1 ? '' : 's'} of the run. Those are the figures for a run in which every judge agrees at the first reading; a disagreement or a revision adds to them.`];
}

/** The line a dry run of an EXISTING run prints under its route line when the real verb (`resume`, or `rematch` / `replay` for a side run) would stop on a key (resolveRun's `stopNote`): the price is shown, and so is the stop. A-DRAFT (wording row SW2-w19). [] when there is none. */
export function resumeStopLines({ stopNote } = {}, verb = 'resume') {
  return typeof stopNote === 'string' && stopNote !== '' ? [`A real ${verb} of this run stops here: ${stopNote}`] : [];
}
