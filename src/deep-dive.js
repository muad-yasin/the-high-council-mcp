// Tiered councils: the deep-dive seat (config.deep_dive + seats.deep_dive; 2026-09-26).
//
// Muad's design: "the highest models for the highest tasks, and the lowest models (in price) for
// the mass-agentic tasks." A deep-dive seat is the mass-agentic end of that: ONE seat with ONE job,
// a large output cap, and its OWN dollar cap inside the run's cap, so a cheap model can spend a
// very large number of tokens on one thorough task (check the whole plan against every part of a
// long source; play one subsystem through in detail) where a panel seat gets a few thousand.
//
// Contract
//   config.deep_dive = {
//     enabled: true,
//     job: "sources" | "subsystem",       default "sources"
//     focus: ["...", ...],                 optional; one pass over the source per entry
//     usd: 4,                              REQUIRED: this seat's own ceiling (chain-lint enforces it)
//     maxCalls: 24,                        optional; default 24
//     chunkChars: 60000                    optional; default 60000 characters of source per call
//   }
//   config.seats.deep_dive                 the one seat (chain-lint: required when enabled)
//   stage labels                           deep-dive-<lab>-<n> (1-based, in call order), stable
//   result (runChain's `deep_dive`, report.json's `deep_dive`):
//     { lab, model, job, usd_cap, spent, calls, planned_calls, stopped: null | "own_cap" | "max_calls",
//       findings: [{ call, criterion, quote, quote_status, source_quote, problem, fix }], unreadable }
//
// Money: every call goes through invoke(), so the run's cap projects it first and the denied-model
// backstop applies. Before each call this stage ALSO projects the same worst case (projectStage,
// the one function invoke() uses) against its own remaining dollars, and stops the deep dive -
// not the run - when the next call could pass its own cap. Replayed calls count at what they cost,
// so a resumed run takes the same decisions. Calls run one after another, never in parallel, so
// the own cap is checked against real spend, not against reservations.
//
// `spent` is what the RUN cap charged for each call (runSpent(), read before and after it), not
// only the stage's own `usd`: a stale cached call that re-runs still charges what the superseded
// answer cost, and a call that failed after it was sent is charged one attempt. The deep dive's own
// cap counts both, like the run cap (verification of thc-research PR #13, finding 1). Without
// runSpent (a direct caller) it falls back to the stage's `usd`.
//
// The seat never votes. Its findings are handed to the reviser as one pass before the anchor
// panel's first review (chain.js), where each is fixed or DECLINED like a critic's.
import * as R from './roles.js';
import { projectStage, formatUsd } from './cost.js';

export const DEEP_DIVE_DEFAULTS = Object.freeze({ job: 'sources', maxCalls: 24, chunkChars: 60000 });

/** Split the source into chunks of at most `size` characters, at a line break when one is near. */
export function chunkSource(text, size) {
  const src = String(text || '');
  if (!src.length) return [''];
  const out = [];
  let at = 0;
  while (at < src.length) {
    let end = Math.min(src.length, at + size);
    if (end < src.length) {
      const nl = src.lastIndexOf('\n', end);
      if (nl > at + size / 2) end = nl + 1;
    }
    out.push(src.slice(at, end));
    at = end;
  }
  return out;
}

/** The calls a deep dive plans: every focus × every chunk, cut at maxCalls. */
export function planDeepDive(config, request) {
  const dd = { ...DEEP_DIVE_DEFAULTS, ...(config.deep_dive || {}) };
  const focus = Array.isArray(dd.focus) && dd.focus.length ? dd.focus.map(String)
    : [dd.job === 'subsystem' ? 'The whole plan, one subsystem at a time.' : 'Every requirement in the source excerpt.'];
  const chunks = chunkSource(request, dd.chunkChars);
  const calls = [];
  for (const f of focus) chunks.forEach((chunk, i) => calls.push({ focus: f, chunk, index: i + 1, of: chunks.length }));
  return { dd, calls: calls.slice(0, dd.maxCalls), planned: calls.length };
}

export async function runDeepDive(config, { request, criteria, draft, invoke, record, parseJson, rethrowControlFlow, log = () => {}, runSpent = null }) {
  const seat = config.seats.deep_dive;
  const lab = seat.lab || seat.provider;
  const { dd, calls, planned } = planDeepDive(config, request);
  const system = R.deepDiveSystem(dd.job);
  const out = { lab, model: seat.model, job: dd.job, usd_cap: dd.usd, spent: 0, calls: 0, planned_calls: planned, stopped: null, findings: [], unreadable: 0 };
  if (planned > calls.length) log(`  ${lab}: ${planned} call(s) planned, cut to maxCalls ${dd.maxCalls}.`);
  for (let n = 0; n < calls.length; n++) {
    const c = calls[n];
    const user = R.deepDiveUser({ criteria, draft, chunk: c.chunk, index: c.index, of: c.of, focus: c.focus });
    const projected = projectStage(seat, { system, user });
    if (out.spent + projected > dd.usd) {
      out.stopped = 'own_cap';
      log(`  ${lab}: stopped after ${out.calls} call(s) - ${formatUsd(out.spent)} spent, the next could cost up to ${formatUsd(projected)}, its own cap is ${formatUsd(dd.usd)}. The run goes on.`);
      break;
    }
    let st;
    const before = runSpent ? runSpent() : null;
    const charged = fallback => (runSpent ? Math.max(0, runSpent() - before) : fallback);
    try {
      st = record(await invoke(seat, { system, user, log, label: `deep-dive-${lab}-${n + 1}` }));
    } catch (err) {
      out.spent += charged(0);
      rethrowControlFlow(err); // the run's own cap, an external pause, a denied model: not ours to swallow
      out.unreadable++;
      log(`  ${lab}: call ${n + 1} failed (${String(err.message).slice(0, 100)}) - no findings from it.`);
      continue;
    }
    out.calls++;
    out.spent += charged(st.usd || 0);
    const parsed = parseJson(st.text);
    if (!parsed || !Array.isArray(parsed.findings)) { out.unreadable++; log(`  ${lab}: call ${n + 1} unreadable - no findings from it.`); continue; }
    for (const f of parsed.findings) {
      if (!f || typeof f !== 'object' || !String(f.problem || '').trim()) continue;
      const quote = typeof f.quote === 'string' ? f.quote.slice(0, 2000) : '';
      out.findings.push({
        call: n + 1,
        criterion: String(f.criterion || `source excerpt ${c.index} of ${c.of}`).slice(0, 500),
        quote,
        // The same cheap check the harness runs on critic quotes: the words must be in the draft.
        quote_status: !quote ? 'none' : draft.includes(quote) ? 'verified' : 'not found in the plan',
        source_quote: typeof f.source_quote === 'string' ? f.source_quote.slice(0, 2000) : '',
        problem: String(f.problem).slice(0, 2000),
        fix: String(f.fix || '').slice(0, 2000),
      });
    }
  }
  if (!out.stopped && planned > calls.length) out.stopped = 'max_calls';
  log(`  ${lab}: ${out.calls} call(s), ${out.findings.length} finding(s), ${formatUsd(out.spent)} of its own ${formatUsd(dd.usd)}${out.stopped ? ` (stopped: ${out.stopped})` : ''}.`);
  return out;
}

/** The deep dive's findings in the shape reviserUser() renders as failures. */
export function deepDiveFailures(result) {
  return (result?.findings || []).map(f => ({
    criterion: f.criterion,
    quote: f.quote || undefined,
    quote_status: f.quote ? f.quote_status : undefined,
    problem: f.source_quote ? `${f.problem} (source: "${f.source_quote}")` : f.problem,
    fix: f.fix,
    lab: `deep-dive:${result.lab}`,
  }));
}

/** BOARD.md section for the deep dive, or ''. */
export function renderDeepDiveBoard(dd) {
  if (!dd) return '';
  const head = `## Deep dive (${dd.lab}/${dd.model}, job: ${dd.job})\n\n${dd.calls} of ${dd.planned_calls} planned call(s), ${formatUsd(dd.spent)} of its own ${formatUsd(dd.usd_cap)} cap${dd.stopped ? `, stopped: ${dd.stopped === 'own_cap' ? 'its own cap' : 'maxCalls'}` : ''}${dd.unreadable ? `, ${dd.unreadable} unreadable` : ''}. It does not vote: each finding went to the reviser before the panel's first review.`;
  const rows = dd.findings.map((f, i) => `${i + 1}. **${f.criterion}** - ${f.problem}${f.quote ? ` Quote: "${f.quote}" (${f.quote_status}).` : ''}`);
  return `${head}\n\n${rows.join('\n') || '- (no findings)'}${dd.revise ? `\n\nReviser: ${dd.revise.declined.length} declined${dd.revise.declined.length ? ` - ${dd.revise.declined.join('; ')}` : ''}.` : ''}\n\n`;
}
