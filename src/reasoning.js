// Reasoning is always "high" (0.8.1 milestone R; owner, 4-5 Oct 2026: "I want reasoning to always be 'High' for the 'High'
// Council"; "NO LOWER EFFORT!!!!"). This module is the one place that knows what "high" is on each wire, which settings LOWER
// reasoning, and how big a reply each model may be retried at. Everything is read from src/reasoning-table.json, a dated table
// (scripts/refresh-reasoning-table.mjs writes it; no runtime call to any model list).
//
// Contract:
//   loweringReasons(extra, seat?)  -> [{ path, value, why }]  every setting in a seat's `extra` that runs it below high
//   highExtraFor(seat, cap)        -> { extra, key } | null   what the harness adds so an unset seat reasons at high (cap: the
//                                                              seat's effective output cap, the caller's default when it sets none)
//   extraWithHighDefault(seat, cap)-> the `extra` to send     the seat's own, plus the high default where it is unset
//   retryCeilingOf(seat)           -> tokens                  the largest reply the seat may be retried at
//   haikuBudgetFor(maxTokens)      -> tokens                  the thinking budget of an Anthropic seat that has no effort levels
// Nothing here ever writes a lower setting. A seat's OWN explicit setting (even a lowering one) is never overwritten: a user
// who wrote it meant it, and the shipped chains are held to "high" by the chain-lint rule `reasoning-not-high`, not by rewriting.
import { readFileSync } from 'node:fs';
import { NOT_ON_ROUTER_PREFIX, notOnRouterReason } from './table-reasons.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REASONING_TABLE = JSON.parse(readFileSync(join(here, 'reasoning-table.json'), 'utf8'));

// The file's own `asOf` is a date, not a clock: the test compares it to the real date.
export function tableAgeDays(now = Date.now()) {
  return Math.floor((now - Date.parse(`${REASONING_TABLE.asOf}T00:00:00Z`)) / 86_400_000);
}

// The effort values that are "high or above". Anything else, set explicitly, is a lowering (a smaller effort or none at all).
const HIGH_OR_ABOVE = new Set(['high', 'xhigh', 'max']);
const LOW_WORDS = new Set(['none', 'minimal', 'low', 'medium']);
// The order of the effort words, lowest first (the table's defaultEffort and supportedEfforts use these words). One place: the above-high-default check reads it.
const EFFORT_RANK = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 };

// An INTEGER effort (a model whose engine takes 1-100, e.g. DeepSeek V4.1 Flash on its chat template) is "high or above" only when the model's table row says from which number: `highAtLeast`. A row without it has no such number, so every integer on it stays a lowering (fails closed).
export const isHighInteger = (value, row) => Number.isInteger(value) && value <= 100 && Number.isFinite(row?.highAtLeast) && value >= row.highAtLeast;

// A seat's wire identity: the provider the request really goes to and the model id that provider is asked for. Under single-vendor
// mode (src/providers.js resolveVendorSeat) `provider` is already the vendor and `model` its own id, so one lookup serves both.
export const keyOf = seat => `${seat.provider}/${seat.model}`;
export const rowOf = seat => REASONING_TABLE.models[keyOf(seat)] ?? null;

// The two kinds of `unlisted` entry (deliberate / auto) and the auto entries' wording: src/table-reasons.js (a module that reads no file; the regenerator uses it too).
export { NOT_ON_ROUTER_PREFIX, notOnRouterReason };

/**
 * The table's reason for leaving a model out of `models`: its `unlisted` section. The exact key `<provider>/<model>`, or an entry ending in "/*" read as a prefix (`ollama/*`).
 * Null when the table gives no reason. No provider is named here: the table is the list. `deliberateOnly` skips the auto entries (see NOT_ON_ROUTER_PREFIX).
 * (Two other readers look this section up their own way: test/reasoning-table.test.js handles only `ollama/`, scripts/model-caps-report.mjs also tries the key without its provider.)
 */
export function unlistedReasonOf(seat, { deliberateOnly = false } = {}) {
  const key = keyOf(seat);
  const unlisted = REASONING_TABLE.unlisted && typeof REASONING_TABLE.unlisted === 'object' ? REASONING_TABLE.unlisted : {};
  const usable = why => typeof why === 'string' && !(deliberateOnly && why.startsWith(NOT_ON_ROUTER_PREFIX));
  if (usable(unlisted[key])) return unlisted[key];
  for (const [entry, why] of Object.entries(unlisted)) if (entry.endsWith('/*') && key.startsWith(entry.slice(0, -1)) && usable(why)) return why;
  return null;
}

// Thinking budget for a seat on a model with no effort levels (Haiku 4.5): half the seat's cap, at least 1,024 (Anthropic's
// minimum), and always below the cap. The caller must give the seat a cap of at least 2,048.
export const HAIKU_MIN_BUDGET = 1024;
export const haikuBudgetFor = maxTokens => Math.max(HAIKU_MIN_BUDGET, Math.floor(maxTokens / 2));

// ONE table of every spelling of a reasoning EFFORT WORD (a level named by a word). loweringReasons reads it to report a word below high (and, on a model whose own default is above high, a high that
// is below that default); statesHighEffort reads it to see that a seat states a level of high or above. A spelling added here is read by both (0.8.3, C&C ruling 23 Oct 2026: unify the two lists;
// test/reasoning-unknown-model.test.js UM-9 names every path of this table). `holder` finds the object that carries the key; `defaultCheck` marks the spellings the "below the model's own default" rule reads.
const thinkingConfigOf = e => e.thinking_config ?? e.thinkingConfig ?? e.google?.thinking_config ?? e.google?.thinkingConfig;
export const EFFORT_WORD_SPELLINGS = Object.freeze([
  Object.freeze({ path: 'output_config.effort', holder: e => e.output_config, key: 'effort', below: 'an Anthropic effort below high', defaultCheck: true }),
  Object.freeze({ path: 'reasoning.effort', holder: e => e.reasoning, key: 'effort', below: v => (LOW_WORDS.has(v) ? 'an effort below high' : 'an effort the harness does not know'), defaultCheck: true }),
  Object.freeze({ path: 'reasoning_effort', holder: e => e, key: 'reasoning_effort', below: 'an effort below high', defaultCheck: true }),
  Object.freeze({ path: 'chat_template_kwargs.reasoning_effort', holder: e => e.chat_template_kwargs, key: 'reasoning_effort', below: 'an effort below high', integerOk: true, defaultCheck: true }),
  Object.freeze({ path: 'thinking_config.thinking_level', holder: thinkingConfigOf, key: 'thinking_level', below: 'a thinking level below high' }),
  Object.freeze({ path: 'thinking_config.thinkingLevel', holder: thinkingConfigOf, key: 'thinkingLevel', below: 'a thinking level below high' }),
  Object.freeze({ path: 'thinking_level', holder: e => e, key: 'thinking_level', below: 'a thinking level below high' }),
]);
/** The effort-word fields present in ONE layer of `extra` (not its extra_body): [{ ...spelling, value }]. */
const effortWordsIn = e => EFFORT_WORD_SPELLINGS.flatMap(sp => { const h = sp.holder(e); return h && typeof h === 'object' && sp.key in h ? [{ ...sp, value: h[sp.key] }] : []; });

/**
 * Every setting in `extra` that runs a seat below "high". The ONE list: the chain-lint rule, the never-lower test and the source
 * scan all read it, so a new spelling is added here once. `seat` (optional) lets a thinking budget be compared with the seat's cap.
 */
export function loweringReasons(extra, seat = null) {
  const out = [];
  const add = (path, value, why) => out.push({ path, value, why });
  const e = extra && typeof extra === 'object' ? extra : {};
  const th = e.thinking;
  if (th && typeof th === 'object') {
    if (th.type === 'disabled') add('thinking.type', th.type, 'thinking switched off');
    if (th.type === 'between_tools') add('thinking.type', th.type, 'the lowest thinking setting (no up-front thinking)');
    if (th.type === 'enabled' && typeof th.budget_tokens === 'number') {
      const cap = seat?.maxTokens;
      if (th.budget_tokens < HAIKU_MIN_BUDGET) add('thinking.budget_tokens', th.budget_tokens, `a thinking budget under Anthropic's minimum of ${HAIKU_MIN_BUDGET}`);
      else if (typeof cap === 'number' && th.budget_tokens < haikuBudgetFor(cap)) add('thinking.budget_tokens', th.budget_tokens, `a thinking budget under half the seat's cap (${haikuBudgetFor(cap)})`);
    }
  }
  // every effort WORD below high, in any spelling (EFFORT_WORD_SPELLINGS, the one table)
  for (const w of effortWordsIn(e)) {
    if (HIGH_OR_ABOVE.has(w.value)) continue;
    if (w.integerOk && isHighInteger(w.value, seat ? rowOf(seat) : null)) continue;
    add(w.path, w.value, typeof w.below === 'function' ? w.below(w.value) : w.below);
  }
  const r = e.reasoning;
  if (r && typeof r === 'object') {
    if (r.enabled === false) add('reasoning.enabled', false, 'reasoning switched off');
    if (r.exclude === true) add('reasoning.exclude', true, 'reasoning hidden from the reply (a different thing from lower effort, refused so a shipped seat never hides it)');
    if ('max_tokens' in r) add('reasoning.max_tokens', r.max_tokens, 'a reasoning token cap below the model default');
  }
  if (e.enable_thinking === false) add('enable_thinking', false, 'thinking switched off');
  if (e.chat_template_kwargs && e.chat_template_kwargs.enable_thinking === false) add('chat_template_kwargs.enable_thinking', false, 'thinking switched off');
  if (e.chat_template_kwargs && e.chat_template_kwargs.thinking === false) add('chat_template_kwargs.thinking', false, 'thinking switched off (the DeepSeek V4 chat-template switch)');
  const tc = thinkingConfigOf(e);
  if (tc && typeof tc === 'object') {
    for (const k of ['thinking_budget', 'thinkingBudget']) if (k in tc) add(`thinking_config.${k}`, tc[k], 'a fixed thinking budget');
  }
  // Audit A2-5 (0.8.1): spellings the first list missed. `extra_body` is how Google's own REST examples carry the same fields; `include_reasoning: false` is OpenRouter's
  // spelling of `reasoning.exclude`; the thinking level/budget also exist at the top level.
  if (e.include_reasoning === false) add('include_reasoning', false, 'reasoning hidden from the reply (OpenRouter\'s spelling of reasoning.exclude)');
  if ('thinking_budget' in e) add('thinking_budget', e.thinking_budget, 'a fixed thinking budget');
  // 0.8.2 (owner, 7 Oct 2026, "Yes" to the never-lower check): on a model whose own default is ABOVE high (the table's defaultAboveHigh), an explicit
  // "high" is a lowering too. Only the words the checks above let through are read here (a word below high is already reported once).
  const row = seat ? rowOf(seat) : null;
  const defaultRank = row?.defaultAboveHigh ? EFFORT_RANK[row.defaultEffort] : undefined;
  if (defaultRank !== undefined) {
    for (const w of effortWordsIn(e)) {
      if (w.defaultCheck && HIGH_OR_ABOVE.has(w.value) && EFFORT_RANK[w.value] < defaultRank) add(w.path, w.value, `an effort below the model's own default (${row.defaultEffort})`);
    }
  }
  if (e.extra_body && typeof e.extra_body === 'object' && !Array.isArray(e.extra_body)) {
    for (const r of loweringReasons(e.extra_body, seat)) add(`extra_body.${r.path}`, r.value, r.why);
  }
  return out;
}

// Audit A2-3 (0.8.1): a seat that carries ANY reasoning-looking field, in any spelling and at any depth, has said its own thing about reasoning: the harness adds no
// default beside it (Google rejects `reasoning_effort` next to `thinking_config`). One detector; the structural guard test reads the same words.
export const REASONING_WORDS = /think|reason|effort|budget/i;
// Subtrees that carry the caller's own data, not a reasoning control (a structured-output schema with a property called "reasoning", metadata with a "budget_code"): not read.
const USER_DATA_KEYS = new Set(['response_format', 'metadata', 'provider', 'tools', 'tool_choice', 'plugins', 'messages', 'stop', 'logit_bias', 'transforms', 'user', 'prediction']);
export function reasoningFieldPaths(extra, prefix = '', out = []) {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra)) {
      if (USER_DATA_KEYS.has(k)) continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) reasoningFieldPaths(v, p, out);
      else if (REASONING_WORDS.test(p)) out.push(p);
    }
  }
  return out;
}
export const carriesReasoningField = extra => reasoningFieldPaths(extra).length > 0;
// Objects merge key by key, so a default beside an unrelated sibling (output_config.format) does not replace it.
const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
  return out;
};

/**
 * What the harness adds so a seat with no reasoning setting reasons at high; null when it adds nothing: the model has no row or no
 * documented field, the model's own default is already above high (sending "high" would be a LOWER effort), or the seat already
 * said something about reasoning in the form's own fields. Anthropic seats with no effort levels (Haiku) get a thinking budget.
 */
export function highExtraFor(seat, cap = seat.maxTokens) {
  const row = rowOf(seat);
  if (!row || !row.form || row.defaultAboveHigh) return null;
  if (seat.keepOwnReasoning) return null; // a vendor reroute that kept the seat's own native reasoning field (providers.js resolveVendorSeat)
  const form = REASONING_TABLE.forms[row.form];
  if (!form) return null;
  const own = seat.extra && typeof seat.extra === 'object' ? seat.extra : {};
  if (carriesReasoningField(own)) return null;
  if (row.form === 'anthropic-budget') {
    if (typeof cap !== 'number' || cap < 2 * HAIKU_MIN_BUDGET) return null; // no room for a budget below the cap: nothing sent
    return { key: keyOf(seat), extra: { thinking: { type: 'enabled', budget_tokens: haikuBudgetFor(cap) } } };
  }
  return { key: keyOf(seat), extra: structuredClone(form.extra) };
}

/** The `extra` a call sends: the seat's own, plus the high default where reasoning is unset. Never lowers anything. */
export function extraWithHighDefault(seat, cap = seat.maxTokens) {
  const add = highExtraFor(seat, cap);
  if (!add) return seat.extra;
  return deepMerge(seat.extra || {}, add.extra);
}

/**
 * The largest reply a seat is retried at: the model's own maximum, bounded by what its transport can return. With no row, the
 * ceiling the code has always used (`fallback`, 64,000), so a seat the table does not know behaves as in 0.8.0.
 */
export function retryCeilingOf(seat, fallback = 64_000) {
  const row = rowOf(seat);
  const transport = REASONING_TABLE.transportCeilings?.[seat.provider];
  const model = typeof row?.maxOutput === 'number' ? row.maxOutput : null;
  if (model === null && transport === undefined) return fallback;
  return Math.min(model ?? Infinity, transport ?? Infinity);
}

// True when `extra` itself STATES a level of high or above, in a field the harness knows (also under `extra_body`, as loweringReasons reads it), or an Anthropic thinking budget that
// meets the Haiku rule. A bare switch states no level: reasoning.enabled: true, enable_thinking: true and thinking.type "enabled" with no budget do not count (the router reads
// `enabled` alone as medium effort, openrouter.ai/docs/guides/best-practices/reasoning-tokens, read 23 Oct 2026).
function statesHighEffort(extra, cap) {
  const top = extra && typeof extra === 'object' ? extra : {};
  const layers = [top, ...(top.extra_body && typeof top.extra_body === 'object' && !Array.isArray(top.extra_body) ? [top.extra_body] : [])];
  // The effort-word spellings are EFFORT_WORD_SPELLINGS, the table loweringReasons reads too.
  return layers.some(e => effortWordsIn(e).some(w => HIGH_OR_ABOVE.has(w.value)) || hasHighForm('anthropic-budget', e, cap));
}

/**
 * The ONE list of what lets a seat on a model be left to the table: each way is a test and the sentence the chain-lint finding says for it, so the check and the fix text cannot
 * disagree (C&C ruling 23 Oct 2026). A seat needs one of them to pass `reasoning-not-high` when the table has no `models` row for it. "High" is this file's (HIGH_OR_ABOVE).
 */
export const TABLE_KNOWN_WAYS = Object.freeze([
  Object.freeze({ id: 'row', holds: seat => rowOf(seat) !== null, say: 'a row for it in src/reasoning-table.json (scripts/refresh-reasoning-table.mjs writes the rows of the OpenRouter ids a chain in chains/ seats, refreshes the rows it already has from OpenRouter\'s public list and never drops one, and keeps the other providers\' rows in its own DIRECT map)' }),
  Object.freeze({ id: 'unlisted', holds: seat => unlistedReasonOf(seat, { deliberateOnly: true }) !== null, say: 'a deliberate "unlisted" entry in that table, kept in the UNLISTED map of the same script, for a model that takes no reasoning setting' }),
  Object.freeze({ id: 'effort', holds: (seat, extra, cap) => statesHighEffort(extra, cap), say: 'an effort of its own at high or above in the seat\'s extra (a bare enabled: true does not count)' }),
]);

// True when `extra` carries the "high" setting this form writes (or a higher one, or a budget that meets the Haiku rule).
function hasHighForm(formName, extra, cap, row = null) {
  const e = extra && typeof extra === 'object' ? extra : {};
  switch (formName) {
    case 'anthropic-effort': return HIGH_OR_ABOVE.has(e.output_config?.effort);
    case 'anthropic-budget': return e.thinking?.type === 'enabled' && typeof e.thinking.budget_tokens === 'number' && e.thinking.budget_tokens >= (typeof cap === 'number' ? haikuBudgetFor(cap) : HAIKU_MIN_BUDGET) && (typeof cap !== 'number' || e.thinking.budget_tokens < cap);
    case 'openrouter-effort': return HIGH_OR_ABOVE.has(e.reasoning?.effort);
    case 'openai-reasoning-effort':
    case 'google-reasoning-effort': return HIGH_OR_ABOVE.has(e.reasoning_effort);
    case 'qwen-template-thinking': return e.chat_template_kwargs?.enable_thinking === true;
    case 'deepseek-template-thinking': return e.chat_template_kwargs?.thinking === true && HIGH_OR_ABOVE.has(e.chat_template_kwargs?.reasoning_effort);
    case 'deepseek-v41-template-thinking': return e.chat_template_kwargs?.thinking === true && (HIGH_OR_ABOVE.has(e.chat_template_kwargs?.reasoning_effort) || isHighInteger(e.chat_template_kwargs?.reasoning_effort, row));
    case 'zai-thinking': return e.thinking?.type === 'enabled';
    default: return false;
  }
}

/**
 * Why a seat, as it will be SENT (after any transport rewrite and the harness default), does not reason at high: its own lowering
 * settings, or no high setting where the table knows one. A model whose own default is above high has nothing to be missing. A model
 * the table knows NOTHING about (no `models` row, no `unlisted` reason) with no high effort stated in the seat's own extra fails
 * CLOSED (0.8.3, C&C ruling 23 Oct 2026): nothing then says it reasons at high. Empty array = fine. This is what the chain-lint rule
 * `reasoning-not-high` reports.
 */
export function reasoningProblems(seat, cap = seat.maxTokens) {
  const effective = extraWithHighDefault(seat, cap);
  const problems = loweringReasons(effective, { ...seat, maxTokens: cap });
  const row = rowOf(seat);
  if (!problems.length && row?.form && !row.defaultAboveHigh && !hasHighForm(row.form, effective, cap, row)) {
    problems.push({ path: row.form, value: null, why: `no "high" setting for ${keyOf(seat)} (the table's field for it is ${row.form}) and the seat's own extra blocks the default` });
  }
  if (!problems.length && !TABLE_KNOWN_WAYS.some(w => w.holds(seat, effective, cap))) {
    problems.push({ kind: 'table-unknown', path: 'src/reasoning-table.json', value: null, ways: TABLE_KNOWN_WAYS.map(w => w.say), why: `the reasoning table has no row and no deliberate unlisted reason for ${keyOf(seat)}, and the seat states no effort of its own at high or above, so nothing says it reasons at high` });
  }
  return problems;
}

/**
 * The cap a reply cut off at `cap` is retried at: double it, bounded by `ceiling` (the model's own maximum, bounded by its transport:
 * retryCeilingOf), but never BELOW the cap itself (2026-09-22: a seat given a 360k cap would otherwise have been "retried" at 64k, a
 * smaller one, certain to cut off again). Equal to `cap` means there is no room to retry: the caller does not retry. One function for
 * the panel's cut-off retries (chain.js cutOffRetryCap) and the Anthropic thinking retry (chain.js invoke, cost.js projectStage).
 */
export const retryCapFor = (cap, ceiling = 64_000) => Math.max(cap, Math.min(cap * 2, ceiling));

/**
 * The [key, value] pairs of the table's own "high" form for a seat on its own provider, e.g. [['output_config', {effort: 'high'}]]:
 * what a shipped chain writes. Used by the single-vendor rewrite to drop them (they are the seat's native words, not the vendor's).
 */
export function nativeHighKeysOf(seat, cap = seat.maxTokens) {
  const row = rowOf(seat);
  if (!row?.form) return [];
  if (row.form === 'anthropic-budget') {
    // A Haiku budget is the one the rule writes (half the cap, at least 1,024); any other budget is the seat's own and stays.
    const t = seat.extra?.thinking;
    return t?.type === 'enabled' && typeof cap === 'number' && t.budget_tokens === haikuBudgetFor(cap) ? [['thinking', t]] : [];
  }
  return Object.entries(REASONING_TABLE.forms[row.form]?.extra ?? {});
}

// The leaves ([path, value]) of the table's own "high" form for a seat's model, e.g. [[['output_config','effort'], 'high']]. Audit A2-4 (0.8.1): compared and
// dropped LEAF BY LEAF, so `output_config: { effort: 'high', format: ... }` loses only its effort.
const leavesOf = (o, path = [], out = []) => {
  for (const [k, v] of Object.entries(o || {})) (v && typeof v === 'object' && !Array.isArray(v)) ? leavesOf(v, [...path, k], out) : out.push([[...path, k], v]);
  return out;
};
const getPath = (o, path) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const hasPath = (o, path) => path.every((k, i) => { const x = path.slice(0, i).reduce((y, kk) => y?.[kk], o); return x && typeof x === 'object' && k in x; });

/**
 * The `extra` of a seat after the table's own exact "high" is removed (a vendor reroute: those are the seat's native words, meaningless on the vendor's wire).
 * Returns {} when nothing changes, { extra } (possibly undefined) otherwise. Only a leaf equal to the table's value is removed; empty parents are pruned.
 */
export function withoutNativeHigh(seat, cap = seat.maxTokens) {
  if (!seat.extra || typeof seat.extra !== 'object') return {};
  const row = rowOf(seat);
  if (!row?.form) return {};
  const drops = row.form === 'anthropic-budget'
    ? nativeHighKeysOf(seat, cap).map(([k, v]) => [[k], v])
    : leavesOf(REASONING_TABLE.forms[row.form]?.extra);
  const extra = structuredClone(seat.extra); let changed = false;
  for (const [path, val] of drops) {
    if (!hasPath(extra, path) || JSON.stringify(getPath(extra, path)) !== JSON.stringify(val)) continue;
    const parent = path.length > 1 ? getPath(extra, path.slice(0, -1)) : extra;
    // Audit re-audit 14: leave an object whose other keys carry a reasoning field of the seat's own alone (zai `thinking: { type, budget_tokens }`): dropping its type would leave a broken half.
    if (path.length > 1 && Object.keys(parent).some(k => k !== path[path.length - 1] && REASONING_WORDS.test(k) && !drops.some(([dp]) => dp.length === path.length && dp.slice(0, -1).join('.') === path.slice(0, -1).join('.') && dp[dp.length - 1] === k))) continue;
    delete parent[path[path.length - 1]]; changed = true;
    for (let i = path.length - 1; i > 0; i--) { const p = getPath(extra, path.slice(0, i)); if (p && Object.keys(p).length === 0) delete getPath(extra, path.slice(0, i - 1).length ? path.slice(0, i - 1) : [])[path[i - 1]]; else break; }
  }
  if (!changed) return {};
  return Object.keys(extra).length ? { extra } : { extra: undefined };
}

/**
 * True when a seat carries a reasoning field of its own on its native provider that is NOT the table's exact high (a user's own chain: a
 * lower setting, or a higher one such as `max`), anywhere in its `extra` (leaf by leaf), or any other reasoning-looking field once the exact high is
 * dropped. A vendor reroute keeps it and adds no vendor default beside it: one reasoning field on the wire.
 */
export function hasOwnNativeReasoning(seat, cap = seat.maxTokens) {
  const row = rowOf(seat);
  if (!row?.form || !seat.extra || typeof seat.extra !== 'object') return false;
  const rest = 'extra' in withoutNativeHigh(seat, cap) ? withoutNativeHigh(seat, cap).extra : seat.extra;
  return carriesReasoningField(rest);
}
