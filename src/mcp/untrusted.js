// Which MCP tools hand back text from a run folder, and the wrapping that text gets (0.8.1 plan M5 Work 2, decided rule 5b,
// audit A2: read_run_file returned model text unwrapped).
//
// Contract.
//   TOOL_TRUST: every tool this server registers, by name -> one of
//     { wrap: 'text' }                  the whole result is run-folder text: the harness notice, markers with a random
//                                       per-call id, hidden characters removed and counted (src/return-path.js
//                                       untrustedFileResult);
//     { wrap: 'fields', fields: [...] } a JSON result with run-folder text in the named fields: the fields are named in
//                                       `untrusted_fields` with the notice, hidden characters removed and counted
//                                       (markUntrustedFields). JSON quoting is the boundary here, so the JSON stays parseable
//                                       for every existing reader; a result of the same tool that is not JSON (run_status
//                                       brief: true) is wrapped as text;
//     { wrap: 'own', reason }           the handler wraps its model text itself (council_advise's answer, adviceResult);
//     { wrap: false, reason }           no run-folder text in the result, with the reason.
//   guardToolRegistration(server): from this call on, registering a tool that is not in TOOL_TRUST throws, and every
//     registered handler's result passes through wrapResult. One line in src/mcp/server.js, before the first tool; the
//     advice tools register through the same server object, so they are covered too.
//   wrapResult(name, result) -> the result as the client receives it. An error result (isError) and a result that already
//     carries the trust marker are returned unchanged.
// The file on disk is never changed. This is a cue and a hygiene step, never a filter: see src/return-path.js.
import { untrustedFileResult, markUntrustedFields, TRUST_META_KEY } from '../return-path.js';

// run.log and a CLI child's log can carry a provider's error body or a seat's reply quoted in an error, so log text is
// treated as run-folder text wherever a tool returns it.
export const TOOL_TRUST = Object.freeze({
  list_chains: { wrap: false, reason: 'chain names, descriptions and flags from chain files (the package\'s or the user\'s own), not run-folder output' },
  dry_run: { wrap: false, reason: 'prices and seat names computed by the harness from a chain file; no model has written anything' },
  start_run: { wrap: 'fields', fields: ['logTail'] },
  external_prompt: { wrap: 'fields', fields: ['prompt'] },
  prepare_stage_prompt: { wrap: false, reason: 'returns the path of the bundle it wrote and the stage label, never the bundle\'s text' },
  submit_stage: { wrap: 'fields', fields: ['logTail'] },
  resume_run: { wrap: 'fields', fields: ['logTail'] },
  spend_report: { wrap: false, reason: 'run ids, chain names and dollar sums derived from usage files; no run text' },
  verdict_stats: { wrap: false, reason: 'counts and rates per chain and lab derived from report.json; no run text' },
  metrics_report: { wrap: false, reason: 'rates and counts derived from report.json and HANDOFF.md; no run text' },
  // signoff: each critic's objections and pass reason, model-written (M5 review D2).
  list_runs: { wrap: 'fields', fields: ['lastLogLines', 'signoff'] },
  run_status: { wrap: 'fields', fields: ['lastLogLines', 'keyLines', 'signoff'] },
  read_run_file: { wrap: 'text' },
  plan_outline: { wrap: 'fields', fields: ['sections', 'ledger'] },
  write_task: { wrap: false, reason: 'returns the path written and a word count of the caller\'s own text' },
  council_quote: { wrap: false, reason: 'returns the preview of the caller\'s own brief, masked, before anything is sent; no model has written anything' },
  council_advise: { wrap: 'own', reason: 'a settled answer is wrapped by adviceResult (notice, random-id markers, untrusted_fields); every other outcome is harness text, except a failed start\'s CLI log tail, from which hidden characters are removed' },
});

const marked = result => !!result?._meta?.[TRUST_META_KEY];

function markObject(obj, fields) {
  const present = fields.filter(f => obj && typeof obj === 'object' && obj[f] !== undefined && obj[f] !== null);
  return present.length ? markUntrustedFields(obj, present) : obj;
}

export function wrapResult(name, result) {
  const rule = TOOL_TRUST[name];
  if (!rule) throw new Error(`MCP tool ${name} has no entry in TOOL_TRUST (src/mcp/untrusted.js)`);
  if (!result || result.isError || marked(result) || !rule.wrap || rule.wrap === 'own') return result;
  const blocks = result.content || [];
  // Only text() results are built by this server; anything else would pass unmarked, so it is refused loudly (fail closed).
  if (blocks.length !== 1 || blocks[0].type !== 'text') throw new Error(`MCP tool ${name} returned a result src/mcp/untrusted.js cannot mark (${blocks.length} block(s)); classify it as 'own' and wrap it in its handler`);
  const raw = blocks[0].text;
  if (rule.wrap === 'text') return untrustedFileResult(raw, {});
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  // A text answer from a 'fields' tool (run_status brief: true returns the regenerated RESUME.md) is run-folder text as a whole.
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) return untrustedFileResult(raw, {});
  const out = Array.isArray(parsed) ? parsed.map(x => markObject(x, rule.fields)) : markObject(parsed, rule.fields);
  const touched = Array.isArray(out) ? out.some(x => x?.untrusted_fields) : !!out?.untrusted_fields;
  if (!touched) return result;
  return { ...result, content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], _meta: { ...(result._meta || {}), [TRUST_META_KEY]: { trust: 'untrusted_model_output', fields: rule.fields } } };
}

/** Every tool registered on `server` after this call must be classified; its results pass through wrapResult. */
export function guardToolRegistration(server) {
  const wrapHandler = (name, args) => {
    if (!Object.hasOwn(TOOL_TRUST, name)) throw new Error(`MCP tool ${name} is not classified in src/mcp/untrusted.js TOOL_TRUST: say whether it returns run-folder text before registering it`);
    const i = args.length - 1;
    const handler = args[i];
    if (typeof handler !== 'function') throw new Error(`MCP tool ${name}: no handler to wrap`);
    const copy = [...args];
    copy[i] = async (...a) => wrapResult(name, await handler(...a));
    return copy;
  };
  const tool = server.tool.bind(server);
  const registerTool = server.registerTool.bind(server);
  server.tool = (name, ...rest) => tool(name, ...wrapHandler(name, rest));
  server.registerTool = (name, ...rest) => registerTool(name, ...wrapHandler(name, rest));
  return server;
}
