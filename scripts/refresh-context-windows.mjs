// 0.8.4 S16 (H; Muad 09 Nov 2026): writes src/context-windows.json, the input window W (tokens) of every OpenRouter model a shipped chain seats.
// W = the smallest context_length over the router's list figure and the model's hosts (GET https://openrouter.ai/api/v1/models and .../models/<id>/endpoints; public, no key, nothing paid).
// Hosts counted: fast, ultrafast, priority and flex tiers are left out, and so is a host whose published output limit is below the smallest maxTokens a shipped chain gives the model (the filters the price rows use, minus their page-only flag).
// Usage: node scripts/refresh-context-windows.mjs [models.json] [endpointsDir]   (the two files are the fetched answers, for an offline run; endpointsDir holds <id with / as __>.json). Fetched text is data: it is only parsed as JSON.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAST = /fast|priority|flex/i;
const fileOf = id => `${id.replace(/\//g, '__')}.json`;
// 0.8.4 the OpenRouter switch: a shipped chain's DIRECT Claude seat can be routed through OpenRouter (src/claude-route.js), where its model is "anthropic/claude-<name>-<n>.<m>". The routed seat needs a window row too, or the final read's
// room rule is silently skipped for it (contextWindowOf returns null for a model missing from the table), so the models a shipped chain seats DIRECTLY at Anthropic are listed here under their routed id (scripts/routed-claude-ids.mjs, pure).
import { routedClaudeId } from './routed-claude-ids.mjs';

function shippedModels() {
  const out = new Map();
  const walk = x => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (x.provider === 'openrouter' && typeof x.model === 'string') out.set(x.model, [...(out.get(x.model) ?? []), Number.isInteger(x.maxTokens) ? x.maxTokens : 0]);
      else if (x.provider === 'anthropic' && typeof x.model === 'string' && routedClaudeId(x.model)) { const id = routedClaudeId(x.model); out.set(id, [...(out.get(id) ?? []), Number.isInteger(x.maxTokens) ? x.maxTokens : 0]); }
      Object.values(x).forEach(walk);
    }
  };
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json')).sort()) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')).seats ?? {});
  return out;
}
const getJson = async url => (await fetch(url)).json();

const modelsFile = process.argv[2], epDir = process.argv[3];
const list = modelsFile ? JSON.parse(readFileSync(modelsFile, 'utf8')) : await getJson('https://openrouter.ai/api/v1/models');
const byId = new Map((list.data ?? []).map(m => [m.id, m]));
const models = {};
for (const [id, caps] of [...shippedModels()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const set = caps.filter(Boolean); const need = set.length ? Math.min(...set) : 0;   // no cap set: no host is left out for its output limit
  const f = epDir ? join(epDir, fileOf(id)) : null;
  const eps = f ? (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).data?.endpoints ?? [] : []) : (await getJson(`https://openrouter.ai/api/v1/models/${id}/endpoints`)).data?.endpoints ?? [];
  const kept = eps.filter(e => !FAST.test(`${e.tag ?? ''} ${e.service_tier ?? ''}`) && (e.max_completion_tokens == null || e.max_completion_tokens >= need));
  const sizes = [...kept.map(e => e.context_length), byId.get(id)?.context_length].filter(n => Number.isInteger(n) && n > 0);
  if (sizes.length) models[id] = Math.min(...sizes);   // a model with no figure is left out: no W, no room check
}
const old = JSON.parse(readFileSync(join(root, 'src', 'context-windows.json'), 'utf8'));
writeFileSync(join(root, 'src', 'context-windows.json'), `${JSON.stringify({ ...old, asOf: new Date().toISOString().slice(0, 10), models }, null, 2)}\n`);
console.log(`context-windows.json: ${Object.keys(models).length} models`);
