import { call, keyFor } from './providers.js';
import * as R from './roles.js';
import { costOf, summarise, formatUsd, worstCaseOf, wouldBreach } from './cost.js';
import { requiredDeliverableSections } from './preflight.js';
import { withdrawalLedger } from './withdrawal-ledger.js';
import { applySeatRole } from './seat-role.js';
import { NO_TIE_BREAK } from './tie-break.js';

// v3 §4: the criteria stage's own user prompt, exported so it's testable without running a
// full chain. Tells the criteria seat what the chain's own contract will require in the
// deliverable, so it never writes a criterion that conflicts with a section the builder is
// required to produce - the recurring contract-vs-criteria conflict v2's pre-flight check
// could only warn about after the fact. Reuses the same required-sections data the pre-flight
// check already computes - no new state, no second source of truth.
export function criteriaUserPrompt(request, config) {
  const required = requiredDeliverableSections(config);
  const requiredBlock = required.length
    ? `\n\n# Sections this chain always adds\nThe deliverable will also contain: ${required.join(', ')}.\nDo not write a criterion that forbids this section's presence or dictates an ordering it cannot satisfy.`
    : '';
  return `# Request\n\n${request}${requiredBlock}`;
}

// A "seat" is one lab's model occupying one slot in the chain.
//   { provider, model, maxTokens?, temperature? }

// Qwen3.5-9B (2026-09-10, three real runs against the same task, 3/3 failed identically):
// when quoting a source phrase verbatim inside a JSON string value, it wraps the quote in
// markdown-style 'single quotes' but leaves any literal " inside that span unescaped (e.g.
// `"evidence": "...states: 'no mention of "The Council," no round count...'"` - the inner "
// terminates the JSON string early). Separately (same evening, a different run): a raw
// unescaped newline landed inside a string value instead of \n. Both are mechanical, safe to
// repair by scanning with real string-state tracking rather than a single regex (a regex can't
// tell "the real closing quote" from "a stray quote mid-sentence" without looking at what comes
// next). A quote is only treated as ending a string if the next non-whitespace character is a
// plausible JSON continuation (, : } ]) or end-of-text; otherwise it's escaped in place. This
// was verified against all three real broken runs (fixed the one that was otherwise-clean; the
// other two had additional, genuinely garbled model output - e.g. a stray `;` and leaked
// CSS-looking text - that no mechanical repair should paper over) and regression-checked against
// every other already-valid critique reply on disk at the time (26 files, zero broken).
function repairStrayQuotesAndControlChars(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && inString) {
      out += c;
      if (i + 1 < text.length) { out += text[i + 1]; i++; }
      continue;
    }
    if (inString && (c === '\n' || c === '\r' || c === '\t')) {
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t';
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        out += c;
        continue;
      }
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      if (next === undefined || ',:}]'.includes(next)) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}

// §5 (v3 plan, MISTRAL-3 accepted): a reviser that judges an objection to not
// be a real defect ends its reply with one or more trailing "DECLINED: <reason>"
// lines (src/roles.js's reviser system prompt). Those lines are never part of
// the deliverable a critic grades - they're stripped here and returned
// separately so the caller can carry them into report.json's `disputes`
// field instead. Only lines strictly at the end of the reply count: a
// "DECLINED:"-shaped line does not get pulled out of the middle of the
// deliverable's own body text.
export function parseDisputes(text) {
  const lines = text.split('\n');
  let i = lines.length - 1;
  const declined = [];
  while (i >= 0 && /^DECLINED:\s*.+/.test(lines[i].trim())) {
    declined.unshift(lines[i].trim().replace(/^DECLINED:\s*/, ''));
    i--;
  }
  let draftLines = lines.slice(0, i + 1);
  while (draftLines.length && draftLines[draftLines.length - 1].trim() === '') draftLines.pop();
  return { draft: draftLines.join('\n'), disputes: declined };
}

export function parseJson(text) {
  // Models wrap JSON in prose or fences no matter how firmly you ask them not to,
  // and the small ones leave a trailing comma before ] or } (GLM 5.3 Flash,
  // 2026-09-07: a real objection counted as an abstention over one comma).
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const openFence = text.match(/```(?:json)?\s*([\s\S]*)$/); // closing fence missing
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  const braces = first !== -1 && last > first ? text.slice(first, last + 1) : null;
  const candidates = [text, fenced?.[1], openFence?.[1], braces].filter(Boolean);
  // Repairs, mildest first. Each one targets a slip a real seat has made:
  //  - trailing comma before ] or } (GLM 5.3 Flash)
  //  - a key written as a bare string, "reason: text" instead of "reason": "text"
  //    (Mistral Large, six times in one reply, 2026-09-07)
  //  - a stray unescaped quote or raw control char inside a string value (Qwen3.5-9B, 2026-09-10)
  const repairs = [
    c => c,
    c => c.replace(/,\s*([\]}])/g, '$1'),
    c => c.replace(/"([A-Za-z_][A-Za-z0-9_ ]*):\s+([^"]*)"/g, (all, k, v) => `"${k}": "${v.replace(/"/g, '\\"')}"`).replace(/,\s*([\]}])/g, '$1'),
    c => repairStrayQuotesAndControlChars(c).replace(/,\s*([\]}])/g, '$1'),
  ];
  for (const repair of repairs) {
    for (const c of candidates) {
      try { return JSON.parse(repair(c.trim())); } catch { /* try the next shape */ }
    }
  }
  return null;
}

// Explains why a critic's reply couldn't be parsed, for the abstention log line. Found 2026-09-10
// (GP judging run 2026-09-10T20-01-59-545Z, panel-1-glm.md): the old two-way check (token cap vs.
// "malformed JSON") mislabelled a genuinely empty reply as "malformed JSON - read the saved reply,
// it may still be an objection" - there is nothing to read, and it is not an objection. The
// provider's own finish_reason ("stop" in usage, set by providers.js from finish_reason/
// stop_reason) already says this plainly when it's not a normal completion: OpenRouter/OpenAI-
// compatible providers return "error" when the upstream model errors out mid-generation (here,
// GLM 5.3 Flash burned its whole token budget on thinking - usage.thinking === usage.output - and
// returned no content at all), which is a distinct failure from either truncation or a formatting
// slip and needs its own label so a later session doesn't chase the wrong bug.
export function classifyUnreadable(usage, maxTokens) {
  if (usage.stop === 'error') return 'provider returned an error mid-generation (stop: error) - not a truncation or a JSON-formatting problem';
  const cap = maxTokens ?? 8000;
  if (usage.output >= cap * 0.95) return 'hit the token cap, truncated';
  return 'malformed JSON - read the saved reply, it may still be an objection';
}

// Small critics fill the schema literally: every criterion MET, meets:false,
// and a placeholder failure {criterion:"None"} because the array "had to"
// hold something (Llama 3.3 70B did exactly this on 2026-09-07, and the
// harness counted it as an objection). The per-criterion table is the honest
// signal, so the summary fields are derived from it rather than trusted.
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A critic's own text (criterion/problem/fix/verdict_line) is entirely critic-controlled and
// flows, undelimited until roles.js's own prompt-construction fix, straight into the reviser's
// prompt and the run history handed to the finalist (docs/security-prompt-injection.md S3, found
// from cnc-harness's own security review of what a plan-N seat actually runs). A 20 000-token
// critic reply could otherwise become a 20 000-token "failure" in the next prompt; cap each
// field here, at parse time, once, rather than trusting every call site downstream to remember.
const CRITIQUE_FIELD_MAX_CHARS = 2000;
function capField(value) {
  if (typeof value !== 'string') return value;
  return value.length > CRITIQUE_FIELD_MAX_CHARS
    ? `${value.slice(0, CRITIQUE_FIELD_MAX_CHARS)}… [truncated, ${value.length} chars total]`
    : value;
}

export function normaliseCritique(critique, log = () => {}) {
  const placeholder = f => !f || !f.criterion || /^(none|n\/?a|-|no failures?)\.?$/i.test(String(f.criterion).trim());
  const failures = (critique.failures || []).filter(f => !placeholder(f))
    .map(f => ({ ...f, criterion: capField(f.criterion), problem: capField(f.problem), fix: capField(f.fix) }));
  const dropped = (critique.failures || []).length - failures.length;
  if (dropped) log(`    (ignored ${dropped} placeholder failure entr${dropped === 1 ? 'y' : 'ies'} that named no criterion)`);
  for (const row of Array.isArray(critique.criteria) ? critique.criteria : []) {
    if (String(row.verdict || '').toUpperCase() !== 'FAILED') continue;
    if (failures.some(f => f.criterion === row.criterion)) continue;
    failures.push({ criterion: capField(row.criterion), problem: capField(row.evidence) || 'marked FAILED in the criteria table', fix: '' });
    log(`    (added a failure the critic marked FAILED in its table but left out of its failures list)`);
  }
  return { ...critique, failures, verdict_line: capField(critique.verdict_line), meets: failures.length === 0 };
}

// Reads the plan's own "Scope ledger" lines: `<id> - accepted|cut - <reason>`.
// An id the ledger does not mention is "unaccounted", which is itself a
// finding about the integrator, not the proposer.
export function scoreProposals(proposals, plan) {
  const rows = proposals.map(p => {
    const re = new RegExp(`^[\\s*_\`-]*${p.id}[\`*_]*\\s*[-:\u2013\u2014]\\s*\\**(accepted|cut|withdrawn)\\**\\s*[-:\u2013\u2014]?\\s*(.*)$`, 'im');
    const m = plan.match(re);
    return { ...p, status: m ? m[1].toLowerCase() : 'unaccounted', note: m ? m[2].trim() : '' };
  });
  const labs = [...new Set(rows.map(r => r.lab))].map(lab => {
    const mine = rows.filter(r => r.lab === lab);
    const n = st => mine.filter(r => r.status === st).length;
    return { lab, model: mine[0].model, proposed: mine.length, accepted: n('accepted'), cut: n('cut'), withdrawn: n('withdrawn'), unaccounted: n('unaccounted'), built: null };
  });
  return { rows, labs };
}

// A lab's identity is its provider unless the seat names one: three seats on
// OpenRouter are three labs, and mock chains need two labs on one provider.
const labOf = seat => seat.lab || seat.provider;

// A run pauses at an external seat: the prompt is written for whoever plays
// that seat (a Claude Code session on the Max plan, a human), and the run
// resumes from disk once <label>.md exists. Thrown, not returned, so the
// chain's control flow stays linear.
export class ExternalPause extends Error {
  constructor(label, system, user) { super(`waiting for external stage ${label}`); this.label = label; this.system = system; this.user = user; }
}

// A run hits its spend ceiling: thrown from invoke() BEFORE the call goes
// out, so the breaching stage is never paid for. Like ExternalPause this is
// thrown rather than returned, and for the same reason - the chain's control
// flow stays linear, and every completed stage is already on disk, so the run
// is resumable under a higher ceiling.
export class BudgetExceeded extends Error {
  constructor({ label, seat, spent, cap, projected }) {
    super(`per-run spend cap reached before stage ${label}`);
    this.label = label;
    this.seat = seat;
    this.spent = spent;
    this.cap = cap;
    this.projected = projected;
  }
}

// Per-run cache, set by the CLI: get(label) -> { text, usage, usd, ... } or null.
let cache = { get: () => null };
export function setCache(c) { cache = c || { get: () => null }; }

// Per-run spend ceiling in USD, set by the CLI. null means no ceiling.
// `spent` accumulates every stage this run has paid for, including stages
// replayed from disk on a resume - the ceiling is on the run as a whole, not
// on one sitting at the terminal.
let budget = { cap: null, spent: 0 };
export function setBudget(cap) { budget = { cap: cap ?? null, spent: 0 }; }
export function budgetState() { return { ...budget, remaining: budget.cap === null ? null : Math.max(0, budget.cap - budget.spent) }; }

async function invoke(seat, { system, user, log, label }) {
  const started = Date.now();
  // Resume: a stage that already ran in this run folder is replayed from
  // disk, so a paused-and-resumed run never pays twice.
  const hit = cache.get(label);
  if (hit) {
    budget.spent += hit.usd || 0;
    log(`  ${label}: ${hit.provider || seat.provider}/${hit.model || seat.model} - from disk (${hit.usage?.input ?? 0} in, ${hit.usage?.output ?? 0} out, ${formatUsd(hit.usd || 0)} already spent)`);
    return { label, provider: hit.provider || seat.provider, model: hit.model || seat.model, lab: labOf(seat), usage: hit.usage || { input: 0, output: 0 }, usd: hit.usd || 0, priced: true, ms: 0, text: hit.text, cached: true };
  }
  if (seat.provider === 'external') throw new ExternalPause(label, system, user);

  // The cap is checked here, before the only line in this file that spends
  // money. Anthropic seats are projected at two attempts because invoke()
  // below may pay for the same stage twice (the thinking-disabled retry).
  const maxTokens = seat.maxTokens ?? 8000;
  const projected = worstCaseOf(seat.provider, seat.model, {
    promptChars: (system || '').length + (user || '').length,
    maxTokens,
    retries: seat.provider === 'anthropic' ? 2 : 1,
  }).usd;
  const verdict = wouldBreach({ spent: budget.spent, cap: budget.cap, projected });
  if (verdict.breach) {
    log(`  ${label}: STOPPED - ${formatUsd(budget.spent)} spent, this stage could cost up to ${formatUsd(projected)}, ceiling is ${formatUsd(budget.cap)}.`);
    throw new BudgetExceeded({ label, seat: `${seat.provider}/${seat.model}`, spent: budget.spent, cap: budget.cap, projected });
  }

  const ask = extra => call(seat.provider, {
    model: seat.model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: seat.maxTokens ?? 8000,
    temperature: seat.temperature,
    extra,
  });
  let res = await ask(seat.extra);
  let wasted = 0;
  // Claude's adaptive thinking counts against max_tokens and is not text. On
  // a hard prompt it can spend the whole budget before writing a word - the
  // netcode review on 2026-09-07 did exactly that three stages in a row, and
  // the panel reviewed an empty page twice. The same budget can also cut a
  // reply off mid-sentence (the v2 criteria stage, same day: 1534 thinking
  // tokens, JSON truncated), which is just as unusable. Either way: retry
  // once with thinking off.
  if (seat.provider === 'anthropic' && res.usage.thinking > 0 && res.usage.stop === 'max_tokens') {
    wasted = costOf(res.provider, res.model, res.usage).usd;
    const how = res.text.trim() ? `text cut off - ${res.usage.thinking} of ${res.usage.output} tokens went to thinking` : `empty text - all ${res.usage.output} tokens went to thinking`;
    log(`  ${label}: ${how} (stop: max_tokens, ${formatUsd(wasted)} spent); retrying once with thinking disabled.`);
    res = await ask({ ...(seat.extra || {}), thinking: { type: 'disabled' } });
  }
  const cost = costOf(res.provider, res.model, res.usage);
  const stage = {
    label,
    provider: res.provider,
    model: res.model,
    lab: labOf(seat),
    usage: res.usage,
    usd: cost.usd + wasted,
    priced: cost.priced,
    ms: Date.now() - started,
    text: res.text,
  };
  budget.spent += stage.usd;
  const think = res.usage.thinking ? ` (${res.usage.thinking} thinking)` : '';
  const cut = res.usage.stop === 'max_tokens' || res.usage.stop === 'length' ? ' [hit the cap]' : '';
  log(`  ${label}: ${res.provider}/${res.model} - ${res.usage.input} in, ${res.usage.output} out${think}${cut}, ${formatUsd(stage.usd)}, ${(stage.ms / 1000).toFixed(1)}s`);
  return stage;
}

export function checkSeats(seats) {
  const missing = [];
  for (const s of seats) {
    if (!s) continue;
    if (!keyFor(s.provider)) missing.push(`${s.provider} (seat ${s.model})`);
  }
  return [...new Set(missing)];
}

/**
 * Run the chain.
 *
 * Two termination modes, both against the same fixed, binary checklist - only
 * how many labs must agree changes, never what they're allowed to ask for:
 *
 *  - "first" (default): alternate one critic and a revision until any single
 *    critic passes the draft, or the round cap is reached.
 *  - "unanimous": every critic seat reviews the SAME draft each round; a round
 *    only counts as a pass if every one of them independently signs off with
 *    no failures. Otherwise the reviser fixes the union of everything any
 *    critic flagged, and the whole panel reviews again next round.
 *
 * Panel topology, unanimous mode only (config.panel):
 *  - "independent" (default): each critic sees only the draft. Verdicts are
 *    uncorrelated, so disagreement between labs means something.
 *  - "relay" (experimental): critics run one after another and each is handed
 *    the verdicts before it - the chain as originally sketched. On the one
 *    controlled comparison so far (Docs/Runs.md) it caught 0/3 of a real
 *    scope leak the blind panel caught 2/3: anchoring on the first seat.
 *    Kept for comparison runs. Seat order is randomised per round and earlier
 *    verdicts are anonymised, which is the best-evidenced mitigation short of
 *    not doing it.
 *
 * The round cap is the whole point either way - an uncapped refine loop
 * drifts, whether that's one critic asked again and again or a panel asked
 * to keep agreeing.
 */
export async function runChain({ request: requestIn, config, draft: initialDraft = null, log = console.log, onStage = () => {} }) {
  const stages = [];
  const record = s => { stages.push(s); onStage(s); return s; };
  let request = requestIn;

  // 0. Questions first (config.questions: { max, wait }). The answers become
  //    part of the request before criteria are written, so the checklist is
  //    written against the resolved request, not the ambiguous one.
  let questions = null;
  if (config.questions && !initialDraft) {
    const max = config.questions.max ?? 6;
    log('\nStage: questions (what would change the plan?)');
    const qs = record(await invoke(config.seats.questions || config.seats.criteria, {
      system: R.QUESTIONS_SYSTEM,
      user: R.questionsUser({ request, max }),
      log, label: 'questions',
    }));
    const parsed = parseJson(qs.text);
    questions = Array.isArray(parsed?.questions) ? parsed.questions.slice(0, max).filter(q => q && q.question) : [];
    if (!questions.length) log('  no usable questions returned; continuing without.');
    else {
      questions.forEach((q, i) => log(`  ${i + 1}. ${q.question}\n     default: ${q.default}`));
      const answered = cache.get('answers');
      if (answered) {
        log(`  answers: from disk (${answered.text.split(/\s+/).length} words)`);
        request += R.answersSection(questions, answered.text);
      } else if (config.questions.wait === false) {
        log('  wait: false - defaults taken for every question.');
        request += R.answersSection(questions, '');
      } else {
        throw new ExternalPause('answers',
          'Answer the planner\'s questions. Write plain text: one numbered answer per question, in the same order. An answer may be "default" to take the planner\'s own default. Anything else you want the plan to know may follow the numbered answers.',
          `# The request\n\n${request}\n\n# The questions\n\n${R.renderQuestions(questions)}`);
      }
    }
  }

  const maxRounds = config.maxRounds ?? 2;
  const stopOnPass = config.stopOnPass !== false;
  const open = config.scope === 'open';
  if (open) log('scope: OPEN - every seat may add scope; additions are recorded, the verdict pass cuts');

  // 1. Acceptance criteria. Written before the deliverable exists, so they
  //    describe the request rather than rationalising whatever got built.
  let criteria = config.criteria;
  if (!criteria || criteria.length === 0) {
    log('\nStage: acceptance criteria');
    const s = record(await invoke(config.seats.criteria, {
      system: R.criteriaSystem(open),
      user: criteriaUserPrompt(request, config),
      log, label: 'criteria',
    }));
    const parsed = parseJson(s.text);
    criteria = parsed?.criteria;
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new Error('The criteria stage returned no usable criteria. Raw output kept in the run log.');
    }
  }
  log(`\nAcceptance criteria (${criteria.length}):`);
  criteria.forEach((c, i) => log(`  ${i + 1}. ${c}`));

  // 1b. Proposal stage (optional, config.proposals). A skeleton first, then
  //     every proposer seat - blind, concurrently - offers up to N buildable
  //     parts against it. The builder integrates and keeps a scope ledger.
  //     Authorship stays with one model: the labs propose, they never
  //     co-write (Docs/Evidence.md: mixed-author merges lose to one strong
  //     author; distinct roles win).
  let proposals = [];
  let dropouts = [];
  const proposalPool = [];
  let skeleton = null;
  let board = null;
  let debate = null;
  if (config.proposals && !initialDraft) {
    const parts = config.proposals.parts ?? 3;
    const perPart = config.proposals.maxTokens ?? 1500;
    log('\nStage: skeleton');
    skeleton = record(await invoke(config.seats.skeleton || config.seats.builder, {
      system: R.SKELETON_SYSTEM,
      user: R.skeletonUser({ request, criteria }),
      log, label: 'skeleton',
    })).text;
    const proposers = config.seats.proposers || config.seats.critics;
    // Best-of-N: `samples` independent attempts per lab, pooled, then a judge
    // keeps the strongest `keep` distinct ones. samples=1 means no judging.
    const samples = config.proposals.samples ?? 1;
    const keep = config.proposals.keep ?? parts;
    log(`\nStage: proposals (${proposers.length} labs, ${samples} attempt(s) of up to ${parts} parts each, blind${samples > 1 ? `; a judge keeps up to ${keep} per lab` : ''})`);
    const results = await Promise.all(proposers.map(async seat => {
      const lines = [];
      const say = m => lines.push(m);
      const capped = { ...seat, maxTokens: Math.min(seat.maxTokens ?? 8000, parts * perPart + 300) };
      const pool = [];
      let unreadable = 0;
      for (let k = 0; k < samples; k++) {
        const st = record(await invoke(capped, {
          system: R.proposerSystem(open),
          user: R.proposerUser({ request, criteria, skeleton, parts }),
          log: say, label: `propose-${labOf(seat)}${samples > 1 ? `-${k + 1}` : ''}`,
        }));
        const parsed = parseJson(st.text);
        const list = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, parts) : null;
        if (!list) unreadable++; else pool.push(...list.filter(p => p && p.title).map(p => ({ ...p, attempt: k + 1 })));
      }
      if (unreadable) say(`  ${labOf(seat)}/${seat.model}: ${unreadable} of ${samples} attempt(s) unreadable.`);
      // A lab that returns nothing readable drops out of the panel entirely:
      // no proposals, no seat in the debate, no row anyone is likely to miss
      // it from. For a harness whose whole claim is that independent labs
      // disagree on the record, losing a lab to one malformed reply quietly
      // degrades the exact thing being measured - so buy one retry before
      // accepting it. The retry goes through invoke() like any other call, so
      // the spend cap still governs it.
      if (!pool.length) {
        const st = record(await invoke(capped, {
          system: R.proposerSystem(open),
          user: R.proposerUser({ request, criteria, skeleton, parts }),
          log: say, label: `propose-${labOf(seat)}-retry`,
        }));
        const parsed = parseJson(st.text);
        const list2 = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, parts) : null;
        if (list2) pool.push(...list2.filter(p => p && p.title).map(p => ({ ...p, attempt: samples + 1 })));
        say(`  ${labOf(seat)}/${seat.model}: nothing readable; retried once - ${pool.length ? `recovered ${pool.length} proposal(s)` : 'still nothing'}.`);
      }
      let list = pool;
      let judged = null;
      if (samples > 1 && pool.length > 0) {
        const judgeSeat = config.seats.judge || seat;
        const js = record(await invoke(judgeSeat, {
          system: R.JUDGE_SYSTEM,
          user: R.judgeUser({ request, criteria, skeleton, pool, keep }),
          log: say, label: `judge-${labOf(seat)}`,
        }));
        const jp = parseJson(js.text);
        const picks = Array.isArray(jp?.picks) ? [...new Set(jp.picks.map(Number).filter(n => n >= 1 && n <= pool.length))].slice(0, keep) : null;
        if (picks && picks.length) {
          list = picks.map(n => pool[n - 1]);
          judged = jp.dropped_because || '';
        } else {
          list = pool.slice(0, keep);
          say(`  ${labOf(seat)}/${seat.model}: judge reply unreadable - keeping the first ${list.length} of the pool.`);
        }
      }
      if (!list.length) say(`  ${labOf(seat)}/${seat.model}: no proposals.`);
      else say(`  ${labOf(seat)}/${seat.model}: ${list.length} proposal(s)${samples > 1 ? ` kept from a pool of ${pool.length}` : ''}${list.map(p => `\n    - ${p.title}`).join('')}${judged ? `\n    judge: ${judged}` : ''}`);
      // v5 §1 candidate 10: opt-in only, no default (his call, 2026-09-13) -
      // a chain that never sets max_proposals_per_seat behaves exactly as it
      // did before this candidate existed. Only a chain that does set it, and
      // only a seat whose own list still exceeds that cap, pays for one more
      // prompt to fold its own proposals down before the board sees them.
      const cap = Number.isInteger(config.proposals.maxProposalsPerSeat) && config.proposals.maxProposalsPerSeat > 0
        ? config.proposals.maxProposalsPerSeat : null;
      if (cap && list.length > cap) {
        const ms = record(await invoke(capped, {
          system: R.PROPOSAL_MERGE_SYSTEM,
          user: R.proposalMergeUser({ request, criteria, skeleton, list, cap }),
          log: say, label: `propose-${labOf(seat)}-merge`,
        }));
        const parsed = parseJson(ms.text);
        const picks = Array.isArray(parsed?.kept) ? [...new Set(parsed.kept.map(Number).filter(n => n >= 1 && n <= list.length))].slice(0, cap) : null;
        const before = list.length;
        list = picks && picks.length ? picks.map(n => list[n - 1]) : list.slice(0, cap);
        say(`  ${labOf(seat)}/${seat.model}: folded ${before} proposal(s) down to ${list.length} (cap ${cap})${parsed?.merged_because ? ` - ${parsed.merged_because}` : ''}`);
      }
      return { seat, list, pool, lines };
    }));
    // Labs that ended the stage with nothing, after the retry. Recorded so
    // the run report shows a shrunken roster instead of leaving it to be
    // inferred from a missing scoreboard row.
    dropouts = results.filter(r => !r.list.length).map(r => ({ lab: labOf(r.seat), model: r.seat.model, stage: 'proposals', reason: 'no readable proposals after a retry' }));

    const seen = {};
    for (const { seat, list, pool, lines } of results) {
      lines.forEach(m => log(m));
      let tag = labOf(seat).toUpperCase().replace(/[^A-Z0-9]/g, '');
      seen[tag] = (seen[tag] || 0) + 1;
      if (seen[tag] > 1) tag += String(seen[tag]);
      list.forEach((p, i) => proposals.push({ id: `${tag}-${i + 1}`, lab: labOf(seat), model: seat.model, ...p }));
      pool.forEach(p => proposalPool.push({ lab: labOf(seat), model: seat.model, ...p, kept: list.includes(p) }));
    }
    log(`  ${proposals.length} proposal(s) go to the builder.`);
    if (dropouts.length) {
      log(`  !! ROSTER SHRANK: ${dropouts.length} of ${proposers.length} labs produced nothing and are not in this run's debate or scoreboard:`);
      for (const d of dropouts) log(`     - ${d.lab}/${d.model} (${d.reason})`);
      log(`     Independence is measured across the labs that actually spoke, not the ones the chain names.`);
    }

    // Debate (config.debate): every lab reads the others' proposals and posts;
    // every author replies. Labs are anonymised in the prompts. The board is
    // what the builder reads instead of bare proposals.
    if (config.debate && proposals.length > 1) {
      const maps = R.anonymise(proposals);
      const labs = [...new Set(proposals.map(p => p.lab))];
      const seatOf = lab => proposers.find(s => labOf(s) === lab);
      log(`\nStage: debate (${labs.length} labs read each other's proposals, anonymised)`);
      const postResults = await Promise.all(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        let posts = [], revisions = [];
        try {
          // v6 §1/§3: role augmentation applies only here, the debate-stage
          // system prompt - never to the panel/critique stage. A seat with
          // no role gets R.DEBATE_SYSTEM back unchanged (applySeatRole is a
          // no-op), which is what the golden-hash compatibility test in
          // test/seat-role.test.js checks.
          const st = record(await invoke(seatOf(lab), {
            system: applySeatRole(R.DEBATE_SYSTEM, seatOf(lab)?.role),
            user: R.debateUser({ request, criteria, skeleton, proposals, lab, maps }),
            log: say, label: `debate-${lab}`,
          }));
          const parsed = parseJson(st.text);
          if (!parsed) say(`  ${lab}: unreadable debate reply - no posts counted.`);
          else {
            posts = (parsed.posts || []).map(x => ({ by: lab, on: maps.idFrom[x.on] || x.on, stance: String(x.stance || '').toLowerCase(), text: x.text || '', merge_with: x.merge_with ? (maps.idFrom[x.merge_with] || x.merge_with) : undefined }))
              .filter(x => proposals.some(p => p.id === x.on && p.lab !== lab) && ['support', 'object', 'merge'].includes(x.stance));
            revisions = (parsed.revisions || []).map(r => ({ ...r, id: maps.idFrom[r.id] || r.id })).filter(r => proposals.some(p => p.id === r.id && p.lab === lab));
            const n = st => posts.filter(x => x.stance === st).length;
            say(`  ${lab}: ${posts.length} post(s) - ${n('support')} support, ${n('object')} object, ${n('merge')} merge${revisions.length ? `; revised ${revisions.length} of its own` : ''}`);
          }
        } catch (err) {
          say(`  ${lab}: no debate reply (${String(err.message).slice(0, 100)}).`);
        }
        return { lines, posts, revisions };
      }));
      const posts = [];
      for (const r of postResults) { r.lines.forEach(m => log(m)); posts.push(...r.posts); for (const rev of r.revisions) { const p = proposals.find(x => x.id === rev.id); if (rev.how) p.how = rev.how; if (rev.acceptance_test) p.acceptance_test = rev.acceptance_test; p.amended = true; } }

      log(`\nStage: replies (each author answers the posts on its proposals)`);
      const replies = [];
      const replyResults = await Promise.all(labs.map(async lab => {
        const lines = []; const say = m => lines.push(m);
        const mineWithPosts = proposals.filter(p => p.lab === lab && posts.some(x => x.on === p.id));
        if (!mineWithPosts.length) { say(`  ${lab}: nothing to answer.`); return { lines, replies: [] }; }
        try {
          const st = record(await invoke(seatOf(lab), {
            system: R.REPLY_SYSTEM,
            user: R.replyUser({ request, proposals, posts, lab, maps }),
            log: say, label: `reply-${lab}`,
          }));
          const parsed = parseJson(st.text);
          if (!parsed) { say(`  ${lab}: unreadable reply round - proposals stand as posted.`); return { lines, replies: [] }; }
          const mine = (parsed.replies || []).map(r => ({ ...r, id: maps.idFrom[r.id] || r.id, replaced_by: r.replaced_by ? (maps.idFrom[r.replaced_by] || r.replaced_by) : undefined, action: String(r.action || '').toLowerCase() }))
            .filter(r => mineWithPosts.some(p => p.id === r.id) && ['keep', 'amend', 'withdraw'].includes(r.action));
          const n = a => mine.filter(r => r.action === a).length;
          say(`  ${lab}: ${n('keep')} keep, ${n('amend')} amend, ${n('withdraw')} withdraw`);
          return { lines, replies: mine };
        } catch (err) {
          say(`  ${lab}: no reply-round answer (${String(err.message).slice(0, 100)}).`);
          return { lines, replies: [] };
        }
      }));
      for (const r of replyResults) { r.lines.forEach(m => log(m)); replies.push(...r.replies); }
      for (const r of replies) {
        const p = proposals.find(x => x.id === r.id);
        if (r.action === 'amend') { if (r.how) p.how = r.how; if (r.acceptance_test) p.acceptance_test = r.acceptance_test; p.amended = true; }
        if (r.action === 'withdraw') { p.withdrawn = true; p.replaced_by = r.replaced_by; }
      }
      board = R.renderBoard(proposals, posts, replies);
      // v6 §4: the field is always present once a debate stage has run, even
      // when no tie ever occurred - an absent field reads as "no tie-break
      // happened" and as "the feature isn't wired up" identically, which is
      // exactly the silent-drop failure class this project was burned by
      // tonight. Phase 3 delivers the arithmetic and this always-present
      // field; no call site in this stage decides pass/fail by vote yet, so
      // debate runs record the no-op result until a future phase wires one.
      debate = { posts, replies, tie_break: NO_TIE_BREAK };
      const w = proposals.filter(p => p.withdrawn).length;
      log(`  board: ${posts.length} post(s), ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ${w} proposal(s) withdrawn, ${proposals.filter(p => p.amended).length} amended.`);

      // v5 §1 candidate 3: a withdrawal chain that cycles or dead-ends
      // (e.g. two labs mutually withdrawing in each other's favour) leaves
      // a section with no surviving owner - silently, unless the next
      // stage is told. Told here rather than aborting the run: the
      // integration stage can still assign or explicitly drop it.
      const ledger = withdrawalLedger(proposals);
      if (ledger.orphanSections.length) {
        log(`  WARNING: ${ledger.orphanSections.length} withdrawn proposal(s) have no surviving owner (${ledger.withdrawalCycles} withdrawal cycle(s)): ${ledger.orphanSections.join(', ')}`);
        board += `\n\n# Orphaned withdrawals - no surviving owner\n\nThese proposal ids withdrew in a chain that never reaches a proposal still standing (a cycle, or a dead end): ${ledger.orphanSections.join(', ')}. For each one, either assign the section it covered to something else in the plan, or state explicitly in the Scope ledger that it is dropped and why - do not silently leave it uncovered.`;
      }
    }
  }

  // 2. First build - unless a draft was handed in. Re-running a panel on the
  //    exact draft an earlier run reviewed is the only fair way to compare
  //    panel topologies; a fresh build is a fresh coin toss.
  let draft = initialDraft;
  if (draft) {
    log('\nRound 1: build (skipped - reviewing a draft handed in)');
  } else {
    log('\nRound 1: build');
    draft = record(await invoke(config.seats.builder, {
      system: R.builderSystem(open),
      user: R.builderUser({ request, criteria, proposals, board }),
      log, label: 'build',
    })).text;
  }

  // 3. Critic / revise rounds, hard-capped.
  const history = [];
  let passed = false;
  let lastCritique = null;
  let signoff = null;
  const disputes = [];

  if (config.signoff === 'unanimous') {
    for (let round = 1; round <= maxRounds; round++) {
      const relay = config.panel === 'relay';
      log(`\nRound ${round}: panel review (${config.seats.critics.length} labs, ${relay ? 'relay - each sees the verdicts before it' : 'independent'})`);
      const verdicts = [];
      const reviewSeat = async (criticSeat, prior, say) => {
        let cs;
        try {
          cs = record(await invoke(criticSeat, {
            system: R.criticSystem(open),
            user: R.criticUser({ request, criteria, draft, prior }),
            log: say, label: `panel-${round}-${labOf(criticSeat)}`,
          }));
        } catch (err) {
          // A lab that is down (429 after retries, 5xx, network) must not take
          // the panel down with it. It abstains, and the log says why.
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: no reply (${String(err.message).slice(0, 120)}) - counted as an abstention.`);
          return { seat: criticSeat, critique: null, abstained: true, error: String(err.message) };
        }
        const parsed = parseJson(cs.text);
        if (!parsed) {
          // An unreadable verdict is an abstention: it neither signs off nor
          // objects, and it cannot block the panel. It used to count as a
          // pass, which would have waved a truncated FAILED straight through.
          const why = classifyUnreadable(cs.usage, criticSeat.maxTokens);
          // v5 §1 candidate 4: the code is prepended, the diagnosis itself
          // is untouched - classifyUnreadable's three distinct reasons are
          // load-bearing (each one traces to a real incident on disk) and
          // this candidate changes what's printed, never what's diagnosed.
          say(`  ${labOf(criticSeat)}/${criticSeat.model}: [COUNCIL-E004] unreadable reply (${cs.usage.output} tokens out; ${why}) - counted as an abstention, not a sign-off.`);
          return { seat: criticSeat, critique: null, abstained: true };
        }
        const critique = normaliseCritique(parsed, say);
        say(`  ${labOf(criticSeat)}/${criticSeat.model}: ${critique.meets ? 'SIGNED OFF' : `${critique.failures.length} failure(s)`} - ${critique.verdict_line || ''}`);
        critique.failures.forEach(f => say(`    FAILED: ${f.criterion} - ${f.problem}`));
        return { seat: criticSeat, critique };
      };

      if (relay) {
        // Relay seats run one after another, in a fresh random order each
        // round so no lab is always the anchor, and earlier verdicts are
        // handed on anonymised so a seat can't defer to a name.
        for (const criticSeat of shuffle(config.seats.critics)) {
          const prior = verdicts.filter(v => v.critique).map((v, i) => ({ lab: `Reviewer ${String.fromCharCode(65 + i)}`, verdict_line: v.critique.verdict_line, failures: v.critique.failures }));
          verdicts.push(await reviewSeat(criticSeat, prior, log));
        }
      } else {
        // Blind seats see nothing of each other, so they run at the same
        // time. Each seat's log lines are buffered and flushed in seat order,
        // so the run log reads exactly as it did when they ran in sequence.
        const results = await Promise.all(config.seats.critics.map(async criticSeat => {
          const lines = [];
          const verdict = await reviewSeat(criticSeat, [], m => lines.push(m));
          return { verdict, lines };
        }));
        for (const { verdict, lines } of results) {
          lines.forEach(m => log(m));
          verdicts.push(verdict);
        }
      }

      // Each objection carries the lab that raised it, so the human review
      // step sees who said what rather than an anonymous merged list.
      const voting = verdicts.filter(v => v.critique);
      const abstained = verdicts.length - voting.length;
      const allFailures = voting.flatMap(v => v.critique.failures.map(f => ({ ...f, lab: labOf(v.seat) })));
      const allSignedOff = voting.length > 0 && voting.every(v => v.critique.meets === true);
      lastCritique = { meets: allSignedOff, failures: allFailures };
      // `objections` is why a seat declined, co-located with the decision itself.
      // The same failures also appear flattened in lastCritique.failures, tagged
      // with `lab`, because the reviser and the CLI want the union across the
      // panel. Both are built here from the same `voting` array in one pass, so
      // they cannot drift. Added 2026-09-11: a four-lab panel reading a run
      // folder concluded a holdout's reason was not machine-readable, because
      // signoff carried the verdict and nothing else - the join through
      // lastCritique.failures[].lab existed but was undiscoverable.
      signoff = verdicts.map(v => ({
        provider: labOf(v.seat), model: v.seat.model,
        signedOff: v.abstained ? null : v.critique.meets === true,
        objections: v.abstained ? null : v.critique.failures,
      }));

      history.push(`## Round ${round} panel\n${verdicts.map(v =>
        `- ${labOf(v.seat)}/${v.seat.model}: ${v.abstained ? 'abstained (unreadable reply)' : v.critique.meets ? 'signed off' : `${v.critique.failures.length} failure(s)`}`
      ).join('\n')}`);

      if (allSignedOff) {
        passed = true;
        log(abstained
          ? `  every lab that answered signed off (${abstained} abstained); stopping.`
          : `  every lab on the panel signed off; stopping.`);
        break;
      }

      if (round === maxRounds) {
        log(`  round cap (${maxRounds}) reached without unanimous signoff; open objections go into the report.`);
        break;
      }

      log(`\nRound ${round}: revise (union of everything any lab flagged)`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const revised = record(await invoke(reviserSeat, {
        system: R.reviserSystem(open),
        user: R.reviserUser({ request, criteria, draft, critique: { failures: allFailures }, proposals, board }),
        log, label: `revise-${round}`,
      })).text;
      const parsedRevise = parseDisputes(revised);
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach(reason => disputes.push({ round, reason }));
      passed = false;
    }
  } else {
    for (let round = 1; round <= maxRounds; round++) {
      const criticSeat = config.seats.critics[(round - 1) % config.seats.critics.length];
      log(`\nRound ${round}: critique`);
      const cs = record(await invoke(criticSeat, {
        system: R.criticSystem(open),
        user: R.criticUser({ request, criteria, draft }),
        log, label: `critique-${round}`,
      }));

      const parsed = parseJson(cs.text);
      if (!parsed) {
        // Previously logged "treating the round as a pass and stopping" while leaving `passed`
        // at its prior value and `lastCritique` untouched - the log claimed a pass that never
        // happened, and the report came out as passed:false with no recorded reason at all
        // (found for real 2026-09-10: three separate Sophi-A runs stopped exactly here, silent).
        // Deliberately NOT treated as a real pass - a critic's reply we can't parse might be
        // hiding a genuine objection, and this chain's whole value is not letting that slip
        // through. `passed` keeps whatever it already was (false unless an earlier round already
        // passed); what changes is that the report now says why, instead of nothing.
        log(`  critic reply could not be parsed as JSON even after repair attempts; stopping ` +
          `without a verdict from this critic - not a pass, not counted as an objection either.`);
        lastCritique = { meets: false, failures: [{
          criterion: '(critic reply unparseable)',
          problem: `${criticSeat.provider}/${criticSeat.model}'s round ${round} reply could not ` +
            `be parsed as JSON even after repair attempts - no verdict was recovered from it.`,
        }] };
        break;
      }
      const critique = normaliseCritique(parsed, log);
      lastCritique = critique;
      const failures = critique.failures;
      log(`  verdict: ${critique.meets ? 'MEETS' : `${failures.length} failure(s)`} - ${critique.verdict_line || ''}`);
      failures.forEach(f => log(`    FAILED: ${f.criterion} - ${f.problem}`));

      history.push(`## Round ${round} critique (${criticSeat.provider}/${criticSeat.model})\n${critique.verdict_line || ''}\n${failures.map(f => `- FAILED: ${f.criterion} - ${f.problem}`).join('\n')}`);

      if (critique.meets === true || failures.length === 0) {
        passed = true;
        if (stopOnPass) {
          log(`  a critic from a different lab passed it; stopping early rather than inventing work.`);
          break;
        }
      }

      if (round === maxRounds) {
        log(`  round cap (${maxRounds}) reached; the remaining failures go into the report, not another round.`);
        break;
      }

      log(`\nRound ${round}: revise`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const revised = record(await invoke(reviserSeat, {
        system: R.reviserSystem(open),
        user: R.reviserUser({ request, criteria, draft, critique }),
        log, label: `revise-${round}`,
      })).text;
      const parsedRevise = parseDisputes(revised);
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach(reason => disputes.push({ round, reason }));
      passed = false;
    }
  }

  // 3b. Post-signoff challenge (config.challenge: { enabled: true }), v7
  // item 5. `enabled` is the only key chain.js or chain-lint.js ever reads -
  // one challenge, re-opening one decision, for one extra round, hard-coded
  // right here rather than pulled from config. Runs once, after the
  // critic/revise rounds are done (passed or round-capped), never inside the
  // loop above - it is a distinct, narrower stage, not another review round.
  let challenge = null;
  if (config.challenge?.enabled === true) {
    log('\nStage: challenge (post-signoff, one decision, one round)');
    const challengerSeat = config.seats.challenger || config.seats.critics[0];
    const cs = record(await invoke(challengerSeat, {
      system: R.CHALLENGE_SYSTEM,
      user: R.challengeUser({ request, criteria, draft, signoff }),
      log, label: 'challenge',
    }));
    const parsed = parseJson(cs.text);
    if (parsed?.challenge === true && parsed.decision && parsed.evidence) {
      log(`  challenge raised against "${parsed.decision}" - evidence that would settle it: ${parsed.evidence}`);
      const reviserSeat = config.seats.reviser || config.seats.builder;
      const revised = record(await invoke(reviserSeat, {
        system: R.reviserSystem(open),
        user: R.reviserUser({
          request, criteria, draft,
          critique: { failures: [{ criterion: parsed.decision, problem: parsed.evidence, fix: '' }] },
        }),
        log, label: 'challenge-revise',
      })).text;
      const parsedRevise = parseDisputes(revised);
      draft = parsedRevise.draft;
      parsedRevise.disputes.forEach(reason => disputes.push({ round: 'challenge', reason }));
      challenge = {
        raised: true,
        by: labOf(challengerSeat),
        decision: parsed.decision,
        evidence_needed: parsed.evidence,
        reopened_rounds: 1,
      };
    } else {
      log('  no challenge raised; the signed-off draft stands.');
      challenge = { raised: false };
    }
  }

  // 4. Optional final edit: strips chain artifacts. Never adds material.
  if (config.seats.finalist) {
    log('\nStage: final edit');
    draft = record(await invoke(config.seats.finalist, {
      system: R.FINALIST_SYSTEM,
      user: R.finalistUser({ request, draft, history: history.join('\n\n') }),
      log, label: 'final',
    })).text;
  }

  // 5. Handoff (config.handoff): the file a build session reads first.
  let handoff = null;
  if (config.handoff) {
    log('\nStage: handoff');
    handoff = record(await invoke(config.seats.handoff || config.seats.builder, {
      system: R.HANDOFF_SYSTEM,
      user: R.handoffUser({ request, draft, planFile: config.handoffPlanFile || 'PLAN.md' }),
      log, label: 'handoff',
    })).text;
  }

  // Scoreboard: what each lab proposed and what the plan did with it. The
  // "built" column can only be filled after a build session; it is left to
  // the human on purpose (a part that reads well may not build).
  const scoreboard = proposals.length ? scoreProposals(proposals, draft) : null;
  if (scoreboard) {
    log('\nProposal scoreboard (built column: fill in after the build session)');
    for (const row of scoreboard.labs) log(`  ${row.lab.padEnd(12)} proposed ${row.proposed}  accepted ${row.accepted}  cut ${row.cut}  withdrawn ${row.withdrawn}  unaccounted ${row.unaccounted}`);
  }

  const ledger = proposals.length ? withdrawalLedger(proposals) : null;

  return {
    deliverable: draft,
    criteria,
    questions,
    skeleton,
    proposals,
    proposalPool,
    dropouts,
    board,
    debate,
    handoff,
    scoreboard,
    passed,
    lastCritique,
    signoff,
    challenge,
    disputes,
    history,
    stages,
    totals: summarise(stages),
    orphanSections: ledger?.orphanSections ?? [],
    withdrawalCycles: ledger?.withdrawalCycles ?? 0,
  };
}
