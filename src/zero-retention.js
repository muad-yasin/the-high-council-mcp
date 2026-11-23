// 0.8.4 the optional "zero-retention only" setting (his answer 11 of 10 Nov 2026: (b), a setting a person switches on; with it on the start refuses before anything is paid and names the seats that have no zero-retention host).
// This module is the decision: which seats of a roster the setting cannot serve, from the dated table src/zdr-hosts.json (scripts/refresh-zdr-table.mjs writes it from OpenRouter's own list). It is THC's own check: what OpenRouter does when a request
// carries provider.zdr = true and no such host serves the model is NOT STATED in its docs, so nothing here claims OpenRouter refuses the call. The request side (provider.zdr at the call) is src/price-pin.js; the run-level switch is chain.js setZeroRetention.
// Contract (pure except the one table read at import):
//   ZERO_RETENTION_ENV               'COUNCIL_ZERO_RETENTION' (operator-only, like COUNCIL_CLAUDE_ROUTE).
//   readZeroRetentionSetting(value, source) -> { ok: true, setting: 'on' | 'off' | null } | { ok: false, message }: nothing or blank is "not typed" (null); `on` and `off` (any case); anything else is refused naming where it came from.
//   zeroRetentionStops(seats, { table }) -> { stops: [{ model, why, count, pin? }], covered, notCovered }: `seats` is the roster AS IT IS SENT (after the route: a Claude seat that goes through OpenRouter is an OpenRouter seat here). covered = the OpenRouter seats
//     (the setting reaches them); notCovered = the seats called straight to a lab (mock, external and ollama seats are neither: nothing is sent to a hosted lab). A stop is an OpenRouter seat the setting cannot serve, one per model (and pin), with the number of seats:
//     why 'not_listed' (the model is not in the table: OpenRouter's list has no endpoint for it), 'none_used' (it is in the table but none of its hosts is one this setting uses), 'own_only' (the seat's own provider.only names none of the hosts the setting uses),
//     'none_under_pin' (every host the setting uses charges more than the seat's price limit, `pin`, USD per million tokens: named at the start, so no call is refused mid-run). Each reason is true whichever way it is reached.
//   zdrAllowedHosts(model, { table, own }) -> the endpoint slugs a call may be sent to when the setting is on (the `only` list of the request), [] when none; `own` is the seat's own provider.only: when it has one, only the hosts it names (a slug or a prefix of one) stay.
import { readFileSync, existsSync } from 'node:fs';
import { basePinOf } from './price-pin.js';
import { narrowTable, tableShapeProblem } from './zdr-table.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ZDR_TABLE = JSON.parse(readFileSync(join(here, 'zdr-hosts.json'), 'utf8'));
export const ZERO_RETENTION_ENV = 'COUNCIL_ZERO_RETENTION';
export const ZDR_USER_FILE = 'zdr-hosts.user.json';      // the refreshed list a person made with `council refresh-zdr-list`, in the project folder (narrow-only: it can never add a host the shipped table lacks)
export const ZDR_LIST_URL = 'https://openrouter.ai/api/v1/endpoints/zdr';

/**
 * The list a run is held to: the shipped table, or the refreshed list of the project folder when its date is newer than the shipped one, AND never wider than the shipped one (the file is a project-writable file: it is read through narrowTable again, so a hand-edited
 * file cannot add a host). -> { table, source: 'shipped' | 'refreshed', future: date | null, problem: sentence | null }. A refreshed list dated after `today` is not used and is reported in `future` (the start refuses and says so: a forged date is detected, not
 * prevented); an unreadable or misshapen file is not used and is reported in `problem`; a refreshed list that is not newer than the shipped one is not used (a newer program carries its own).
 */
export function zdrTableFor(work, { today = new Date().toISOString().slice(0, 10), shipped = ZDR_TABLE } = {}) {
  const shippedOnly = (extra = {}) => ({ table: shipped, source: 'shipped', future: null, problem: null, ...extra });
  if (!work) return shippedOnly();
  const path = join(work, ZDR_USER_FILE);
  if (!existsSync(path)) return shippedOnly();
  let user;
  try { user = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return shippedOnly({ problem: `${ZDR_USER_FILE} could not be read (${e?.code || e?.message || 'unreadable'}), so the list this program shipped with is used` }); }
  const bad = tableShapeProblem(user);
  if (bad) return shippedOnly({ problem: `${ZDR_USER_FILE} is not a list this program can read (${bad}), so the list this program shipped with is used` });
  if (user.asOf > today) return shippedOnly({ future: user.asOf });
  if (user.asOf <= shipped.asOf) return shippedOnly();
  return { table: narrowTable(shipped, user), source: 'refreshed', future: null, problem: null };
}

const shown = v => JSON.stringify(String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 40));

export function readZeroRetentionSetting(value, source = ZERO_RETENTION_ENV) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return { ok: true, setting: null };
  const v = typeof value === 'string' ? value.trim().toLowerCase() : value === true ? 'on' : value === false ? 'off' : null;
  if (v === 'on' || v === 'off') return { ok: true, setting: v };
  return { ok: false, message: `${source}: ${shown(value)} is not a zero-retention setting. Use on or off.` };
}

const NOT_HOSTED = new Set(['mock', 'external', 'ollama']);

/** The table row of a model: its id as the seat names it, else the id before a `:variant` suffix; null when the table has none. */
export const zdrRowOf = (model, table = ZDR_TABLE) => (typeof model === 'string' ? (table.models[model] ?? table.models[model.split(':')[0]] ?? null) : null);

const hostsOf = row => (row && row.hosts && typeof row.hosts === 'object' ? Object.entries(row.hosts) : []);
const underPin = (host, pin) => !pin || (host.in !== null && host.out !== null && host.in <= pin.prompt + 1e-9 && host.out <= pin.completion + 1e-9);
const named = (tag, own) => own.some(e => typeof e === 'string' && (tag === e || tag.startsWith(e + '/')));

export function zdrAllowedHosts(model, { table = ZDR_TABLE, own } = {}) {
  const tags = hostsOf(zdrRowOf(model, table)).map(([tag]) => tag);
  return Array.isArray(own) ? tags.filter(t => named(t, own)) : tags;
}

export function zeroRetentionStops(seats, { table = ZDR_TABLE } = {}) {
  const stops = new Map(); let covered = 0, notCovered = 0;
  for (const seat of seats ?? []) {
    if (!seat || typeof seat !== 'object' || typeof seat.provider !== 'string') continue;
    if (seat.provider === 'openrouter') {
      covered += 1;
      const row = zdrRowOf(seat.model, table), own = seat.extra?.provider?.only, all = hostsOf(row);
      const hosts = all.filter(([tag]) => !Array.isArray(own) || named(tag, own));
      // the hosts the seat's own provider.ignore bans are not hosts this call can use (the request subtracts them: src/price-pin.js withZdr); the counts below agree with it (0.8.4 release chores, the MiMo/PrimaLabs ban)
      const ign = Array.isArray(seat.extra?.provider?.ignore) ? seat.extra.provider.ignore.filter(g => typeof g === 'string') : [];
      const left = hosts.filter(([tag]) => !ign.some(g => tag === g || tag.startsWith(g + '/')));
      let why = null, pin = null;
      if (!row) why = 'not_listed';
      else if (all.length === 0) why = 'none_used';
      else if (hosts.length === 0) why = 'own_only';
      else if (left.length === 0) why = null;   // every host the setting would use is banned by the seat's own ignore: none of the reasons above says that (a ROADMAP line), so no stop is named here; the call itself says it (ZeroRetentionNoHost, src/price-pin.js)
      else { pin = basePinOf(seat); if (!left.some(([, h]) => underPin(h, pin))) why = 'none_under_pin'; }
      if (why === null) continue;
      const key = seat.model + '|' + why + '|' + (why === 'none_under_pin' ? pin.prompt + '/' + pin.completion : '');
      const hit = stops.get(key) ?? { model: seat.model, why, count: 0, ...(why === 'none_under_pin' ? { pin } : {}) };
      hit.count += 1; stops.set(key, hit);
    } else if (!NOT_HOSTED.has(seat.provider)) notCovered += 1;
  }
  return { stops: [...stops.values()], covered, notCovered };
}

export const ZDR_STALE_DAYS = 45;      // a dated table expires on purpose (like src/pricing.json's OpenRouter rows): past this age the setting refuses to start until the table is refreshed, because "no host on the table's date" would be a claim about a day long gone

const cut = text => (text.length > 400 ? `${text.slice(0, 397)}...` : text);
const seatsWord = n => `${n} seat${n === 1 ? '' : 's'}`;

/**
 * The run's zero-retention decision, in one place (every entry point calls it after the route is decided, with the roster as it is SENT).
 * `flag` is the typed value (the command line flag, the MCP argument or the library option), `flagSource` names it in a sentence; with none, `env[COUNCIL_ZERO_RETENTION]` (a project .env never sets it: src/env-file.js); with none, `recorded`
 * (true when the run's run.json says it began with the setting on) keeps it; with none it is off. So a typed on or off is the person's own (a recorded value is never obeyed over it) and a file can only keep the setting on, never turn a typed on off.
 * `offWay` names how THIS entry point switches it off in a sentence ("--zero-retention off", "COUNCIL_ZERO_RETENTION=off", the MCP argument), `now` is the clock for the table's age (a test passes it).
 * -> { stop: true, code: 'unknown_value', message } for a value that is not on or off (a dry run is refused too);
 *    { on, changed, covered, notCovered, stops, refusal } otherwise: `changed` is true when a typed value differs from the recorded one (the entry point records it at its flush); `refusal` is null, or the sentence a START stops with (exit 5, a result of the seats)
 *    when the setting is on and a seat has no zero-retention host in the table, or the table is older than ZDR_STALE_DAYS; a dry run prints it as a line and goes on. A-DRAFT (wording rows ZR-w2 to ZR-w4).
 */
export function resolveZeroRetention(seats, { flag, flagSource = '--zero-retention', env = {}, recorded = false, offWay = '--zero-retention off', table = ZDR_TABLE, future = null, now = Date.now() } = {}) {
  const fromFlag = flag !== undefined && flag !== null;
  const read = readZeroRetentionSetting(fromFlag ? flag : env?.[ZERO_RETENTION_ENV], fromFlag ? flagSource : ZERO_RETENTION_ENV);
  if (!read.ok) return { stop: true, code: 'unknown_value', message: `${read.message} Nothing was started and nothing was spent.` };
  const on = read.setting === null ? recorded === true : read.setting === 'on';
  const changed = read.setting !== null && (read.setting === 'on') !== (recorded === true);
  const { stops, covered, notCovered } = zeroRetentionStops(seats, { table });
  let refusal = null;
  if (on) {
    const age = Math.floor((now - Date.parse(`${table.asOf}T00:00:00Z`)) / 86_400_000);
    if (future) {
      refusal = `Zero retention is on, but the refreshed list of zero-retention hosts in ${ZDR_USER_FILE} is dated ${future}, which is after today, so it is not used. Nothing was started and nothing was spent. Run council refresh-zdr-list to replace it, or switch zero retention off with ${offWay}.`;
    } else if (!(age <= ZDR_STALE_DAYS)) {
      refusal = `Zero retention is on, but the list of zero-retention hosts this program holds is from ${table.asOf} and is older than ${ZDR_STALE_DAYS} days, so it cannot say which seats a host serves. Nothing was started and nothing was spent. To refresh it, run: council refresh-zdr-list. To run anyway, switch it off with ${offWay}.`;
    } else if (stops.length) {
      const clause = s => ({ not_listed: ', not on that list', none_used: ', none of its hosts on that list is one this setting uses', own_only: ', none of the hosts its own provider.only names is one this setting uses', none_under_pin: ', none at or under its price limit of $' + (s.pin?.prompt) + ' and $' + (s.pin?.completion) + ' per million tokens' })[s.why];
      const list = cut(stops.map(s => `${s.model} (${seatsWord(s.count)}${clause(s)})`).join(', '));
      const claude = stops.some(s => s.model.startsWith('anthropic/'));
      refusal = `Zero retention is on, but this program has no host it may send ${list} to (OpenRouter's list of ${table.asOf}). Nothing was started and nothing was spent. To run anyway, switch it off with ${offWay}${claude ? ', or send the Claude seats straight to Anthropic with --claude-route anthropic (that needs ANTHROPIC_API_KEY, and seats called straight to a lab are not covered by this setting)' : ''}.`;
    }
  }
  return { on, changed, covered, notCovered, stops, refusal };
}

/** The line a start screen and a dry run print when the setting is on: how many seats the setting reaches (each call names only the hosts OpenRouter's own list, as of `asOf`, gives for the model as zero-retention hosts) and how many it does not. No claim of THC's own about what a host does with a prompt. A-DRAFT (wording row ZR-w5). [] when it is off. */
export function zeroRetentionLines({ on, covered, notCovered, asOf, source } = {}) {
  if (on !== true) return [];
  const direct = notCovered > 0 ? ` ${seatsWord(notCovered)} ${notCovered === 1 ? 'is' : 'are'} called straight to the lab, and this setting does not reach ${notCovered === 1 ? 'it' : 'them'}.` : '';
  return [`Zero retention is on: ${seatsWord(covered)} go${covered === 1 ? 'es' : ''} through OpenRouter, and each call names only the hosts that OpenRouter's list of ${asOf ?? ZDR_TABLE.asOf}${source === 'refreshed' ? ' (refreshed in this folder)' : ''} gives for its model as zero-retention hosts.${direct} What a request cannot rule out is ruled out by the setting "zero-data-retention only" in your OpenRouter privacy settings.`];
}

/**
 * Trees: a tree that began with the setting on keeps it (tree.json `zeroRetention: true`, written at `tree start`): every run the tree starts later, at a `tree resume`, gets the setting as its own typed option, so a shell that no longer has the variable does not
 * switch it off. The environment of THIS command wins when it says on or off (the person's own channel; a tree takes no flag). -> 'on' | 'off' | undefined (nothing to pass).
 */
export function treeZeroRetentionOption(tree, env = {}) {
  const read = readZeroRetentionSetting(env?.[ZERO_RETENTION_ENV]);
  if (!read.ok) return undefined;      // a value that is not on or off passes nothing: the run's own start reads the variable and refuses it, as for any run (exit 2)
  if (read.setting !== null) return read.setting;
  return tree?.zeroRetention === true ? 'on' : undefined;
}
