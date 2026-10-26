// 0.8.3 harness (a): who answered a session seat, as the answerer DECLARED it. Never verified.
//
// A session seat (`provider: "external"`) is answered by whatever coding-agent session the person runs: MCP only hands the server the client's
// handshake name and the caller's own arguments, nothing from the model itself, so everything here is a statement, not a measurement. The record
// lives in `<label>.usage.json` (the run folder is the database), reaches `report.json` as `stages[].answered_by`, and feeds ONE reader: the
// company tally below, which only the report and the BOARD show. It never steers a stage label, a cache key, an approval, a dollar or a
// resume (labOf/seatKeyOf stay the control flow; test/answered-by-read-sites.test.js pins the only files allowed to read the field).
import { blankHiddenChars } from './hidden-chars.js';

const NAME_MAX = 200;      // the same cap send-path.js puts on a client name it records
const VERSION_MAX = 40;
const MODEL_MAX = 100;
export const NO_MODEL_SEAT = 'claude-code-session';   // the seat model that asks for no particular model

/** One self-declared string made safe to store and print: hidden and control characters blanked, runs of space collapsed, capped; null when nothing is left. */
export function cleanDeclared(value, max) {
  if (typeof value !== 'string') return null;
  const s = blankHiddenChars(value).replace(/ +/g, ' ').trim().slice(0, max).trim();
  return s || null;
}

/**
 * The record `submit_stage` stores. `clientInfo` is the handshake's { name, version } (or nothing); `model` is the answerer's own statement of the
 * model that wrote the text. `declared_by` says which parts were declared: 'caller' (a model was passed), 'client' (only the client's name),
 * 'none' (neither). Nothing here is checked against anything.
 */
export function declaredAnswerer({ clientInfo = null, model = null } = {}) {
  const name = cleanDeclared(clientInfo?.name, NAME_MAX);
  const version = cleanDeclared(clientInfo?.version, VERSION_MAX);
  const declaredModel = cleanDeclared(model, MODEL_MAX);
  return {
    client: name || version ? { name, version } : null,
    model: declaredModel,
    declared_by: declaredModel ? 'caller' : name || version ? 'client' : 'none',
  };
}

/** A stored `answered_by` read back: the file is project-writable data, so it is cleaned again and anything of the wrong shape reads as absent. */
function readStored(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v.client && typeof v.client === 'object' && !Array.isArray(v.client)
    ? { name: cleanDeclared(v.client.name, NAME_MAX), version: cleanDeclared(v.client.version, VERSION_MAX) } : null;
  const model = cleanDeclared(v.model, MODEL_MAX);
  const client = c && (c.name || c.version) ? c : null;
  return { client, model, declared_by: model ? 'caller' : client ? 'client' : 'none' };
}

/**
 * The fields the stage row of an EXTERNAL seat gets on replay (chain.js, the cache-hit row): what the seat asked for and what its answer's record
 * declared. `{}` for every other seat, so a stage that is not a session seat keeps its row byte for byte. A hand-written `<label>.md` has no usage
 * file, so no `answered_by` (read later as "not declared").
 */
export function answerRecordOf(hit, seat) {
  if (seat?.provider !== 'external') return {};
  const stored = readStored(hit?.answered_by);
  return { asked_for: typeof seat.model === 'string' ? seat.model : null, ...(stored ? { answered_by: stored } : {}) };
}

// ---- the one model-to-company table (test/plan-tiers.test.js imports it; the typed "N judges from M companies" counts are companies by model id) ----

const PREFIX_ALIAS = { 'deepseek-ai': 'deepseek', 'meta-llama': 'meta', mistral: 'mistralai' };
// A model named without a router prefix ("claude-opus-5-5", "gpt-6.1", "subscription:opus-5.5"): the family decides. First match wins. Anything else is NOT in the table and is never guessed.
const FAMILIES = [
  [/^(claude|opus|sonnet|haiku|fable)/, 'anthropic'],
  [/^(gpt|chatgpt|codex|o\d)/, 'openai'],
  [/^(gemini|gemma)/, 'google'],
  [/^deepseek/, 'deepseek'],
  [/^qwen/, 'qwen'],
  [/^(glm|chatglm)/, 'z-ai'],
  [/^(kimi|moonshot)/, 'moonshotai'],
  [/^minimax/, 'minimax'],
  [/^(mistral|mixtral|codestral|magistral)/, 'mistralai'],
  [/^(llama|muse-spark)/, 'meta'],
  [/^(hy\d|hunyuan)/, 'tencent'],
  [/^mimo/, 'xiaomi'],
  [/^step-/, 'stepfun'],
  [/^grok/, 'x-ai'],
];

/** The company behind a model name, or null when the table has no row. A "vendor/model" id answers with its vendor (aliased: deepseek-ai, meta-llama, mistral). */
export function companyOfModel(model) {
  if (typeof model !== 'string') return null;
  const m = model.trim().toLowerCase().replace(/^subscription:/, '');
  if (!m) return null;
  const slash = m.indexOf('/');
  if (slash > 0) { const v = m.slice(0, slash); return PREFIX_ALIAS[v] ?? v; }
  for (const [re, company] of FAMILIES) if (re.test(m)) return company;
  return null;
}

/** The company of a chain seat as the chain names it. `mock` is none; a session seat that asks for no model (claude-code-session) is none. */
export function companyOfSeat(seat) {
  if (!seat || seat.provider === 'mock' || seat.model === NO_MODEL_SEAT) return null;
  return companyOfModel(seat.model);
}

// ---- the report-side reader ----

/** A stage of the review panel (the judges): its company counts toward the panel's tally. Writer stages (build, revise, handoff) do not. */
const isPanelStage = row => typeof row?.label === 'string' && row.label.startsWith('panel-');

/** One session-seat stage row -> its entry: what it asked for, what was declared, the company if one can be named, and a status. */
function entryOf(row) {
  const asked = typeof row.asked_for === 'string' ? row.asked_for : null;
  const a = row.answered_by ?? null;
  const askedCompany = companyOfSeat({ provider: 'external', model: asked });
  const declared = a?.model ?? null;
  const company = declared ? companyOfModel(declared) : null;
  // A seat that asks for no model (claude-code-session) is a design fact: it is never "different" and never "not declared". Whether its company is known still shows in `company`.
  const noModelAsked = !askedCompany && (asked === NO_MODEL_SEAT || asked === null);
  let status;
  if (noModelAsked) status = 'no-model-asked';
  else if (!declared) status = 'not-declared';
  else if (!company) status = 'not-in-table';
  else status = company === askedCompany ? 'as-seated' : 'different';
  return { label: row.label, seat_lab: row.lab ?? null, asked_for: asked, answered_by: a, company, status, panel: isPanelStage(row) };
}

/**
 * report.json's `roster_answers` (and the BOARD section): one entry per answered session-seat stage, plus a company tally over the review panel's
 * stages (`panel-*`) as RECORDED: a model-API seat counts as its model's company, a session seat as the company of the model its answer declared,
 * and a session seat with no usable declaration is counted as unverified, never as the lab the chain names. `design_companies` is the same
 * panel by what the chain asked for. null when the run had no session-seat stage.
 */
export function rosterAnswersOf(stages) {
  if (!Array.isArray(stages)) return null;
  const session = stages.filter(s => s && s.provider === 'external' && 'asked_for' in s);
  if (!session.length) return null;
  const seats = session.map(entryOf);
  const panel = stages.filter(s => s && isPanelStage(s) && s.provider !== 'harness');
  const design = new Set(), recorded = new Set(), unverified = new Set();
  for (const s of panel) {
    if (s.provider === 'external') {
      const e = seats.find(x => x.label === s.label);
      const d = companyOfSeat({ provider: 'external', model: s.asked_for });
      if (d) design.add(d);
      if (e?.company) recorded.add(e.company); else unverified.add(s.lab ?? s.label);
    } else {
      const c = companyOfSeat(s);
      if (c) { design.add(c); recorded.add(c); }
    }
  }
  return {
    design_companies: design.size,
    recorded_companies: recorded.size,
    unverified_seats: unverified.size,
    seats,
    note: 'As declared by the client and the session; never verified.',
  };
}

// ---- the sentences (A-DRAFT: harness a; S3 is approved verbatim by Muad's "Q2: yes" of 23 Okt 2026, S4/S5 are drafts whose behaviour he approved with "Q1: a") ----

/** S3, in the NEEDS file (and so in external_prompt's reply, which returns that file): the model the seat asks for. Nothing for a seat that asks for none. */
export const askedForSentence = model => (typeof model === 'string' && model.trim() && model !== NO_MODEL_SEAT
  ? `This seat is asked for ${model}. If a different model answers, say so with answered_model.\n\n` : '');

/**
 * S4, once per stage at its first replay: the answer says it came from a model of another company than the seat asks for. null for every other status.
 * The independence clause is only said for a panel stage, where the company counts toward the tally; for a writer stage the line states the fact only.
 */
export function answerNoteOf(row) {
  if (!row || row.provider !== 'external' || !('asked_for' in row)) return null;
  const e = entryOf(row);
  if (e.status !== 'different') return null;
  const fact = `!! ANSWERED BY A DIFFERENT MODEL: ${e.label} is seated as ${e.asked_for} and the answer says ${e.answered_by.model}.`;
  return e.panel ? `${fact} Independence below is counted from what the answerers declared, not from the chain's names.` : `${fact} It is recorded as declared.`;
}

/** S5, once per run in the summary: how many JUDGE seats of the review panel have no company known, because no answer declared a model or the table has no row for it (the number the BOARD closes with). Writer seats are not counted. null when none. */
export function undeclaredNoteOf(stages) {
  const n = rosterAnswersOf(stages)?.unverified_seats ?? 0;
  return n ? `${n} judge seat${n === 1 ? ' was' : 's were'} answered by a session that declared no model the harness knows; ${n === 1 ? 'its company is' : 'their companies are'} shown as not known.` : null;
}

/** The model a NEEDS file's header says its seat asks for (S3), or null. Only the header above "## System prompt" is read: the prompts below it carry model text. */
export function askedForOfNeeds(text) {
  if (typeof text !== 'string') return null;
  const head = text.split('\n## System prompt')[0];
  // the value lands in instruction position in the dispatch bundle, so it is held to a model-id shape and the same cap as a declared model
  const m = /^This seat is asked for ([A-Za-z0-9._:/-]{1,100})\. If a different model answers, say so with answered_model\.$/m.exec(head);
  return m ? m[1] : null;
}
