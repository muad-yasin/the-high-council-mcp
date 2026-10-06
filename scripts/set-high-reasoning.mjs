// One-time migration for 0.8.1 milestone R (owner, 4-5 Oct 2026: "I want reasoning to always be 'High' for the 'High' Council"):
// rewrites every shipped, non-mock chain so each seat that takes a reasoning setting says "high" explicitly, and removes every
// setting that lowered it. It reads the same table and the same list of lowering forms as the chain-lint rule (src/reasoning.js),
// so the lint passes on its output. Re-runnable: a second run changes nothing.
//   node scripts/set-high-reasoning.mjs            report only (prints every change)
//   node scripts/set-high-reasoning.mjs --write    rewrite chains/*.json

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAIKU_MIN_BUDGET, REASONING_TABLE, haikuBudgetFor, loweringReasons, rowOf } from '../src/reasoning.js';
import { SEAT_DEFAULT_MAX_TOKENS } from '../src/cost.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const log = [];

// Removes the lowering sub-settings from an extra object (in place) and returns it, or undefined when nothing is left.
function stripLowering(extra) {
  if (!extra) return extra;
  const e = extra;
  if (e.thinking?.type === 'disabled' || e.thinking?.type === 'between_tools') delete e.thinking;
  if (e.output_config && 'effort' in e.output_config && !['high', 'xhigh', 'max'].includes(e.output_config.effort)) delete e.output_config.effort;
  if (e.reasoning) {
    if ('effort' in e.reasoning && !['high', 'xhigh', 'max'].includes(e.reasoning.effort)) delete e.reasoning.effort;
    if (e.reasoning.enabled === false) delete e.reasoning.enabled;
    if (e.reasoning.exclude === true) delete e.reasoning.exclude;
    if ('max_tokens' in e.reasoning) delete e.reasoning.max_tokens;
    if (!Object.keys(e.reasoning).length) delete e.reasoning;
  }
  if ('reasoning_effort' in e && !['high', 'xhigh', 'max'].includes(e.reasoning_effort)) delete e.reasoning_effort;
  if (e.enable_thinking === false) delete e.enable_thinking;
  if (e.chat_template_kwargs && e.chat_template_kwargs.enable_thinking === false) delete e.chat_template_kwargs.enable_thinking;
  if (e.chat_template_kwargs && e.chat_template_kwargs.thinking === false) delete e.chat_template_kwargs.thinking;
  if (e.chat_template_kwargs && 'reasoning_effort' in e.chat_template_kwargs && !['high', 'xhigh', 'max'].includes(e.chat_template_kwargs.reasoning_effort)) delete e.chat_template_kwargs.reasoning_effort;
  if (e.chat_template_kwargs && !Object.keys(e.chat_template_kwargs).length) delete e.chat_template_kwargs;
  if (e.output_config && !Object.keys(e.output_config).length) delete e.output_config;
  return Object.keys(e).length ? e : undefined;
}


// Caps (every number carries its derivation):
//   36,000  = SEAT_DEFAULT_MAX_TOKENS, the owner's uniform seat cap: a seat that ran with reasoning OFF now reasons, and its old cap was sized for no thinking.
//   360,000 = what Muad gave glm-5.3-flash in plan-open-7 (commit 771775a, "Muad's call"): a model whose own default effort is "max" burns tens of
//             thousands of tokens thinking before its verdict (the 2026-09 GLM empty-verdict incident); and the same for DeepSeek V4.1 Flash
//             (owner order (e): $0.60 per million output tokens, so 360,000 tokens is about $0.22 a call, priced into the worst case).
const CAP_REASONING_WAS_OFF = SEAT_DEFAULT_MAX_TOKENS;
const CAP_DEFAULT_ABOVE_HIGH = 360_000;
const CAP_CHEAP_SEAT = 360_000;
const CHEAP_SEAT_MODELS = new Set(['openrouter/deepseek/deepseek-v4.1-flash']);

// Rebuilds a seat keeping its key order, so a changed seat reads like the original with only its own lines changed.
function rebuild(seat, extra, maxTokens, panelMaxTokens) {
  const o = {};
  let hadExtra = false;
  let hadCap = false;
  for (const [k, v] of Object.entries(seat)) {
    if (k === 'extra') { hadExtra = true; if (extra) o.extra = extra; } else if (k === 'maxTokens') { hadCap = true; o.maxTokens = maxTokens; } else if (k !== 'panelMaxTokens') o[k] = v;
  }
  if (!hadCap && maxTokens !== undefined) o.maxTokens = maxTokens;
  if (panelMaxTokens !== undefined) o.panelMaxTokens = panelMaxTokens;
  if (!hadExtra && extra) o.extra = extra;
  return o;
}

function fixSeat(seat, ctx) {
  const before = { extra: seat.extra, maxTokens: seat.maxTokens, panelMaxTokens: seat.panelMaxTokens };
  const lowered = loweringReasons(seat.extra, seat).length > 0;
  const row = rowOf(seat);
  const wasOff = seat.extra?.thinking?.type === 'disabled' || seat.extra?.reasoning?.enabled === false || seat.extra?.chat_template_kwargs?.enable_thinking === false || seat.extra?.chat_template_kwargs?.thinking === false;
  let extra = stripLowering(seat.extra ? structuredClone(seat.extra) : undefined);
  const old = seat.maxTokens ?? SEAT_DEFAULT_MAX_TOKENS;
  let cap = seat.maxTokens;
  if (row?.form && !row.defaultAboveHigh) {
    const form = REASONING_TABLE.forms[row.form];
    const own = extra || {};
    if (row.form === 'anthropic-budget') {
      if (own.thinking?.type !== 'enabled') {
        // Haiku 4.5: thinking on with a budget; the cap grows by the budget so the answer keeps its old room.
        cap = old + Math.max(HAIKU_MIN_BUDGET, old);
        extra = { ...own, thinking: { type: 'enabled', budget_tokens: haikuBudgetFor(cap) } };
      }
    } else {
      const merged = { ...own };
      for (const [k, v] of Object.entries(form.extra)) {
        if (typeof v === 'object' && merged[k] && typeof merged[k] === 'object') merged[k] = { ...v, ...merged[k] };
        else if (!(k in merged)) merged[k] = structuredClone(v);
      }
      extra = merged;
    }
  }
  if (wasOff && row?.form !== 'anthropic-budget') cap = Math.max(cap ?? 0, old, CAP_REASONING_WAS_OFF);
  // A model that defaults above high gets the uniform cap on every stage and the 360,000 review cap on the panel only (771775a: "panelMaxTokens raises the review stage only").
  let panel = seat.panelMaxTokens;
  if (row?.defaultAboveHigh && (lowered || (seat.maxTokens === CAP_DEFAULT_ABOVE_HIGH && !seat.panelMaxTokens))) {
    cap = lowered ? Math.max(old, CAP_REASONING_WAS_OFF) : CAP_REASONING_WAS_OFF;
    if (ctx.isPanel && !panel) panel = CAP_DEFAULT_ABOVE_HIGH;
  }
  if (!ctx.advice && CHEAP_SEAT_MODELS.has(`${seat.provider}/${seat.model}`)) cap = Math.max(old, CAP_CHEAP_SEAT);
  const after = { extra, maxTokens: cap, panelMaxTokens: panel };
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  ctx.report.push(`  ${ctx.where}: ${seat.provider}/${seat.model}  ${lowered ? '[was lowered] ' : ''}cap ${before.maxTokens ?? 'default'}${after.maxTokens !== before.maxTokens ? ` -> ${after.maxTokens}` : ''}  extra ${JSON.stringify(before.extra ?? null)} -> ${JSON.stringify(after.extra ?? null)}`);
  return rebuild(seat, extra, cap, panel);
}

// --- text-level patching: a changed seat replaces only its own span, so the hand-formatted rest of each file (compact arrays and
// objects) stays byte for byte. A minimal scanner finds the span of the value at a path.
function spanOf(text, path) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const str = () => { i++; while (text[i] !== '"') { if (text[i] === '\\') i++; i++; } i++; };
  const value = (want) => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '"') { str(); return [start, i]; }
    if (c === '{') {
      i++; ws();
      while (text[i] !== '}') {
        ws(); const ks = i; str(); const key = JSON.parse(text.slice(ks, i)); ws(); i++; // ':'
        if (want && want.length && key === want[0]) { const r = value(want.slice(1)); if (want.length === 1) return r; return r; }
        value(null); ws(); if (text[i] === ',') i++; ws();
      }
      i++; return [start, i];
    }
    if (c === '[') {
      i++; ws(); let idx = 0;
      while (text[i] !== ']') {
        if (want && want.length && idx === want[0]) { const r = value(want.slice(1)); return r; }
        value(null); idx++; ws(); if (text[i] === ',') i++; ws();
      }
      i++; return [start, i];
    }
    while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
    return [start, i];
  };
  return value(path);
}
function patch(text, edits) {
  // edits: [{ path: [...], seat }]; applied from the end of the file so earlier offsets stay valid.
  const located = edits.map(e => ({ ...e, span: spanOf(text, e.path) })).sort((a, b) => b.span[0] - a.span[0]);
  let out = text;
  for (const e of located) {
    const lineStart = out.lastIndexOf('\n', e.span[0]) + 1;
    const indent = out.slice(lineStart).match(/^ */)[0];
    const body = JSON.stringify(e.seat, null, 2).split('\n').map((l, n) => (n ? indent + l : l)).join('\n');
    out = out.slice(0, e.span[0]) + body + out.slice(e.span[1]);
  }
  return out;
}

const walk = (o, path, f) => {
  if (Array.isArray(o)) o.forEach((v, i) => walk(v, [...path, i], f));
  else if (o && typeof o === 'object') {
    if (typeof o.provider === 'string' && typeof o.model === 'string') f(o, path);
    for (const [k, v] of Object.entries(o)) walk(v, [...path, k], f);
  }
};

let changed = 0;
for (const file of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).sort()) {
  const p = join(root, 'chains', file);
  const text = readFileSync(p, 'utf8');
  const cfg = JSON.parse(text);
  const seats = [];
  walk(cfg, [], (s, path) => seats.push([s, path]));
  if (!seats.length || seats.every(([s]) => s.provider === 'mock')) continue;
  const report = [];
  const edits = [];
  for (const [s, path] of seats) {
    if (s.provider === 'mock' || s.provider === 'external') continue;
    const next = fixSeat(structuredClone(s), { where: '/' + path.join('/'), report, advice: !!cfg.advise, isPanel: path.includes('critics') });
    if (next) edits.push({ path, seat: next });
  }
  if (!edits.length) continue;
  const out = patch(text, edits);
  JSON.parse(out); // must stay valid JSON
  log.push(file, ...report);
  changed++;
  if (write) writeFileSync(p, out);
}
console.log(log.join('\n'));
console.log(`\n${changed} chain files ${write ? 'rewritten' : 'would be rewritten'}.`);
