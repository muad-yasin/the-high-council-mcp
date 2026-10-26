// 0.8.1 milestone R: reasoning is always high (owner, 4-5 Oct 2026). The dated table, the one list of lowering settings, the harness
// default and the chain-lint rule `reasoning-not-high`. Offline: no call, no key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REASONING_TABLE, REASONING_WORDS, loweringReasons, highExtraFor, extraWithHighDefault, reasoningProblems, retryCeilingOf, haikuBudgetFor, rowOf, tableAgeDays } from '../src/reasoning.js';
import { lintChain, isShippedChainPath } from '../src/chain-lint.js';
import { VENDOR_MODEL_MAPS, resolveVendorSeat } from '../src/providers.js';
import { cutOffRetryCap } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chainFiles = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).sort();
const shipped = Object.fromEntries(chainFiles.map(f => [f, JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'))]));
const seatsOf = (o, out = []) => { if (Array.isArray(o)) o.forEach(v => seatsOf(v, out)); else if (o && typeof o === 'object') { if (typeof o.provider === 'string' && typeof o.model === 'string') out.push(o); Object.values(o).forEach(v => seatsOf(v, out)); } return out; };
const realSeats = cfg => seatsOf(cfg).filter(s => s.provider !== 'mock' && s.provider !== 'external');
const isMockChain = cfg => { const s = seatsOf(cfg); return s.length > 0 && s.every(x => x.provider === 'mock'); };

test('the table: every row names a form and a source that exist, with a date; the table is not stale', () => {
  assert.equal(REASONING_TABLE.schema, 'reasoning-table/1');
  assert.match(REASONING_TABLE.asOf, /^\d{4}-\d{2}-\d{2}$/);
  for (const [key, row] of Object.entries(REASONING_TABLE.models)) {
    assert.ok(row.source in REASONING_TABLE.sources, `${key}: source ${row.source} is not in sources`);
    if (row.form) assert.ok(row.form in REASONING_TABLE.forms, `${key}: form ${row.form} does not exist`);
  }
  for (const [name, form] of Object.entries(REASONING_TABLE.forms)) assert.ok(form.source in REASONING_TABLE.sources, `form ${name} has no source`);
  // Turns red on asOf + staleDays + 1 (2026-12-23: age 60 still passes; the table was regenerated 2026-10-23): re-read the pages and re-run scripts/refresh-reasoning-table.mjs (MAN-7, with 2026-11-21, 2026-11-23 and 2026-12-08).
  assert.ok(tableAgeDays() <= REASONING_TABLE.staleDays, `src/reasoning-table.json is ${tableAgeDays()} days old (as of ${REASONING_TABLE.asOf}); re-run scripts/refresh-reasoning-table.mjs`);
});

test('the table: every (provider, model) a shipped non-mock seat uses, and every single-vendor route target, has a row or an unlisted reason', () => {
  const need = new Set();
  for (const cfg of Object.values(shipped)) for (const s of realSeats(cfg)) need.add(`${s.provider}/${s.model}`);
  for (const id of Object.values(VENDOR_MODEL_MAPS.openrouter)) need.add(`openrouter/${id}`);
  const missing = [...need].filter(k => !(k in REASONING_TABLE.models) && !(k in REASONING_TABLE.unlisted) && !(k.startsWith('ollama/') && 'ollama/*' in REASONING_TABLE.unlisted));
  assert.deepEqual(missing, [], 'add a row (scripts/refresh-reasoning-table.mjs) or an unlisted reason for each');
});

test('lowering settings: every spelling the harness knows is reported, and a high setting is not', () => {
  const lows = [
    { thinking: { type: 'disabled' } },
    { thinking: { type: 'between_tools' } },
    { thinking: { type: 'enabled', budget_tokens: 500 } },
    { output_config: { effort: 'low' } },
    { output_config: { effort: 'medium' } },
    { reasoning: { effort: 'low' } },
    { reasoning: { effort: 'medium' } },
    { reasoning: { effort: 'minimal' } },
    { reasoning: { effort: 'none' } },
    { reasoning: { enabled: false } },
    { reasoning: { exclude: true } },
    { reasoning: { max_tokens: 1000 } },
    { reasoning_effort: 'low' },
    { reasoning_effort: 'minimal' },
    { enable_thinking: false },
    { chat_template_kwargs: { enable_thinking: false } },
    { chat_template_kwargs: { thinking: false } },
    { chat_template_kwargs: { thinking: true, reasoning_effort: 'low' } },
    { thinking_config: { thinking_level: 'low' } },
    { google: { thinking_config: { thinking_budget: 0 } } },
  ];
  for (const extra of lows) assert.ok(loweringReasons(extra).length > 0, `not reported: ${JSON.stringify(extra)}`);
  const highs = [
    undefined, {}, { output_config: { effort: 'high' } }, { output_config: { effort: 'xhigh' } }, { reasoning: { effort: 'high' } }, { reasoning: { effort: 'max' } },
    { reasoning_effort: 'high' }, { thinking: { type: 'enabled' } }, { thinking: { type: 'adaptive' } }, { chat_template_kwargs: { enable_thinking: true } }, { chat_template_kwargs: { thinking: true, reasoning_effort: 'high' } },
    { provider: { zdr: true } }, { models: ['a/b'] },
  ];
  for (const extra of highs) assert.deepEqual(loweringReasons(extra), [], `wrongly reported: ${JSON.stringify(extra)}`);
  // A Haiku budget is judged against its seat's cap: under half of it is a lowering.
  assert.equal(loweringReasons({ thinking: { type: 'enabled', budget_tokens: 2000 } }, { maxTokens: 16000 }).length, 1);
  assert.equal(loweringReasons({ thinking: { type: 'enabled', budget_tokens: 8000 } }, { maxTokens: 16000 }).length, 0);
});

test('highExtraFor / extraWithHighDefault: fills only an unset seat, never overwrites a seat\'s own setting, never lowers', () => {
  assert.deepEqual(highExtraFor({ provider: 'anthropic', model: 'claude-sonnet-5' }).extra, { output_config: { effort: 'high' } });
  assert.deepEqual(highExtraFor({ provider: 'openrouter', model: 'openai/gpt-6.1-sol' }).extra, { reasoning: { effort: 'high' } });
  assert.deepEqual(highExtraFor({ provider: 'openai', model: 'gpt-5' }).extra, { reasoning_effort: 'high' });
  assert.deepEqual(highExtraFor({ provider: 'zai', model: 'glm-4.7-flash' }).extra, { thinking: { type: 'enabled' } });
  assert.deepEqual(highExtraFor({ provider: 'together', model: 'deepseek-ai/DeepSeek-V4-Flash-0731' }).extra, { chat_template_kwargs: { thinking: true, reasoning_effort: 'high' } });
  assert.deepEqual(highExtraFor({ provider: 'anthropic', model: 'claude-fable-5-1' }).extra, { output_config: { effort: 'high' } }, 'the default security-review seat has a row');
  // Haiku 4.5 has no effort levels: a thinking budget of half the cap (at least 1,024), only when it fits below the cap.
  assert.deepEqual(highExtraFor({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, 16000).extra, { thinking: { type: 'enabled', budget_tokens: 8000 } });
  assert.equal(haikuBudgetFor(2048), 1024);
  assert.equal(highExtraFor({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, 1500), null, 'no room for a budget below the cap: nothing is sent, never a lower setting');
  // A model whose own default is above high gets nothing (high would run it lower).
  for (const m of ['z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'qwen/qwen3.8-max-0902']) assert.equal(highExtraFor({ provider: 'openrouter', model: m }), null, m);
  // No row, no field: nothing.
  assert.equal(highExtraFor({ provider: 'cohere', model: 'command-r7b-12-2024' }), null);
  assert.equal(highExtraFor({ provider: 'mock', model: 'mock-critic-a' }), null);
  // A seat's own explicit setting is kept (a user's own chain), lowering or not; other keys survive.
  const own = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', extra: { reasoning: { effort: 'low' }, provider: { zdr: true } } };
  assert.deepEqual(extraWithHighDefault(own), own.extra);
  const plain = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', extra: { provider: { zdr: true } } };
  assert.deepEqual(extraWithHighDefault(plain), { provider: { zdr: true }, reasoning: { effort: 'high' } });
  assert.deepEqual(extraWithHighDefault({ provider: 'anthropic', model: 'claude-sonnet-5' }), { output_config: { effort: 'high' } });
  for (const seat of [plain, { provider: 'anthropic', model: 'claude-sonnet-5' }, { provider: 'openai', model: 'gpt-5' }, { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', maxTokens: 9000 }]) {
    assert.deepEqual(loweringReasons(extraWithHighDefault(seat, seat.maxTokens), seat), [], `${seat.model}: the harness default must never lower`);
  }
});

test('retryCeilingOf: the model\'s own maximum, bounded by its transport; a seat with no row keeps the 0.8.0 ceiling', () => {
  assert.equal(retryCeilingOf({ provider: 'anthropic', model: 'claude-sonnet-5' }), 64000, 'a direct non-streaming call: transport ceiling, below the 128,000 the model allows');
  assert.equal(retryCeilingOf({ provider: 'openrouter', model: 'openai/gpt-6.1-sol' }), 128000);
  assert.equal(retryCeilingOf({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }), 384000);
  assert.equal(retryCeilingOf({ provider: 'cohere', model: 'command-r7b-12-2024' }), 64000);
});

// The models whose lab pages state no output limit (owner's answer, 23 Oct 2026: "unknown", never the router's number). A row with maxOutput null MUST be in this set and carry a dated note: a skip is not a pass, so a
// null that is not named here fails. Their seats are never retried at a bigger cap: with no model maximum and no transport ceiling retryCeilingOf falls back to 64,000, and cutOffRetryCap never goes below the seat's own
// cap, so a seat at 64,000 or more (the shipped ones are 128,000) is not retried; a shipped seat below 64,000 on one of these would be, and fails here.
const NO_PUBLISHED_LIMIT = new Set(['openrouter/minimax/minimax-m3', 'openrouter/meta/muse-spark-1.2', 'openrouter/meta/muse-spark-1.3', 'openrouter/mistralai/mistral-large-4-0', 'openrouter/mistralai/mistral-medium-3-5', 'openrouter/meta-llama/llama-4-maverick', 'openrouter/qwen/qwen3.5-9b', 'openrouter/deepseek/deepseek-v4.1-flash']);

// The one model whose figure is the OWNER'S PICK, not a lab figure (the owner, 2026-10-24: DeepSeek publishes no limit for the 0813 build; the router says 393,216; the pick is 384,000). Its row is a number WITH a dated note, kept by
// the refresh script's LAB_OUTPUT_LIMITS entry. The guard runs both ways: every note belongs to a named set, and every named id has its row and note, so a refresh that dropped the entry cannot pass.
const OWNER_PICK = new Set(['openrouter/deepseek/deepseek-v4-pro-0813']);
function noteProblems(models) {
  const out = [];
  for (const [k, r] of Object.entries(models)) {
    if (!r || !('maxOutputNote' in r)) continue;
    if (r.maxOutput === null) { if (!NO_PUBLISHED_LIMIT.has(k)) out.push(`${k}: a null limit with a note, but not in the no-published-limit set`); }
    else if (typeof r.maxOutput === 'number') {
      if (!OWNER_PICK.has(k)) out.push(`${k}: a number with a note, but not in the owner's-pick set`);
      else if (!/owner's pick \(\d{4}-\d{2}-\d{2}\)/.test(r.maxOutputNote)) out.push(`${k}: the note does not say it is the owner's pick, with its date`);
    } else out.push(`${k}: maxOutputNote beside a maxOutput that is neither a number nor null`);
  }
  for (const k of OWNER_PICK) { const r = models[k]; if (!r || typeof r.maxOutput !== 'number' || !('maxOutputNote' in r)) out.push(`${k}: in the owner's-pick set, but its row is not a number with a note`); }
  for (const k of NO_PUBLISHED_LIMIT) { const r = models[k]; if (!r || r.maxOutput !== null || !/\d{4}-\d{2}-\d{2}/.test(r.maxOutputNote ?? '')) out.push(`${k}: in the no-published-limit set, but its row is not a null with a dated note`); }
  return out;
}

// `rowFor` and `ceilingOf` are injected so a test can show the guard red on a fixture row; the real table is passed below.
function outputLimitProblems(chains, rowFor, ceilingOf, retryOf) {
  const out = [];
  for (const [file, cfg] of Object.entries(chains)) {
    for (const s of realSeats(cfg)) {
      const row = rowFor(s);
      if (!row) continue;
      const where = `${file}: ${s.provider}/${s.model}`;
      if (row.maxOutput === null) {
        if (!NO_PUBLISHED_LIMIT.has(`${s.provider}/${s.model}`)) out.push(`${where}: maxOutput is null but the model is not in the no-published-limit set`);
        if (!/\d{4}-\d{2}-\d{2}/.test(row.maxOutputNote ?? '')) out.push(`${where}: maxOutput is null without a dated maxOutputNote`);
        for (const cap of [s.maxTokens, s.panelMaxTokens].filter(Number.isFinite)) if (retryOf(cap, ceilingOf(s)) > cap) out.push(`${where}: cap ${cap} would be retried at ${retryOf(cap, ceilingOf(s))} with no model limit`);
        continue;
      }
      if (typeof row.maxOutput !== 'number') { out.push(`${where}: maxOutput is neither a number nor null`); continue; }
      for (const cap of [s.maxTokens, s.panelMaxTokens].filter(Number.isFinite)) if (cap > row.maxOutput) out.push(`${where} cap ${cap} > model maximum ${row.maxOutput}`);
    }
  }
  return out;
}

test('no shipped seat asks for more output than its model can return (a model limit, not a lower effort); a null limit is explicit, dated and never retried bigger', () => {
  assert.deepEqual(outputLimitProblems(shipped, rowOf, retryCeilingOf, cutOffRetryCap), []);
  // a row that carries a note is named in one of the two sets: a null in the no-published-limit set, or a number in the owner's-pick set (rows null for another reason, such as the three together/* rows, carry no note and are not covered here)
  assert.deepEqual(noteProblems(REASONING_TABLE.models), []);
});

test('the note guard can fail: a number with a note outside the set, a named null row that is a number or missing, a pick without its date, a named pick whose row lost its note, and a null with a note outside the set (fixture rows)', () => {
  const pick = 'openrouter/deepseek/deepseek-v4-pro-0813';
  const nulls = Object.fromEntries([...NO_PUBLISHED_LIMIT].map(k => [k, { maxOutput: null, maxOutputNote: 'none found; read 2026-10-24' }]));
  const good = { [pick]: { maxOutput: 384000, maxOutputNote: "the owner's pick (2026-10-24), not a lab figure" }, ...nulls };
  assert.deepEqual(noteProblems(good), [], 'the good case: the owner\'s pick and every named null row, dated');
  assert.match(noteProblems({ ...good, 'openrouter/x/y': { maxOutput: 5, maxOutputNote: 'n' } }).join('|'), /openrouter\/x\/y: a number with a note, but not in the owner's-pick set/);
  assert.match(noteProblems({ [pick]: { maxOutput: 384000, maxOutputNote: 'router, read 2026-10-24' } }).join('|'), /does not say it is the owner's pick, with its date/);
  assert.match(noteProblems({ [pick]: { maxOutput: 393216 } }).join('|'), /in the owner's-pick set, but its row is not a number with a note/);
  assert.match(noteProblems({ ...good, 'openrouter/x/z': { maxOutput: null, maxOutputNote: 'n' } }).join('|'), /openrouter\/x\/z: a null limit with a note, but not in the no-published-limit set/);
  assert.match(noteProblems({ ...good, 'openrouter/qwen/qwen3.5-9b': { maxOutput: 235929 } }).join('|'), /openrouter\/qwen\/qwen3.5-9b: in the no-published-limit set, but its row is not a null with a dated note/);
  assert.match(noteProblems({ ...good, 'openrouter/qwen/qwen3.5-9b': undefined }).join('|'), /in the no-published-limit set, but its row/);
});

test('the output-limit guard can fail: a null row outside the set, a null without a dated note, and a null seat that would be retried bigger are each reported (fixture rows)', () => {
  const chain = (model, maxTokens) => ({ 'x.json': { seats: { critics: [{ provider: 'openrouter', model, maxTokens }] } } });
  const row = (extra) => () => ({ maxOutput: null, ...extra });
  const ceil = () => 64000, retry = cutOffRetryCap;
  assert.match(outputLimitProblems(chain('vendor/unnamed', 128000), row({ maxOutputNote: 'none found; read 2026-10-23' }), ceil, retry).join('|'), /not in the no-published-limit set/);
  assert.match(outputLimitProblems(chain('minimax/minimax-m3', 128000), row({}), ceil, retry).join('|'), /without a dated maxOutputNote/);
  assert.match(outputLimitProblems(chain('minimax/minimax-m3', 36000), row({ maxOutputNote: 'none found; read 2026-10-23' }), ceil, retry).join('|'), /would be retried at 64000/);
  assert.deepEqual(outputLimitProblems(chain('minimax/minimax-m3', 128000), row({ maxOutputNote: 'none found; read 2026-10-23' }), ceil, retry), [], 'the good case: named, dated, cap 128000 is not retried');
  assert.match(outputLimitProblems(chain('minimax/minimax-m3', 128000), () => ({ maxOutput: 'x' }), ceil, retry).join('|'), /neither a number nor null/);
});

test('every shipped, non-mock chain reasons at high: the lint rule is clean, and each seat the table has a field for says so explicitly in its file', () => {
  for (const [file, cfg] of Object.entries(shipped)) {
    if (isMockChain(cfg)) continue;
    const findings = lintChain(cfg, join(root, 'chains', file)).filter(f => f.kind === 'reasoning-not-high');
    assert.deepEqual(findings, [], `${file}: ${findings.map(f => f.message).join(' | ')}`);
    for (const s of realSeats(cfg)) {
      const row = rowOf(s);
      if (!row?.form || row.defaultAboveHigh) continue;
      assert.deepEqual(reasoningProblems({ ...s, extra: s.extra }, s.maxTokens), [], `${file}: ${s.provider}/${s.model}`);
      // Explicit: the file itself carries the high setting (the harness default is only a backstop for a user's own chain).
      assert.equal(highExtraFor(s, s.maxTokens), null, `${file}: ${s.provider}/${s.model} leaves "high" to the harness default; write it in the chain`);
    }
  }
});

test('reasoning-not-high: binds a shipped chain only (a user\'s own chain passes through), and a mock chain is excepted by its seats', () => {
  const lowering = { seats: { critics: [{ provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 12000, extra: { reasoning: { effort: 'low' } } }] } };
  const shippedPath = join(root, 'chains', 'x.json');
  assert.equal(isShippedChainPath(shippedPath), true);
  assert.equal(isShippedChainPath('/tmp/some-project/chains/x.json'), false);
  assert.equal(isShippedChainPath('<chain>'), false);
  const hit = lintChain(lowering, shippedPath).filter(f => f.kind === 'reasoning-not-high');
  assert.equal(hit.length, 1);
  assert.match(hit[0].message, /an effort below high/);
  assert.deepEqual(lintChain(lowering, '/tmp/some-project/chains/x.json').filter(f => f.kind === 'reasoning-not-high'), [], 'a user\'s own chain is not bound (owner, 5 Oct)');
  // Every planted lowering setting fails a shipped chain.
  const planted = [
    ['anthropic', 'claude-sonnet-5', { thinking: { type: 'disabled' } }],
    ['anthropic', 'claude-sonnet-5', { output_config: { effort: 'medium' } }],
    ['openrouter', 'qwen/qwen3.5-plus-20260420', { reasoning: { enabled: false } }],
    ['openrouter', 'z-ai/glm-5.3-flash', { reasoning: { effort: 'low' } }],
    ['openrouter', 'openai/gpt-6.1-sol', { reasoning: { exclude: true } }],
    ['openrouter', 'openai/gpt-6.1-sol', { reasoning: { max_tokens: 2000 } }],
    ['openai', 'gpt-5', { reasoning_effort: 'minimal' }],
    ['zai', 'glm-4.7-flash', { thinking: { type: 'disabled' } }],
    ['together', 'Qwen/Qwen3.5-9B', { chat_template_kwargs: { enable_thinking: false } }],
    ['together', 'deepseek-ai/DeepSeek-V4-Flash-0731', { chat_template_kwargs: { thinking: false } }],
    ['anthropic', 'claude-haiku-4-5-20251001', { thinking: { type: 'enabled', budget_tokens: 1024 } }],
  ];
  for (const [provider, model, extra] of planted) {
    const cfg = { seats: { critics: [{ provider, model, maxTokens: 16000, extra }] } };
    assert.ok(lintChain(cfg, shippedPath).some(f => f.kind === 'reasoning-not-high'), `${provider}/${model} ${JSON.stringify(extra)} was not refused`);
  }
  // A mock chain is excepted because every seat is mock, not because of its file name.
  const mock = { seats: { critics: [{ provider: 'mock', model: 'mock-critic-a', extra: { reasoning: { effort: 'low' } } }] } };
  assert.deepEqual(lintChain(mock, join(root, 'chains', 'mock-whatever.json')).filter(f => f.kind === 'reasoning-not-high'), []);
  const mixed = { seats: { critics: [{ provider: 'mock', model: 'mock-critic-a' }, { provider: 'openrouter', model: 'openai/gpt-6.1-sol', extra: { reasoning: { effort: 'low' } } }] } };
  assert.equal(lintChain(mixed, join(root, 'chains', 'mock-looking-name.json')).filter(f => f.kind === 'reasoning-not-high').length, 1, 'a chain named like a mock chain but holding a real seat is not excepted');
  // The chain-lint check also reaches a seat nested under another stage key (the same walk the runtime guards read).
  const nested = { seats: { critics: [{ provider: 'openrouter', model: 'openai/gpt-6.1-sol' }], alternatives: [{ provider: 'openrouter', model: 'openai/gpt-6.1-sol', extra: { reasoning: { effort: 'medium' } } }] } };
  assert.equal(lintChain(nested, shippedPath).filter(f => f.kind === 'reasoning-not-high').length, 1);
});

test('structural guard: every reasoning-looking key on a shipped seat is the table\'s own high form; a seat the table has no field for carries none', () => {
  // A new spelling of "off" or "low" cannot hide in a chain: any key whose path looks like a reasoning control must be a path the seat's own form writes.
  const leaves = (o, prefix = '', out = []) => { for (const [k, v] of Object.entries(o || {})) { const p = prefix ? `${prefix}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, p, out); else out.push(p); } return out; };
  const looks = /think|reason|effort|budget/i;   // a literal on purpose: test/regression-081-audit-reaudit.test.js (RA-13) pins that the detector's REASONING_WORDS equals it
  const problems = [];
  for (const [file, cfg] of Object.entries(shipped)) {
    if (isMockChain(cfg)) continue;
    for (const s of realSeats(cfg)) {
      const row = rowOf(s);
      const allowed = new Set();
      if (row?.form && !row.defaultAboveHigh) {
        leaves(REASONING_TABLE.forms[row.form].extra).forEach(p => allowed.add(p));
        if (row.form === 'anthropic-budget') ['thinking.type', 'thinking.budget_tokens'].forEach(p => allowed.add(p));
      }
      // CHANGED ACCEPTED GUARD (roster apply, 18 Okt 2026). OLD: a seat on a model whose own default is above high (defaultAboveHigh) carries NO reasoning key. NEW: it may carry `reasoning.effort` equal to the table's own defaultEffort for that model (the roster files state each model's highest effort explicitly:
      // GLM 5.3 / Flash `max`, Qwen 3.8 Max `xhigh`); any other value there, and every other key, still fails. WHY: owner, via the caps session ("EFFORT = EACH MODEL'S HIGHEST"); stating the model's own default is not a lowering, and the guard's job (no new spelling of off/low can hide) is kept.
      // CHANGED ACCEPTED GUARD (HIGH unit, 23 Okt 2026): back to the OLD bar. OLD (roster apply, above): a defaultAboveHigh seat may state reasoning.effort equal to the table's defaultEffort. NEW: it carries NO reasoning key, so the harness sends it no effort setting and the model runs at its own default; the 27 explicit max/xhigh seats of nine chains are gone. WHY: Muad, 23 Okt 2026 20:44: "High should be *our* default setting. Some models are so cheap that *their* default is Max effort, and we can go with that".
      for (const p of leaves(s.extra).filter(p => looks.test(p))) if (!allowed.has(p)) problems.push(`${file}: ${s.provider}/${s.model} extra.${p}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('single-vendor reroute (0.8.1 R review): the native high field is dropped and the vendor field is added; a seat\'s own different field stays alone', () => {
  const via = seat => resolveVendorSeat(seat, 'openrouter');
  const sonnet = via({ provider: 'anthropic', model: 'claude-sonnet-5', extra: { output_config: { effort: 'high' } } });
  assert.equal(sonnet.extra, undefined);
  assert.deepEqual(extraWithHighDefault(sonnet), { reasoning: { effort: 'high' } });
  // A user's own different native setting (a higher or a lower one) is kept and nothing is added beside it: one reasoning field on the wire.
  for (const own of [{ output_config: { effort: 'max' } }, { output_config: { effort: 'low' } }]) {
    const v = via({ provider: 'anthropic', model: 'claude-sonnet-5', extra: own });
    assert.deepEqual(extraWithHighDefault(v), own);
  }
  const gpt = via({ provider: 'openai', model: 'gpt-5', extra: { reasoning_effort: 'xhigh' } });
  assert.deepEqual(extraWithHighDefault(gpt), { reasoning_effort: 'xhigh' });
  // Haiku: only a budget equal to the rule's (half the cap) is the native high; another budget is the seat's own.
  const rule = via({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', maxTokens: 16000, extra: { thinking: { type: 'enabled', budget_tokens: 8000 } } });
  assert.deepEqual(extraWithHighDefault(rule, 16000), { reasoning: { effort: 'high' } });
  const own = via({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', maxTokens: 16000, extra: { thinking: { type: 'enabled', budget_tokens: 3000 } } });
  assert.deepEqual(extraWithHighDefault(own, 16000), { thinking: { type: 'enabled', budget_tokens: 3000 } });
});
