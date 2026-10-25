// The OpenRouter rows of the reasoning table, built from the router's public model list (scripts/refresh-reasoning-table.mjs calls this; a module that reads no file, so a test can drive it with a small list).
// A row is NEVER dropped (C&C ruling 23 Oct 2026): the README promises the high default "for any model the table has a field for", and a user's own chain may seat any model that has a row. So:
//   - an id on the router list is refreshed from it, whether or not a shipped chain seats it;
//   - an id that has left the list keeps its last row, untouched, with a dated `notOnRouter` note (the first date it was seen missing is kept);
//   - an id with no earlier row that is seated or named by a route and is missing from the list is reported as `missing` (the script writes an auto "unlisted" entry for it, src/table-reasons.js).
// `labLimits` maps an id to the lab's own output limit where the router's number is not the lab's (the script's LAB_OUTPUT_LIMITS). A value is a NUMBER (the limit), or { limit: null, note } for a model whose lab pages state
// no limit: the row then holds maxOutput null and the note as `maxOutputNote`, never the router's number. Or { limit: <number>, note }: the OWNER'S PICK where the lab publishes none (0.8.3, deepseek-v4-pro-0813): the row
// holds that number and the note, which says it is the owner's pick and not a lab figure. The test is `id in labLimits`, not the value, so a null is not mistaken for "no entry".
// a kept row's old maxOutputNote goes when its id has a lab entry now (a null that became a number must not keep the note)
const withoutNote = ({ maxOutputNote, ...rest }) => rest;
function labFieldsOf(id, value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { maxOutput: value };
  const noted = value && typeof value === 'object' && typeof value.note === 'string' && value.note.trim();
  if (noted && value.limit === null) return { maxOutput: null, maxOutputNote: value.note };
  if (noted && typeof value.limit === 'number' && Number.isFinite(value.limit)) return { maxOutput: value.limit, maxOutputNote: value.note };
  throw new Error(`lab output limit for ${id} must be a number, { limit: null, note: "..." } or { limit: <number>, note: "..." } (an owner's pick), got ${JSON.stringify(value)}`);
}
// 0.8.3: the router's max_completion_tokens is 0.9 x the context window for some models (92 of the 469 on the 2026-10-23 list): a figure the router derived, not one a lab published (the owner's rule of 2026-10-23: never the
// router's 0.9 x context). An id on the list whose figure is within 1 of floor/round(0.9 x context_length) and that has no labLimits entry would land in the table as a number, so the build REFUSES it (fail closed, before
// anything is written). A row whose id has left the list keeps its old number and cannot be checked here: the list gives no context length for it.
const derivedFigure = m => { const max = m?.top_provider?.max_completion_tokens, ctx = m?.context_length; return Number.isFinite(max) && Number.isFinite(ctx) && Math.abs(max - 0.9 * ctx) <= 1; };
export function buildOpenRouterRows({ ids, byId, previous = {}, asOf, labLimits = {} }) {
  const rows = {}, missing = [], keptOffList = [], derived = [];
  const want = new Set([...ids, ...Object.keys(previous)]);
  for (const id of [...want].sort()) {
    const m = byId.get(id);
    if (!m) {
      if (previous[id]) { rows[`openrouter/${id}`] = { ...(id in labLimits ? withoutNote(previous[id]) : previous[id]), ...(id in labLimits ? labFieldsOf(id, labLimits[id]) : {}), notOnRouter: previous[id].notOnRouter ?? `not in OpenRouter's public list on ${asOf}; these are its last numbers, kept` }; keptOffList.push(id); }
      else missing.push(id);
      continue;
    }
    if (!(id in labLimits) && derivedFigure(m)) derived.push(id);
    const r = m.reasoning || null;
    const takes = (m.supported_parameters || []).includes('reasoning');
    const efforts = r?.supported_efforts || null;
    const offers = takes && (!efforts || efforts.includes('high'));
    rows[`openrouter/${id}`] = {
      form: offers ? 'openrouter-effort' : null,
      ...(id in labLimits ? labFieldsOf(id, labLimits[id]) : { maxOutput: m.top_provider?.max_completion_tokens ?? null }),
      defaultEffort: r?.default_effort ?? null,
      supportedEfforts: efforts,
      mandatory: r?.mandatory ?? null,
      source: 'openrouter-models',
    };
  }
  if (derived.length) throw new Error(`the router's output figure is 0.9 x the context window (a derived number, not a published limit) for ${derived.join(', ')}; the table was not written. Give each id an entry in LAB_OUTPUT_LIMITS (scripts/refresh-reasoning-table.mjs): the lab's number with the page it is on, an owner's pick { limit, note }, or { limit: null, note } with the pages read and the date.`);
  return { rows, missing, keptOffList };
}
