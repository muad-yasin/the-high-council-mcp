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
//     { wrap: 'own', reason }           the handler wraps its model text itself (no registered tool uses this class since 0.8.4 removed council_advise; it stays as the way to say so);
//     { wrap: false, reason }           no run-folder text in the result, with the reason.
//   guardToolRegistration(server): from this call on, registering a tool that is not in TOOL_TRUST throws, and every
//     registered handler's result passes through wrapResult. One line in src/mcp/server.js, before the first tool; the
//     advice tools register through the same server object, so they are covered too.
//   wrapResult(name, result) -> the result as the client receives it. A result that already carries the trust marker is returned
//     unchanged. An error result (isError) of ANY tool, whatever its class, is marked as text (0.8.4 F3; before, it was returned
//     unchanged, so a refusal that quoted a file name or a file's words reached the agent unmarked). Besides a tool's own fields,
//     every JSON answer of every tool except an 'own' one has its `error` marked (ALWAYS_MARKED). Unknown origin = marked as a whole.
//   The one exception, a site that COMPOSED its sentence: it writes the value read from the run folder or the work folder through fragment() (src/return-path.js), which puts the markers of a file
//     around that value only, or claims a field of its own words with claimComposed(key, that exact sentence) (a claim covers the exact string it was made for, never the rest of the call); the sentence then stays the harness's own and only the fragment is marked (the notice follows as one more block in an
//     error result, as `untrusted_fragment_notice` in a JSON answer). A site composing a sentence with a run-folder or work-folder value either writes the fragment through the writer and claims it, or leaves
//     the result to the default; never a bare claim (a claim without the string it covers records nothing, so the result stays under the default; test/mcp-untrusted-errors.test.js and test/mcp-untrusted-fragments.test.js drive every reworked site).
//   A future text key is listed by hand: a key nobody listed, in an answer with none of the listed keys, is returned as it is (the one pass-through left; the README does not call it a limit, it is a maintenance rule).
// The file on disk is never changed. This is a cue and a hygiene step, never a filter: see src/return-path.js.
import { untrustedFileResult, markUntrustedFields, TRUST_META_KEY, inToolCall, currentCall, holdsFragment, isClaimed, fragmentNotice } from '../return-path.js';
import { treeStatusTrustRule } from './tree-status.js';
import { treeDecideTrustRule } from './tree-decide.js';
import { stopDecideTrustRule } from './stop-decide.js';

// run.log and a CLI child's log can carry a provider's error body or a seat's reply quoted in an error, so log text is
// treated as run-folder text wherever a tool returns it.
export const TOOL_TRUST = Object.freeze({
  list_chains: { wrap: false, reason: 'chain names, descriptions and flags from chain files (the package\'s or the user\'s own), not run-folder output' },
  dry_run: { wrap: false, reason: 'prices and seat names computed by the harness from a chain file; no model has written anything' },
  start_run: { wrap: 'fields', fields: ['logTail', 'stop', 'lock_holder', 'decision', 'decisions', 'next'] },   // 'stop': the stop sentence read from STOPPED-<cause>.json (exit 23), a project-writable file
  external_prompt: { wrap: 'fields', fields: ['prompt', 'stage', 'waiting', 'answerWith', 'state', 'claim'] },   // 0.8.4 F3: stage labels are the file names NEEDS-<label>.md (any text), `state` can carry a STOPPED-budget.json value, `claim` the claim file's holder names
  prepare_stage_prompt: { wrap: 'fields', fields: ['written', 'stage', 'label', 'waiting', 'repairs', 'state'] },   // 0.8.4 F3: never the bundle's text, but the stage label (a NEEDS-<label>.md file name, any text) is repeated into `written`, `stage`, `label`, `waiting`, `repairs`, and `state` can carry a STOPPED-budget.json value
  submit_stage: { wrap: 'fields', fields: ['logTail', 'stop', 'lock_holder', 'decision', 'decisions', 'next', 'written', 'waiting', 'waitingFor', 'warnings', 'note'] },   // 'lock_holder': submit_stage, repair_reply and start_run's limit flow spread the result of resume(), which carries the lock file's holder when a lock blocks the resume (CR-RB-001)
  repair_reply: { wrap: 'fields', fields: ['error', 'logTail', 'stop', 'lock_holder', 'decision', 'decisions', 'next', 'stage', 'written', 'waiting', 'note'] },   // 'error': a refused repair quotes the seat's reply and the repair where they first differ (src/near-json.js repairAcceptance), model-written text
  resume_run: { wrap: 'fields', fields: ['logTail', 'stop', 'relayed', 'lock_holder', 'raised', 'decision', 'decisions', 'next'] },   // 'raised' (#19): the outcome of the raise the PERSON typed in the dialog, whose `reason` (a closed raise) is read back from the run's gate ledger like 'relayed''s; 'relayed' (H10): the outcome of a relayed raise, whose `reason` is read back from the run's gate ledger, a project-writable file, like `stop`; 'lock_holder' (CR-RB-001): the pid, host and time read from the run's lock file, a project-writable file
  spend_report: { wrap: 'fields', fields: ['runs'] },   // 0.8.4 F3: runs[].chain is read raw from report.json (or advice.meta.json), a project-writable file; the sums and counts around it are numbers
  verdict_stats: { wrap: 'fields', fields: ['chains', 'labs', 'largestPrompts'] },   // 0.8.4 F3: chain and lab names are read raw from report.json, and the prompt rows carry .md file names and the raw label of a stage
  metrics_report: { wrap: 'fields', fields: ['consensusInducedRegression'] },   // 0.8.4 F3: its cases and exclusions carry a debate reply id as report.json holds it
  // signoff: each critic's objections and pass reason, model-written (M5 review D2).
  // Audit fix cnc-mcp-security F3: every other string a run folder lends the summary is named too (label from run.json, chain and task from report.json or the log, the state sentence, the security gate, waitingFor
  // and the progress events from stage-log.jsonl): hidden characters are removed from them and they are named untrusted, like the log lines.
  list_runs: { wrap: 'fields', fields: ['lastLogLines', 'signoff', 'label', 'chain', 'task', 'state', 'securityGate', 'waitingFor', 'tree', 'resumable', 'files', 'budget', 'scoreboard'] },   // 0.8.4 F3: 'files' = the run folder's file names, 'budget' = STOPPED-budget.json / report.json / run.json values, 'scoreboard' = report.json's lab names; 'resumable': its stoppedAt carries the stop marker, whose reason can quote a provider's refusal (exit 24)
  // run_status.in_flight (0.8.4): [{ label, seat, since }] of the paid calls a running run has sent. The labels and seat keys are read back from spend-reservations.jsonl, a project-writable run-folder file, so the field is listed here like every other string a run folder lends the summary.
  run_status: { wrap: 'fields', fields: ['lastLogLines', 'keyLines', 'signoff', 'label', 'chain', 'task', 'state', 'securityGate', 'waitingFor', 'progress', 'tree', 'resumable', 'in_flight', 'files', 'budget', 'scoreboard'] },
  // the field list is the output builder's own (src/mcp/tree-status.js), so the builder and its classification cannot drift
  tree_status: treeStatusTrustRule(),
  tree_decide: treeDecideTrustRule(),
  pause_run: { wrap: 'fields', fields: ['error'] },   // 0.8.4 16c-MCP: harness sentences and numbers; `error` is listed because a refusal can carry a file error from the run folder (written here, not imported from src/mcp/pause.js: that import would make this module reach the gate ledger)
  stop_decide: stopDecideTrustRule(),   // 0.8.4 D5a: the quote (the run's stop sentence and objection texts), a refusal, and what resume() spreads (logTail, stop, lock_holder)
  price_raise: { wrap: 'fields', fields: ['text', 'refusal'] },   // the quote carries a host name from OpenRouter's public list (cleaned of control characters, cut at 60) and a refusal can carry a file error
  read_run_file: { wrap: 'text' },
  plan_outline: { wrap: 'fields', fields: ['sections', 'ledger'] },
  write_task: { wrap: false, reason: 'returns the path written and a word count of the caller\'s own text' },
  // 0.8.2 item 6d: the obligations are model-drafted words and the requests are the words of whoever filed them; both are returned as untrusted fields.
  contract_read: { wrap: 'fields', fields: ['obligations', 'requests'] },
  contract_amend: { wrap: false, reason: 'returns the request number, the version and the obligation id the caller named, and a harness sentence; the caller\'s own words are not echoed, and no model has written anything' },
});

const marked = result => !!result?._meta?.[TRUST_META_KEY];

// 0.8.4 F3. `error` is marked on every JSON answer of every tool that does not wrap itself, whatever the tool's own list says: the sentences
// behind it name run ids, stage labels, file names inside a run or context folder, values read from a project file (.env, pricing.user.json, tree.json,
// run.json) and a gate's or a tree's own refusal, and before this a result whose only text was its `error` carried none of the tool's listed fields,
// so it went to the agent unmarked (src/mcp/untrusted.js returned it as it was).
const ALWAYS_MARKED = Object.freeze(['error']);
// The keys of an isError result's structuredContent that are the harness's own flags and codes; every other key is marked (fail closed: a refusal's
// `reason`, `next`, `log`, `run` and whatever a caller adds).
const STRUCTURED_HARNESS_KEYS = Object.freeze(['refused', 'code', 'nothing_spent', 'dispositions_recorded']);

const listedFor = rule => (rule.wrap === 'fields' ? [...new Set([...rule.fields, ...ALWAYS_MARKED])] : [...ALWAYS_MARKED]);

// A whole mark replaces this call's inline markers (a file's notice and markers frame the text, and untrustedFileResult would leave the id of a marker it did not write as a remnant).
const withoutCallMarkers = (text, call) => (call?.fragments ? text.replaceAll(`<<<THC-UNTRUSTED-TEXT ${call.id}>>>`, '').replaceAll(`<<<END THC-UNTRUSTED-TEXT ${call.id}>>>`, '') : text);

function markObject(obj, fields) {
  const present = fields.filter(f => obj && typeof obj === 'object' && obj[f] !== undefined && obj[f] !== null);
  return present.length ? markUntrustedFields(obj, present) : obj;
}

/** An error result (isError), of any tool, that no site composed: its text as run-folder text (the same notice and markers as a file), isError and the structured content kept. Unknown origin = marked. */
function markErrorResult(name, result) {
  const blocks = Array.isArray(result.content) ? result.content : [];
  if (blocks.some(b => b?.type !== 'text' || typeof b.text !== 'string')) throw new Error(`MCP tool ${name} returned an error result src/mcp/untrusted.js cannot mark (it holds a block that is not text); classify it as 'own' and wrap it in its handler`);
  const wrapped = untrustedFileResult(withoutCallMarkers(blocks.map(b => b.text).join('\n'), currentCall()), {});
  const out = { ...result, content: wrapped.content, isError: true, _meta: { ...(result._meta || {}), ...wrapped._meta } };
  const sc = result.structuredContent;
  if (sc && typeof sc === 'object' && !Array.isArray(sc)) out.structuredContent = markObject(sc, Object.keys(sc).filter(k => !STRUCTURED_HARNESS_KEYS.includes(k)));
  return out;
}

/**
 * An error result a site composed (src/return-path.js fragment() / claimComposed()): the harness's sentence stays as it is in the first block, with the markers of this call around the values
 * read from the run folder or the work folder; the notice for them follows as one more block, and in structuredContent as `untrusted_notice`. A site that only claimed (no fragment) adds nothing.
 */
function sealComposedError(result, call) {
  const withFragments = call.fragments > 0 && holdsFragment(call, [result.content, result.structuredContent]);
  const trust = withFragments ? { trust: 'harness_text_with_untrusted_fragments', fragments: call.fragments, hidden_removed: call.hidden } : { trust: 'harness_text' };
  const out = { ...result, _meta: { ...(result._meta || {}), [TRUST_META_KEY]: trust } };
  if (!withFragments) return out;
  const notice = fragmentNotice(call);
  out.content = [...(result.content || []), { type: 'text', text: notice }];
  const sc = result.structuredContent;
  if (sc && typeof sc === 'object' && !Array.isArray(sc)) out.structuredContent = { ...sc, untrusted_notice: notice };
  return out;
}

/** An error result is the server's own words only when its ONE text block is exactly the string a site claimed for 'isError' (R460: the claim covers the string the agent reads). */
const isClaimedText = (call, result) => result.content?.length === 1 && isClaimed(call, 'isError', result.content[0]?.text);

export function wrapResult(name, result) {
  const rule = TOOL_TRUST[name];
  if (!rule) throw new Error(`MCP tool ${name} has no entry in TOOL_TRUST (src/mcp/untrusted.js)`);
  if (!result || marked(result)) return result;
  const call = currentCall();
  // 0.8.4 F3: this comes before the class checks, so an error result of a wrap:false or 'own' tool is marked too (contract_amend).
  // Before, an isError result was returned unchanged here ("an error result is returned unchanged": no reason was written beside it).
  if (result.isError) return call && (isClaimedText(call, result) || holdsFragment(call, [result.content, result.structuredContent])) ? sealComposedError(result, call) : markErrorResult(name, result);
  if (rule.wrap === 'own') return result;
  const blocks = result.content || [];
  // Only text() results are built by this server; anything else would pass unmarked, so it is refused loudly (fail closed).
  if (blocks.length !== 1 || blocks[0].type !== 'text') {
    if (!rule.wrap) return result;   // a wrap:false tool's answer that is not one text block (none today) is left as it was
    throw new Error(`MCP tool ${name} returned a result src/mcp/untrusted.js cannot mark (${blocks.length} block(s)); classify it as 'own' and wrap it in its handler`);
  }
  const raw = blocks[0].text;
  if (rule.wrap === 'text') return untrustedFileResult(withoutCallMarkers(raw, call), {});
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  // A text answer from a 'fields' tool (run_status brief: true returns the regenerated RESUME.md) is run-folder text as a whole. A wrap:false tool's text answer (dry_run
  // without json) has no run-folder text and stays as it is.
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) return rule.wrap ? untrustedFileResult(withoutCallMarkers(raw, call), {}) : result;
  // A field a site composed (it wrote its fragments through fragment(), or claimed the field as its own words) is not marked as a whole; every other listed field is.
  // Only a STRING field can be a composed sentence: an object or a list holds values of its own that nobody wrote through the writer, so it is marked as a whole.
  const composed = (x, f) => !!call && typeof x?.[f] === 'string' && (isClaimed(call, f, x[f]) || holdsFragment(call, x[f]));
  const listed = listedFor(rule);
  let sealed = false;
  const one = x => {
    if (!x || typeof x !== 'object') return x;
    const skip = listed.filter(f => composed(x, f));
    const toMark = listed.filter(f => !skip.includes(f));
    const done = markObject(x, toMark);
    // the notice goes with every key that still holds this call's markers and was not marked as a whole, listed or not (`next` of the awaiting-limit answer is not listed)
    const wholly = new Set(toMark.filter(f => x[f] !== undefined && x[f] !== null));
    if (!Object.keys(x).some(k => !wholly.has(k) && holdsFragment(call, x[k]))) return done;
    sealed = true;   // a key of the object that holds the fragments (each row of a list, for a list)
    return { ...done, untrusted_fragment_notice: fragmentNotice(call) };
  };
  const out = Array.isArray(parsed) ? parsed.map(one) : one(parsed);
  const touched = Array.isArray(out) ? out.some(x => x?.untrusted_fields) : !!out?.untrusted_fields;
  // What still returns here unchanged: an answer in which none of the tool's listed fields and no `error` is present, or only fields a site composed (a start or a resume that went through:
  // ids, a pid, a fixed state word and a log path; a list of chains; a price table). A text key nobody listed is not marked: a future text key is listed by hand (the rule at the top of this file).
  if (!touched && !sealed) return result;
  return { ...result, content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], _meta: { ...(result._meta || {}), [TRUST_META_KEY]: { trust: sealed ? 'untrusted_model_output_and_fragments' : 'untrusted_model_output', fields: listed, ...(sealed ? { fragments: call.fragments } : {}) } } };
}

/** Every tool registered on `server` after this call must be classified; its results pass through wrapResult. */
export function guardToolRegistration(server) {
  const wrapHandler = (name, args) => {
    if (!Object.hasOwn(TOOL_TRUST, name)) throw new Error(`MCP tool ${name} is not classified in src/mcp/untrusted.js TOOL_TRUST: say whether it returns run-folder text before registering it`);
    const i = args.length - 1;
    const handler = args[i];
    if (typeof handler !== 'function') throw new Error(`MCP tool ${name}: no handler to wrap`);
    const copy = [...args];
    copy[i] = (...a) => inToolCall(async () => wrapResult(name, await handler(...a)));   // one store per call: the fragments a site writes and the claims it makes belong to this call only (src/return-path.js)
    return copy;
  };
  const tool = server.tool.bind(server);
  const registerTool = server.registerTool.bind(server);
  server.tool = (name, ...rest) => tool(name, ...wrapHandler(name, rest));
  server.registerTool = (name, ...rest) => registerTool(name, ...wrapHandler(name, rest));
  return server;
}
