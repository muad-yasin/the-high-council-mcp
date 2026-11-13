// 0.8.4 the Claude route, WIRING (Builder B): the ONE place a run's chain gets its Claude route. resolveRun(config, ...) = read the setting, ask whether the chain has a direct Claude seat at all, decide the route from the key facts, route the seats
// (src/claude-route.js applyClaudeRoute), then resolve the seats the way every site always did (src/chain.js resolveChainSeats). Every site that resolved a chain before calls this instead, so the decision is made once, in one order, for every entry point.
// THE ORDER (each step can stop the run before anything is paid):
//   1. the SETTING is read: any unknown value STOPS, on any chain (a wrong flag is wrong on every chain; the PII setting and the spending caps refuse the same way);
//   1b. THE SESSION ROUTE (`session`, the person's own choice; `auto` never picks it) is decided here, before any key is asked about: it needs no key. An EXISTING run whose record says `session` stays a session run when nothing is typed (the run keeps its seats), and goes to the API only when the person types a route.
//   2. a chain with NO direct Claude seat is returned resolved and unrouted, and no key state can stop it (a malformed Anthropic key does not stop a mock or China chain today: test/claude-route.test.js CR-14). The question is asked of applyClaudeRoute's own
//      routed list, the same walk that routes (the default security reviewer counts), so the question and the routing cannot drift;
//   3. the route is DECIDED from the key facts (claudeRouteOf: a malformed key never routes silently, it stops);
//   3b. a DRY RUN (`dry`: a dry run, a price, a tree's dry run) calls nothing and needs no key, so a key stop does not stop it and it says nothing about the key: it is priced on the route the start takes once the key is mended (a malformed Anthropic key: direct; a malformed OpenRouter key with no Anthropic key: OpenRouter). A dry run of an EXISTING run (`recorded` given) that a KEY state would stop is priced on the route the run began with, with the real verb's own stop sentence carried beside it (`stopNote`); a changed key choice (step 4) still stops it, as it stops the real verb, and the stop names the flag that prices the other route. A value that is not a route still refuses it;
//   4. an EXISTING run (`recorded` given: the route its run.json says) is never moved by that file: the route is decided afresh from what only the person controls (the flag, the shell, the MCP argument, the keys; ONE exception, step 1b: a recorded SESSION run is moved only by a flag or argument typed for this invocation, never by the shell or the keys), and when an AUTO decision differs
//      from the recorded route the run STOPS before any paid call and names both ways out; a dry run stops the same way (`--claude-route <route>` with `--dry-run` prices the route the person asks for). A planted value can therefore cause a refusal and never a move; a run with no recorded route is a direct run. A route the person CHOSE is obeyed (a person-asked change).
//   5. the seats are routed, then resolved.
// PURE except for the two functions that read a .env text the caller points at; it reads no environment variable of its own (the caller passes `env`).
import { readFileSync, existsSync } from 'node:fs';
import { applyEnvFile, envFilePathFor } from './env-file.js';
import { resolveChainSeats, everySeatSlotsOf } from './chain.js';
import { isPaidSeat } from './caps.js';
import { applyClaudeRoute, applySessionRoute, claudeRouteFacts, claudeRouteOf, readClaudeRouteSetting, CLAUDE_ROUTE_ENV } from './claude-route.js';

/** The environment the KEY CHECK sees, as an object: `processEnv` with the project's .env text applied the way the CLI applies it (src/cli.js: the real environment wins, a blank or unfilled value does not, the refused names stay refused, so a project file can never set COUNCIL_CLAUDE_ROUTE). `processEnv` is never changed. */
export function mergedKeyEnv(processEnv, envText = '') {
  const env = { ...(processEnv ?? {}) };
  if (typeof envText === 'string' && envText !== '') applyEnvFile(envText, env);
  return env;
}
/** The text of the .env the CLI would apply for this folder (the folder's own, else the package's), or '' when there is none or it cannot be read. The MCP server and the other sites that do not apply a .env pass this to mergedKeyEnv. */
export function envTextOf(folder, pkg) {
  const path = envFilePathFor(folder, pkg);
  if (!existsSync(path)) return '';
  try { return readFileSync(path, 'utf8'); } catch { return ''; }      // fs-ok: the folder's own .env, read as src/cli.js reads it
}

/** The route a run records: 'anthropic' | 'openrouter' | 'session'. A run whose record has none (every run written before the switch) is a direct run. */
export const recordedRouteOf = meta => (meta?.claude_route === 'openrouter' || meta?.claude_route === 'session' ? meta.claude_route : 'anthropic');

/** The seats of a resolved chain that still bill (a provider that is not mock, external or local): [{ role, provider }]. A session run names them where the money is approved. */
export const stillBillingOf = config => everySeatSlotsOf(config).filter(x => isPaidSeat(x.seat)).map(x => ({ role: x.role, provider: x.seat.provider }));

/**
 * -> { config, route: 'anthropic' | 'openrouter', why, routed, unrouted } on success (`unrouted` is the same chain resolved WITHOUT the route; the cache fingerprint is made from its seats); { stop: true, code, message } when the run must not start.
 * `flag` is the person's typed value (the command line flag or the MCP argument), `flagSource` names it in a sentence ("--claude-route", "the claude_route argument"); with none, `env.COUNCIL_CLAUDE_ROUTE` is the setting, else auto.
 * `env` is the merged key view (mergedKeyEnv) the key check itself reads. `choose(route)` names how THIS entry point chooses a route in a sentence (a command line says "--claude-route openrouter", the MCP tool says its argument). `recorded` is { route } for an existing run (resume, rematch, replay, handoff from a run, price raise), omitted for a new one. `dry` is true for a dry run or a price: a key state never stops it (an existing run is then priced on the route it began with, step 3b above); a changed key choice for an existing run stops it, as it stops the real verb.
 * A dry run of an existing run that a KEY state would stop as a real verb also carries `stopNote`, the sentence the real verb stops with (the entry point prints it under its route line). `why` is claudeRouteOf's ('chosen' | 'no_anthropic_key' | 'default'), or 'no_claude_seat', or, for a dry run that no key can stop, 'key_state' (priced straight to Anthropic under a malformed Anthropic key) or 'recorded' (an existing run, priced on the route it began with) (the chain seats no direct Claude model, nothing is routed and no key state is looked at).
 */
const NOTHING = 'Nothing was started and nothing was spent.';
/** The stops that are about a KEY (a malformed one). A caller that has an exit code for "a key is unusable" uses it for these (src/cli.js: EXIT_DEGRADABLE, the code every other lab's malformed key exits with at the key check); the others are a refusal of what was typed or chosen. */
export const KEY_STOPS = new Set(['anthropic_key_malformed', 'openrouter_key_malformed']);
const stopOf = (code, message) => ({ stop: true, code, message: message.includes(NOTHING) ? message : `${message} ${NOTHING}` });
export function resolveRun(config, { flag, flagSource = '--claude-route', env = {}, choose = r => `--claude-route ${r}`, recorded, dry = false } = {}) {
  const fromFlag = flag !== undefined && flag !== null;
  const read = readClaudeRouteSetting(fromFlag ? flag : env?.[CLAUDE_ROUTE_ENV], fromFlag ? flagSource : CLAUDE_ROUTE_ENV);
  if (!read.ok) return stopOf(read.code, read.message);
  const unrouted = resolveChainSeats(config);      // the chain as it runs today: what a stage's cache fingerprint is made of, so a route change never makes finished stages stale (the run replays them at no cost)
  // A session run is moved only by a route typed for THIS invocation (the flag or the MCP argument; `auto` is no choice): a shell variable left in the environment does not move it, so a bare resume (submit_stage's last answer included) can never start billing by itself.
  const movedAway = fromFlag && read.setting !== 'auto' && read.setting !== 'session';
  if (read.setting === 'session' || (recorded?.route === 'session' && !movedAway)) {      // 1b: before the key facts: a session run needs no key, and a recorded session run is never moved by a key it does not have
    const applied = applySessionRoute(config);
    if (applied.unmapped.length > 0) {
      const named = [...new Set(applied.unmapped.map(u => `${u.slot} ("${u.model}")`))].join(', ');
      return stopOf('session_model_unmapped', `The session route cannot name a Claude Code session for the Claude seat${applied.unmapped.length === 1 ? '' : 's'} ${named}: only models called claude-opus, claude-sonnet, claude-haiku or claude-fable with a version are known. Choose another route.`);      // A-DRAFT (wording row SSW-w2)
    }
    if (applied.converted.length === 0) return { config: unrouted, route: 'anthropic', why: 'no_claude_seat', routed: [], unrouted };      // nothing to convert: the chain runs as it is, as a chain with no Claude seat does on the other route
    const resolved = resolveChainSeats(applied.config);
    return { config: resolved, route: 'session', why: read.setting === 'session' ? 'chosen' : 'recorded', routed: applied.converted, unrouted, stillBilling: stillBillingOf(resolved) };
  }
  if (applyClaudeRoute(config, 'openrouter').routed.length === 0) return { config: unrouted, route: 'anthropic', why: 'no_claude_seat', routed: [], unrouted };
  const decision = claudeRouteOf({ setting: read.setting, ...claudeRouteFacts(env), wayOut: choose('openrouter') });
  // A DRY RUN calls nothing and needs no key (the dry run's contract): a key state that would stop a start does not stop it, and it says nothing about the key. It is priced on the route the start takes once the key is mended: a malformed ANTHROPIC key with auto means the direct route (the key is mended to a usable Anthropic key; why 'key_state' tells the entry points to name it); a malformed OPENROUTER key with no Anthropic key means OpenRouter (the only key the person has), priced and said as that route is, so the figure is never the direct one for a start that would go through OpenRouter. A value that is not a route still refuses a dry run.
  // The chain priced on one route, for a dry run that no key state or changed key choice may stop.
  const pricedOn = (route, why) => {
    if (route === 'anthropic') return { config: unrouted, route, why, routed: [], unrouted };
    const applied = applyClaudeRoute(config, 'openrouter');
    return { config: resolveChainSeats(applied.config), route, why, routed: applied.routed, unrouted };
  };
  if (decision.stop && dry && KEY_STOPS.has(decision.code)) {
    // an existing run (a resume, rematch, replay or price raise) keeps the route it began with, whatever the keys say now (the same rule as below), so its price is made on that route
    if (recorded) return { ...pricedOn(recorded.route, 'recorded'), stopNote: stopOf(decision.code, decision.message).message };      // the price is shown, and so is the stop the real resume meets (a dry run never shows a price for a resume the real verb refuses without saying so)
    return decision.code === 'anthropic_key_malformed' ? pricedOn('anthropic', 'key_state') : pricedOn('openrouter', 'no_anthropic_key');
  }
  if (decision.stop) return stopOf(decision.code, decision.message);
  if (recorded && decision.why !== 'chosen' && decision.route !== recorded.route) {
    const keep = recorded.route;
    return stopOf('route_changed', `This run was started with its Claude seats ${keep === 'openrouter' ? 'through OpenRouter' : 'straight to Anthropic'}, and the keys you have now would send them ${decision.route === 'openrouter' ? 'through OpenRouter' : 'straight to Anthropic'} instead. To keep the route the run began with, choose it with ${choose(keep)}; to change it, choose ${choose(decision.route)}.`);
  }
  const applied = applyClaudeRoute(config, decision.route);
  return { config: resolveChainSeats(applied.config), route: decision.route, why: decision.why, routed: applied.routed, unrouted };
}
