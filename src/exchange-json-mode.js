// JSON mode for the layer exchange (084/glm-format; A-DRAFT, every sentence a person reads here is A-DRAFT until the owner approves it).
// Opt-in chain switch `exchange_json_mode: { enabled: true, labs: ['<seat lab>', ...] }`. With it on, the two layer-exchange calls (the post, label ldebate-*, and the answer, label lreply-*)
// of a seat whose lab is listed carry `response_format: { type: "json_object" }`. No other call carries it: not a panel verdict (a panel reply may hold notes outside the JSON), not a revise,
// not a criteria or handoff call. A seat that calls Anthropic (provider anthropic, or rerouted from it) never carries it: that adapter spreads `extra` into its request and Anthropic does not take the field.
// With the switch off (absent, or enabled false) nothing in this file changes any byte a seat is sent.
//
// What OpenRouter does when a host does not list the field (its provider-selection page, read 2 Nov 2026 through a summarising fetch): by default (require_parameters false) a host "can still receive the
// request, but will ignore unknown parameters"; response_format is also a soft routing preference (hosts that list it first when some do, the parameter ignored when none does). This switch sends
// no `require_parameters` (owner's side ruling, C&C 2 Nov 2026): a request no host accepts would be a silent zero-call failure in a paid run. Whether the field applied to a call is read from the
// serving host the call record already carries.
import { labOf } from './stage-system.js';
import { keepSeatKey } from './seat-key.js';
import { held } from './held-roles.js';
import { exchangeJudgeCount } from './layer-debate.js';

export const JSON_MODE_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

const labsOf = config => (Array.isArray(config?.exchange_json_mode?.labs) ? config.exchange_json_mode.labs.filter(l => typeof l === 'string' && l.trim()) : []);

/** The switch, read once per run: null (off, or no lab listed) or the Set of listed seat labs. */
export function exchangeJsonModeLabs(config) {
  if (config?.exchange_json_mode?.enabled !== true) return null;
  const labs = labsOf(config);
  return labs.length ? new Set(labs) : null;
}

/** A seat that really calls Anthropic: provider anthropic, or rerouted by single-vendor mode from it (originalProvider). Checked on the provider that RECEIVES the call and on the one it was rerouted from. */
export const callsAnthropic = seat => seat?.provider === 'anthropic' || seat?.originalProvider === 'anthropic';

/** The seat a layer-exchange call is made with: the seat itself, or a copy whose `extra` carries the JSON mode. The seat's own `response_format`, if it has one, is never replaced. */
export function jsonModeSeat(seat, labs) {
  if (!labs || !seat || callsAnthropic(seat) || seat.provider === 'external' || !labs.has(labOf(seat))) return seat;
  if (seat.extra && typeof seat.extra === 'object' && 'response_format' in seat.extra) return seat;
  return keepSeatKey(seat, { ...seat, extra: { ...(seat.extra || {}), response_format: { ...JSON_MODE_RESPONSE_FORMAT } } });   // the copy keeps the seat's key (a twin's exchange record must name its own seat)
}

/**
 * The closing sentence of the exchange user messages (held until the owner's yes: held-roles.js returns nothing while src/roles.js has no export of that name), as the text appended to a message: a blank line and
 * the sentence, or nothing. It goes at the very END of the message, after the handler's rulings text, so the cached head (the start of the message, checked in invoke()) is never touched.
 */
export function exchangeClosingText() {
  const f = held('layerExchangeClosing');
  return f ? `\n\n${f()}` : '';
}

/**
 * Chain lint. A switch that would do nothing, or that names a seat it must never touch, is refused (the same pattern as prompt_cache): (1) enabled with no lab listed; (2) a listed lab that matches no seat;
 * (3) a listed lab that is a seat calling Anthropic directly; (4) the switch on a chain with no layer exchange (not layered, not unanimous, or fewer than two judges on the lowest layer), where no call would carry it.
 */
export function lintExchangeJsonMode(config, filePath = 'the chain file') {
  const findings = [];
  const sw = config?.exchange_json_mode;
  if (!sw || sw.enabled !== true) return findings;
  const seats = [...Object.values(config?.seats ?? {}).flatMap(s => (Array.isArray(s) ? s : [s]))].filter(s => s && typeof s === 'object' && typeof s.model === 'string');
  const labs = labsOf(config);
  if (!labs.length) findings.push({ kind: 'exchange-json-mode-no-labs', message: `exchange_json_mode.enabled is true in ${filePath} but "labs" lists no seat lab, so the switch would do nothing. List the lab of each seat whose exchange calls should ask for JSON.`, fix: `List the labs in "exchange_json_mode.labs" of ${filePath}, or set "exchange_json_mode.enabled" to false.` });
  for (const lab of labs) {
    const named = seats.filter(s => labOf(s) === lab);
    if (!named.length) findings.push({ kind: 'exchange-json-mode-unknown-lab', message: `exchange_json_mode.labs lists "${lab}" in ${filePath}, but no seat of the chain has that lab, so it would do nothing.`, fix: `Correct the lab in "exchange_json_mode.labs" of ${filePath} to the lab of a seat (its "lab", or its "provider" where it has no "lab"), or remove it.` });
    else if (named.every(callsAnthropic)) findings.push({ kind: 'exchange-json-mode-anthropic-lab', message: `exchange_json_mode.labs lists "${lab}" in ${filePath}, but every seat of that lab is an Anthropic seat (one that calls Anthropic, or one rerouted from it). JSON mode is never sent to an Anthropic seat; remove that lab from the list.`, fix: `Remove "${lab}" from "exchange_json_mode.labs" of ${filePath}.` });
  }
  if (labs.length && sw.enabled === true && exchangeJudgeCount(config) < 2) findings.push({ kind: 'exchange-json-mode-needs-exchange', message: `exchange_json_mode.enabled is true in ${filePath} but this chain never runs a layer exchange (it needs "signoff": "unanimous" with a layer on every critic and at least two judges on the lowest layer), so no layer-exchange call is made and the switch would do nothing.`, fix: `Give the chain layers, "signoff": "unanimous" and two judges on the lowest layer in ${filePath}, or set "exchange_json_mode.enabled" to false.` });
  return findings;
}
