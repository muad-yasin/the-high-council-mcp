// Rewrites src/reasoning-table.json (0.8.1 milestone R, owner orders 4-5 Oct 2026: reasoning is always "high").
// The table says, per (wire provider, model): what field makes the seat reason at "high", the model's largest reply, and
// the model's own default effort. It is DATA with dated sources, not a runtime lookup: a call to OpenRouter's model list
// at run time would be a new outbound call that cannot be tested offline (decided in milestone R, 0.8.1-decisions.md).
//   node scripts/refresh-reasoning-table.mjs [path-to-openrouter-models.json]   (no argument: fetches the public list)
// The OpenRouter rows are read from GET https://openrouter.ai/api/v1/models (public, no key); every other row is typed
// below with the document it came from. Run it by hand at release time (MAN-7); no test calls the network.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDOR_MODEL_MAPS } from '../src/providers.js';
import { notOnRouterReason } from '../src/table-reasons.js';
import { buildOpenRouterRows } from '../src/table-rows.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASOF = process.env.REASONING_TABLE_ASOF || new Date().toISOString().slice(0, 10);

const SOURCES = {
  'anthropic-effort': 'https://platform.claude.com/docs/en/build-with-claude/effort (supportedModels list; per-model defaults; Opus 5.5 default medium)',
  'anthropic-thinking': 'https://platform.claude.com/docs/en/build-with-claude/thinking (Haiku 4.5 keeps thinking: {type: enabled, budget_tokens}, minimum 1,024, below max_tokens; effort is not listed for it)',
  'openrouter-models': 'https://openrouter.ai/api/v1/models (public list: supported_parameters, reasoning.supported_efforts, reasoning.default_effort, top_provider.max_completion_tokens; the max is the router\'s number, which for some models is 0.9 x the context window and not the lab\'s own limit; for the ids in the LAB_OUTPUT_LIMITS map of scripts/refresh-reasoning-table.mjs it is the lab\'s own published limit (or, where the id\'s note says so, the owner\'s pick) instead: GLM-5.3 and GLM-5.3 Flash 131,072, the schema maximum on https://docs.z.ai/api-reference/llm/chat-completion beside the guides https://docs.z.ai/guides/llm/glm-5.3 and https://docs.z.ai/guides/llm/glm-5.3-flash ("128K"), read 2026-10-18, spot-checked 2026-10-23; the ids of the same map that carry a note instead of a number are models whose lab pages state no limit: their row holds maxOutput null and a dated maxOutputNote, and the router\'s number is not used; one id of the map, deepseek-v4-pro-0813, carries a number AND a note: that figure is the owner\'s pick, not a lab figure, and its maxOutputNote says so)',
  'openrouter-reasoning': 'https://openrouter.ai/docs/guides/best-practices/reasoning-tokens (reasoning: {effort}; models that only take a token budget get the effort turned into a share of max_tokens)',
  'openai-reasoning': 'https://developers.openai.com/api/docs/guides/reasoning (Chat Completions field reasoning_effort)',
  'google-openai-compat': 'https://ai.google.dev/gemini-api/docs/openai (reasoning_effort minimal/low/medium/high/none; Gemini 2.5 Pro and 3 cannot be turned off)',
  'qwen-model-card': 'https://huggingface.co/Qwen/Qwen3.5-9B (thinking is the default; chat_template_kwargs {enable_thinking: false} turns it off; 32,768 output tokens recommended for most queries, 81,920 for the hardest)',
  'deepseek-v41-model-card': "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash (its chat template, read 2026-10-14: kwargs thinking_mode \"thinking\"|\"chat\" default \"thinking\" (enable_thinking is an alias); reasoning_effort an integer 1-100 or low/medium/high/max, default \"high\", the template's own map low 50 / medium 62 / high 75 / max 100) and https://recipes.vllm.ai/deepseek-ai/DeepSeek-V4.1-Flash (read 2026-10-14: chat_template_kwargs {thinking, reasoning_effort}; low 25 / high 50 / xhigh 75 / max 100 or an integer 1-100; \"medium\" and \"minimal\" rejected; the page says the DeepSeek API maps low/high/max to 50/75/100 while the open-source encoder, and so vLLM, maps low/high/xhigh/max to 25/50/75/100, so \"high\" runs at 50 there, with both keys unset thinking is ON at effort 50). THE TWO SOURCES DISAGREE on what \"high\" is (75 vs 50) and on the default, and Together's own reasoning page (docs.together.ai/docs/inference/chat/reasoning.md, read 2026-10-14) does NOT list V4.1 Flash (it shows chat_template_kwargs {thinking: true} passed through for Qwen3.5), so which map Together applies, and that it passes these kwargs for this id, is NOT established; the form is inferred from the model's template, defaultEffort is left null on purpose DECISION (C&C 14 Oct 2026): the shipped seat sends the INTEGER 75 inside chat_template_kwargs, not the word: 75 is \"high\" on the template's map and on the DeepSeek API's map and equals vLLM's \"xhigh\", so it is high or above on every map read here; Together's API reference types the TOP-LEVEL reasoning_effort as an enum of low/medium/high and types chat_template_kwargs as an untyped object, so the integer goes inside chat_template_kwargs. `highAtLeast` (75) on the row is the number from which an integer counts as high; a row without it treats every integer as a lowering.",
  'deepseek-v4-recipe': 'https://recipes.vllm.ai/deepseek-ai/DeepSeek-V4-Flash (chat_template_kwargs {thinking: true, reasoning_effort: "high"|"max"}; the same `thinking` switch the shipped chains used, set to false, on Together; the page is vLLM\'s serving recipe, Together\'s own page was not found, so the on-value is not confirmed on Together)',
  'zai-thinking': 'https://docs.z.ai/guides/capabilities/thinking-mode (thinking: {type: enabled|disabled}, no levels; GLM-5.3 and GLM-5.3-FLASH forced on)',
};

// What a seat sends to reason at "high". `extra` is merged into the request body by the provider adapter.
const FORMS = {
  'anthropic-effort': { extra: { output_config: { effort: 'high' } }, source: 'anthropic-effort', note: 'thinking stays adaptive (the default on claude-sonnet-5 and claude-opus-5); never "disabled"' },
  'anthropic-budget': { extra: { thinking: { type: 'enabled' } }, budget: { rule: 'half of the seat\'s output cap, at least 1024, below max_tokens' }, source: 'anthropic-thinking', note: 'claude-haiku-4-5 has no effort levels; "high" there is thinking on with a budget; the seat\'s cap is raised so that cap = old cap + budget' },
  'openrouter-effort': { extra: { reasoning: { effort: 'high' } }, source: 'openrouter-reasoning' },
  'openai-reasoning-effort': { extra: { reasoning_effort: 'high' }, source: 'openai-reasoning' },
  'google-reasoning-effort': { extra: { reasoning_effort: 'high' }, source: 'google-openai-compat' },
  'qwen-template-thinking': { extra: { chat_template_kwargs: { enable_thinking: true } }, source: 'qwen-model-card', note: 'Together serves Qwen3.5 with the model\'s own chat-template switch; on is the model default, written out so a chain says it' },
  'deepseek-v41-template-thinking': { extra: { chat_template_kwargs: { thinking: true, reasoning_effort: 75 } }, source: 'deepseek-v41-model-card', note: 'DeepSeek V4.1 chat-template switch with an INTEGER effort (1-100): 75 is "high" on the template\'s and the DeepSeek API\'s maps and "xhigh" on vLLM\'s; the row\'s highAtLeast says from which number an integer counts as high' },
  'deepseek-template-thinking': { extra: { chat_template_kwargs: { thinking: true, reasoning_effort: 'high' } }, source: 'deepseek-v4-recipe', note: 'DeepSeek V4 chat-template switch; "high" is Think High ("max" is the model\'s own top mode)' },
  'zai-thinking': { extra: { thinking: { type: 'enabled' } }, source: 'zai-thinking', note: 'on/off only: the one setting this provider has, so "high" means on' },
};

const DIRECT = {
  'anthropic/claude-sonnet-5': { form: 'anthropic-effort', maxOutput: 128000, defaultEffort: 'high', source: 'anthropic-effort' },
  'anthropic/claude-opus-5': { form: 'anthropic-effort', maxOutput: 128000, defaultEffort: 'high', source: 'anthropic-effort' },
  'anthropic/claude-haiku-4-5-20251001': { form: 'anthropic-budget', maxOutput: 64000, defaultEffort: null, source: 'anthropic-thinking' },
  'openai/gpt-5': { form: 'openai-reasoning-effort', maxOutput: 128000, defaultEffort: 'medium', source: 'openai-reasoning' },
  'openai/gpt-5-mini': { form: 'openai-reasoning-effort', maxOutput: 128000, defaultEffort: 'medium', source: 'openai-reasoning' },
  'openai/gpt-5-nano': { form: 'openai-reasoning-effort', maxOutput: 128000, defaultEffort: 'medium', source: 'openai-reasoning' },
  'google/gemini-2.5-pro': { form: 'google-reasoning-effort', maxOutput: 65536, defaultEffort: null, source: 'google-openai-compat' },
  'google/gemini-2.5-flash': { form: 'google-reasoning-effort', maxOutput: 65536, defaultEffort: null, source: 'google-openai-compat' },
  'google/gemini-3.6-flash': { form: 'google-reasoning-effort', maxOutput: 65536, defaultEffort: 'medium', source: 'google-openai-compat' },
  'together/deepseek-ai/DeepSeek-V4-Flash-0731': { form: 'deepseek-template-thinking', maxOutput: null, defaultEffort: null, source: 'deepseek-v4-recipe' },
  'together/deepseek-ai/DeepSeek-V4.1-Flash': { form: 'deepseek-v41-template-thinking', maxOutput: null, defaultEffort: null, highAtLeast: 75, source: 'deepseek-v41-model-card' },
  'anthropic/claude-fable-5-1': { form: 'anthropic-effort', maxOutput: 128000, defaultEffort: 'high', source: 'anthropic-effort' },
  'anthropic/claude-opus-5-5': { form: 'anthropic-effort', maxOutput: 128000, defaultEffort: 'medium', source: 'anthropic-effort' },
  'together/Qwen/Qwen3.5-9B': { form: 'qwen-template-thinking', maxOutput: null, defaultEffort: null, source: 'qwen-model-card' },
  'zai/glm-4.7-flash': { form: 'zai-thinking', maxOutput: 117964, defaultEffort: null, source: 'zai-thinking' },
};

// The lab's own output limit, for an OpenRouter id whose router number is NOT the lab's limit (the router's max_completion_tokens for GLM-5.3 and GLM-5.3 Flash was about 943,718 on 23 Oct 2026 = 0.9 x the
// 1,048,576 context window). Without this map every regeneration writes the router's number back. Owner's answer, 23 Oct 2026 (via C&C): both GLM models take the lab limit 131,072. Sources, read by lane A on 18 Oct 2026
// (m7/A_Lab_Output_Limits_Partial_2026-10-18.md, spot-checked 23 Oct): https://docs.z.ai/guides/llm/glm-5.3 ("a maximum output length of 128K tokens"), https://docs.z.ai/guides/llm/glm-5.3-flash ("128K"),
// https://docs.z.ai/api-reference/llm/chat-completion (request schema max 131072). The lab's rounded "128K" is not converted; its schema maximum 131,072 is the integer.
// The router's max_completion_tokens is also 0.9 x the context window for some models that are NOT in this map's number entries (92 of the 469 models on the 2026-10-23 list); two table rows had that derived figure as a number (qwen3.5-9b 235,929, deepseek-v4.1-flash 943,718) and now hold null + a note.
// A model whose lab pages state no output limit is { limit: null, note }: its row holds maxOutput null and the dated note (`maxOutputNote`), never the router's number. "None found" is a statement about the pages named in
// its note on the date named, not a claim that the lab has no limit (owner's answer, 23 Oct 2026, via C&C: "unknown" where no lab publishes one). MiMo (131,072 on the router, the same figure in four third-party
// listings, the lab page unreadable by our tools on 2026-10-18) is NOT in this map: it keeps the router's number and is listed at the end of a run as a row that is not lab-confirmed.
// An entry { limit: <number>, note } is the OWNER'S PICK, not a lab figure: no output limit was found on DeepSeek's API pages for the 0813 build (named in the note, with the date read), the router declares 393,216 for it (384,000 for deepseek-v4-pro), and the owner chose
// 384,000 (2026-10-24, via C&C). The row holds the number and the note, and the note says whose pick it is; a regeneration keeps it because the id is in this map.
const LAB_OUTPUT_LIMITS = {
  'z-ai/glm-5.3': 131072,
  'z-ai/glm-5.3-flash': 131072,
  'minimax/minimax-m3': { limit: null, note: 'no output limit found on platform.minimax.io (text-openai-api, text-anthropic-api, text-generation) or the Hugging Face model card; read 2026-10-18' },
  'meta/muse-spark-1.2': { limit: null, note: 'no output limit found on dev.meta.ai (models, pricing-rate-limits, reasoning); its chat-completions parameter page did not load; read 2026-10-18' },
  'meta/muse-spark-1.3': { limit: null, note: 'no output limit found on dev.meta.ai (models, pricing-rate-limits, reasoning); its chat-completions parameter page did not load; read 2026-10-18' },
  'mistralai/mistral-large-4-0': { limit: null, note: 'no output limit found on the docs.mistral.ai models overview, the only page of this model that was read (its own page was not found at the URL tried); read 2026-10-23' },
  'mistralai/mistral-medium-3-5': { limit: null, note: 'no output limit found on docs.mistral.ai (the models overview and the mistral-medium-3-5-26-04 page); read 2026-10-23' },
  'deepseek/deepseek-v4-pro-0813': { limit: 384000, note: "the owner's pick (2026-10-24), not a lab figure: no output limit found on api-docs.deepseek.com (quick_start/pricing and quick_start/models); read 2026-10-24; the router declares 393,216 for the 0813 build and 384,000 for deepseek-v4-pro" },
  'qwen/qwen3.5-9b': { limit: null, note: 'no maximum output limit found on Qwen\'s Hugging Face model card (huggingface.co/Qwen/Qwen3.5-9B; it gives recommendations only: 32,768 tokens for most queries and 81,920 for hard benchmarks); read 2026-10-24' },
  'deepseek/deepseek-v4.1-flash': { limit: null, note: 'no output limit found on api-docs.deepseek.com (quick_start/pricing and quick_start/models; they name deepseek-flash, served by the 1017 build, and do not name this build); read 2026-10-24' },
  'meta-llama/llama-4-maverick': { limit: null, note: 'no output limit found on Meta\'s Llama 4 model card (dev.meta.ai/llama/docs/model-cards-and-prompt-formats/llama4); read 2026-10-23' },
};

// Wire providers the table does not know a documented reasoning field for: the harness sends nothing to them.
const UNLISTED = {
  'cohere/command-r7b-12-2024': 'not a reasoning model; no reasoning field',
  'deepseek/deepseek-chat': 'not a reasoning model on this id; no reasoning field',
  'groq/llama-3.3-70b-versatile': 'not a reasoning model; no reasoning field',
  'mistral/mistral-large-latest': 'not a reasoning model on this id; no reasoning field',
  'ollama/*': 'local models; the harness sends nothing',
};

const list = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await (await fetch('https://openrouter.ai/api/v1/models')).json();
const byId = new Map(list.data.map(m => [m.id, m]));

// Every OpenRouter model any shipped chain seats, plus every id a single-vendor route can name.
const ids = new Set(Object.values(VENDOR_MODEL_MAPS.openrouter));
const seated = new Set();   // the ids a chain in chains/ seats (the others are only named by a single-vendor route)
const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.provider === 'openrouter' && typeof o.model === 'string') { ids.add(o.model); seated.add(o.model); } Object.values(o).forEach(walk); } };
for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')));

// The OpenRouter rows are built by src/table-rows.js: a row is NEVER dropped (an id on the router list is refreshed whether or not a chain seats it; an id that left the list keeps its last numbers with a
// dated note). The existing table is read for that, so it must be parseable: restore it from git if it is not.
let previousTable;
try { previousTable = JSON.parse(readFileSync(join(root, 'src', 'reasoning-table.json'), 'utf8')); }
catch (e) { throw new Error(`cannot keep the existing rows: src/reasoning-table.json is unreadable (${e.message}); restore it from git before regenerating`); }
const previous = Object.fromEntries(Object.entries(previousTable.models || {}).filter(([k]) => k.startsWith('openrouter/')).map(([k, v]) => [k.slice('openrouter/'.length), v]));
const built = buildOpenRouterRows({ ids, byId, previous, asOf: ASOF, labLimits: LAB_OUTPUT_LIMITS });
const models = { ...DIRECT, ...built.rows };
const missing = built.missing;
if (built.keptOffList.length) console.log(`kept ${built.keptOffList.length} row(s) whose id left OpenRouter's list: ${built.keptOffList.join(', ')}`);
// A gate paired with a check on its output: every override either landed in its row or is reported as unused (the id is not seated by any chain), never silently dropped.
for (const [id, entry] of Object.entries(LAB_OUTPUT_LIMITS)) {
  const row = models[`openrouter/${id}`];
  const limit = typeof entry === 'number' ? entry : entry.limit;
  if (!row) console.log(`lab output limit for ${id} (${limit ?? 'none found'}) NOT applied: no chain or route seats it, so the table has no row`);
  else if (row.maxOutput !== limit) throw new Error(`lab output limit for ${id} did not land: row has ${row.maxOutput}, expected ${limit}`);
  else if (typeof entry !== 'number' && !row.maxOutputNote) throw new Error(`lab output limit for ${id} landed without its note`);
}
for (const k of Object.keys(models)) {
  const e = models[k].defaultEffort;
  // A model whose own default is above "high": sending "high" would run it LOWER than it runs today. The harness sends it nothing
  // and the lint accepts the absence (owner: "NO LOWER EFFORT"; confirmation by the owner pending).
  models[k].defaultAboveHigh = e === 'max' || e === 'xhigh';
}

const out = {
  schema: 'reasoning-table/1',
  asOf: ASOF,
  staleDays: 60,
  _note: 'Written by scripts/refresh-reasoning-table.mjs (0.8.1 milestone R). Fields were set from the documents named in `sources` and OpenRouter\'s public model list, NOT exercised in a live call; the first real run of each changed chain is the live test. A date lives in asOf; test/reasoning-table.test.js fails when it is older than staleDays (a release step, MAN-7).',
  transportCeilings: { anthropic: 64000 },
  _transportCeilingsNote: 'The largest reply a seat on this wire provider is retried at: 64,000 is the ceiling the code carried since 0.8.0 (src/chain.js CUT_OFF_RETRY_MAX_TOKENS, observed, no derivation recorded) and a direct non-streaming Anthropic call cannot return more inside Node\'s 300 s headers limit (src/providers.js); streaming is out of scope for 0.8.1.',
  sources: SOURCES,
  forms: FORMS,
  models,
  unlisted: { ...UNLISTED, ...Object.fromEntries(missing.map(id => [`openrouter/${id}`, notOnRouterReason(ASOF, seated.has(id))])) },
};
writeFileSync(join(root, 'src', 'reasoning-table.json'), JSON.stringify(out, null, 2) + '\n');
const routerNumber = Object.entries(models).filter(([k, v]) => v.source === 'openrouter-models' && !(k.replace(/^openrouter\//, '') in LAB_OUTPUT_LIMITS)).map(([k]) => k);
console.log(`${routerNumber.length} row(s) still take maxOutput from the router's number, not a lab-confirmed limit: ${routerNumber.join(', ')}`);
console.log(`wrote src/reasoning-table.json: ${Object.keys(models).length} models, ${missing.length} OpenRouter ids not in the list${missing.length ? ': ' + missing.join(', ') : ''}`);
