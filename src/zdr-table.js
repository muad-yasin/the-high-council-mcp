// 0.8.4 zero retention (the optional setting): the pure part that makes the dated table of src/zdr-hosts.json from the rows of OpenRouter's zero-data-retention endpoint list (https://openrouter.ai/api/v1/endpoints/zdr, public, no key).
// Contract (pure; no I/O):
//   zdrTableOf(rows, asOf) -> { asOf, models: { '<OpenRouter model id>': { hosts: { '<endpoint slug>': { in, out } }, safety_retention: m } } }, the ids and the slugs sorted. `rows` is the list's `data` array: one row per endpoint with `model_id`, `tag` (the endpoint
//     slug, `provider[/variant][/region][/tier]`), `pricing.prompt` / `pricing.completion` (USD per token, as strings) and `safety_retention` (true when OpenRouter says the host may keep prompts to prevent abuse).
//     `hosts` are the endpoints a request may be sent to when the setting is on: those WITHOUT safety retention, with their prices in USD per million tokens (the start check compares them with a seat's price limit). `safety_retention` counts the others.
//     An endpoint of the Open Inference host is not counted at all (this project never routes to it: src/host-block.js). A PROVIDER (the first segment of a slug) that has any endpoint with safety retention anywhere in the list (today only google-vertex)
//     is not allowed at all, for any model: OpenRouter's request field `only` matches a slug as a prefix, so naming a slug of such a provider could let one of its endpoints with safety retention through (that rule also covers a slug that is a prefix of one).
//     What stays open: a new endpoint with safety retention under an allowed slug of a provider that has none today would still match that slug as a prefix; only the account-level setting of OpenRouter (zero-data-retention only) closes that, and the age limit of
//     the table (src/zero-retention.js) bounds it.
//     A model with no endpoint at all is absent: "not in the table" means "no zero-retention host on `asOf`".
// The list itself is the evidence; the dated table is a copy of what it says, written by scripts/refresh-zdr-table.mjs (which takes the list from a file, so the table can be re-derived and checked from the saved list).
import { OPEN_INFERENCE } from './host-block.js';
import { DENIED_MODEL } from './denied-models.js';      // the ONE list of models this harness never seats (chain-lint's denied-model rule): no id on it is ever in the table

const perMtok = s => { const n = Number(s) * 1e6; return Number.isFinite(n) ? Number(n.toPrecision(10)) : null; };
const isOpenInference = tag => typeof tag === 'string' && tag.split('/')[0] === OPEN_INFERENCE;

export function zdrTableOf(rows, asOf) {
  if (!Array.isArray(rows)) throw new TypeError('zdrTableOf: the endpoint list must be an array of rows');
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new TypeError('zdrTableOf: asOf must be a date like 2026-11-10');
  const byModel = new Map();
  for (const r of rows) {
    if (!r || typeof r.model_id !== 'string' || r.model_id === '' || typeof r.tag !== 'string' || r.tag === '' || isOpenInference(r.tag)) continue;
    if (DENIED_MODEL.test(r.model_id)) continue;      // 0.8.4 (owner gate "no xAI/Grok, ever"): a denied model is not in the table, so no setting, refreshed list or error line can name one. Its rows still count for the providers that keep prompts (the `tainted` loop below reads every row): dropping them must never allow a host that was not allowed
    const m = byModel.get(r.model_id) ?? { allowed: new Map(), others: [] };
    if (r.safety_retention === true) m.others.push(r.tag); else m.allowed.set(r.tag, { in: perMtok(r.pricing?.prompt), out: perMtok(r.pricing?.completion) });
    byModel.set(r.model_id, m);
  }
  const sorted = a => [...a].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  const tainted = new Set();      // the providers (first segment of a slug) that have an endpoint with safety retention anywhere in the list
  for (const r of rows) if (r && r.safety_retention === true && typeof r.tag === 'string' && r.tag !== '') tainted.add(r.tag.split('/')[0]);
  const models = {};
  for (const [id, m] of sorted(byModel.entries())) {
    const hosts = {};
    for (const [tag, price] of sorted(m.allowed.entries())) if (!tainted.has(tag.split('/')[0])) hosts[tag] = price;
    models[id] = { hosts, safety_retention: m.others.length };
  }
  return { asOf, models };
}

/**
 * The invariant the table rests on, as a check over the list's rows: every allowed slug of a model, matched the way OpenRouter's `only` matches (the slug itself, or the slug and a `/` and more), must match NO endpoint of the same model that is not allowed (safety retention,
 * or Open Inference). -> [] when it holds, else one { model, slug, other } per breach. The provider rule of zdrTableOf holds it by construction (an endpoint that shares a slug's prefix shares its provider); the script checks it on every table it makes, so a change to either
 * fails there and not at a person's start.
 */
export function allowedSlugsThatMatchOthers(rows, table) {
  const out = [];
  const byModel = new Map();
  for (const r of rows ?? []) if (r && typeof r.model_id === 'string' && typeof r.tag === 'string' && (r.safety_retention === true || isOpenInference(r.tag))) (byModel.get(r.model_id) ?? byModel.set(r.model_id, []).get(r.model_id)).push(r.tag);
  for (const [model, row] of Object.entries(table?.models ?? {})) {
    for (const slug of Object.keys(row.hosts ?? {})) for (const other of byModel.get(model) ?? []) if (other === slug || other.startsWith(`${slug}/`)) out.push({ model, slug, other });
  }
  return out;
}

/**
 * The refreshed list, NARROW-ONLY (the guard of Muad's pick (b) for an old list: "a file the project can write must never add an allowed host", the pattern of pricing.user.json's never-lower rule): what is kept is the SHIPPED table intersected with the fetched one, per model
 * and per slug. A model or a slug that is not in both is not in the result, so the result can never allow a host the shipped table does not; prices and the count of endpoints with safety retention are the fresh ones; the date is the fetched one. A host OpenRouter added
 * after the shipped table's date is not used until a release ships a newer table (fail closed); a model whose hosts moved has none left until then. Applied when the list is made AND again when it is read, so a hand-edited file cannot add a host either.
 */
export function narrowTable(shipped, fresh) {
  const models = {};
  for (const [id, row] of Object.entries(shipped?.models ?? {})) {
    const f = fresh?.models?.[id];
    if (!f || typeof f.hosts !== 'object' || f.hosts === null) continue;
    const hosts = {};
    for (const slug of Object.keys(row.hosts ?? {})) if (Object.hasOwn(f.hosts, slug)) hosts[slug] = f.hosts[slug];
    models[id] = { hosts, safety_retention: Number.isInteger(f.safety_retention) ? f.safety_retention : 0 };
  }
  return { asOf: fresh?.asOf, models };
}

/** What is wrong with a table's shape, or null: { asOf: 'YYYY-MM-DD', models: { id: { hosts: { slug: { in, out } }, safety_retention: n } } } with prices as numbers or null. */
export function tableShapeProblem(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return 'it is not an object';
  if (typeof t.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.asOf) || Number.isNaN(Date.parse(`${t.asOf}T00:00:00Z`))) return 'it has no date';
  if (!t.models || typeof t.models !== 'object' || Array.isArray(t.models)) return 'it has no models';
  for (const [id, r] of Object.entries(t.models)) {
    if (!r || typeof r !== 'object' || !r.hosts || typeof r.hosts !== 'object' || Array.isArray(r.hosts)) return `the model ${id} has no hosts object`;
    if (!Number.isInteger(r.safety_retention) || r.safety_retention < 0) return `the model ${id} has no count of endpoints with safety retention`;
    for (const [slug, h] of Object.entries(r.hosts)) if (!h || typeof h !== 'object' || !(h.in === null || (typeof h.in === 'number' && h.in >= 0)) || !(h.out === null || (typeof h.out === 'number' && h.out >= 0))) return `the host ${slug} of ${id} has no prices`;
  }
  return null;
}

