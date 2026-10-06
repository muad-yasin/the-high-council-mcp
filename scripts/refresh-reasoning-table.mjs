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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASOF = process.env.REASONING_TABLE_ASOF || new Date().toISOString().slice(0, 10);

const SOURCES = {
  'anthropic-effort': 'https://platform.claude.com/docs/en/build-with-claude/effort (supportedModels list; per-model defaults; Opus 5.5 default medium)',
  'anthropic-thinking': 'https://platform.claude.com/docs/en/build-with-claude/thinking (Haiku 4.5 keeps thinking: {type: enabled, budget_tokens}, minimum 1,024, below max_tokens; effort is not listed for it)',
  'openrouter-models': 'https://openrouter.ai/api/v1/models (public list: supported_parameters, reasoning.supported_efforts, reasoning.default_effort, top_provider.max_completion_tokens; the max is the router\'s number, which for some models is 0.9 x the context window and not the lab\'s own limit)',
  'openrouter-reasoning': 'https://openrouter.ai/docs/guides/best-practices/reasoning-tokens (reasoning: {effort}; models that only take a token budget get the effort turned into a share of max_tokens)',
  'openai-reasoning': 'https://developers.openai.com/api/docs/guides/reasoning (Chat Completions field reasoning_effort)',
  'google-openai-compat': 'https://ai.google.dev/gemini-api/docs/openai (reasoning_effort minimal/low/medium/high/none; Gemini 2.5 Pro and 3 cannot be turned off)',
  'qwen-model-card': 'https://huggingface.co/Qwen/Qwen3.5-9B (thinking is the default; chat_template_kwargs {enable_thinking: false} turns it off; 32,768 output tokens recommended for most queries, 81,920 for the hardest)',
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
  'anthropic/claude-fable-5-1': { form: 'anthropic-effort', maxOutput: 128000, defaultEffort: 'high', source: 'anthropic-effort' },
  'anthropic/claude-opus-5-5': { form: 'anthropic-effort', maxOutput: 128000, defaultEffort: 'medium', source: 'anthropic-effort' },
  'together/Qwen/Qwen3.5-9B': { form: 'qwen-template-thinking', maxOutput: null, defaultEffort: null, source: 'qwen-model-card' },
  'zai/glm-4.7-flash': { form: 'zai-thinking', maxOutput: 117964, defaultEffort: null, source: 'zai-thinking' },
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
const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.provider === 'openrouter' && typeof o.model === 'string') ids.add(o.model); Object.values(o).forEach(walk); } };
for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')));

const models = { ...DIRECT };
const missing = [];
for (const id of [...ids].sort()) {
  const m = byId.get(id);
  if (!m) { missing.push(id); continue; }
  const r = m.reasoning || null;
  const takes = (m.supported_parameters || []).includes('reasoning');
  const efforts = r?.supported_efforts || null;
  const offers = takes && (!efforts || efforts.includes('high'));
  models[`openrouter/${id}`] = {
    form: offers ? 'openrouter-effort' : null,
    maxOutput: m.top_provider?.max_completion_tokens ?? null,
    defaultEffort: r?.default_effort ?? null,
    supportedEfforts: efforts,
    mandatory: r?.mandatory ?? null,
    source: 'openrouter-models',
  };
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
  unlisted: { ...UNLISTED, ...Object.fromEntries(missing.map(id => [`openrouter/${id}`, `not in OpenRouter's public list on ${ASOF}; no shipped seat uses it`])) },
};
writeFileSync(join(root, 'src', 'reasoning-table.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote src/reasoning-table.json: ${Object.keys(models).length} models, ${missing.length} OpenRouter ids not in the list${missing.length ? ': ' + missing.join(', ') : ''}`);
