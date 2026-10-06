// 0.8.1 FX-11 (AMENDMENTS, found by the 2026-10-02 council run: a 6,704-character design reached the builder as 2,000):
// every whole architecture, debate post and author reply was cut to 2,000 characters before other seats read it, and
// critic fields too, silently. Now each kind has its own limit: architectures, posts and replies at least what the seat
// was allowed to write (its maxTokens at four characters a token, never under 40,000 characters), critic fields 8,000.
// Every cut is loud: a WARNINGS.md line and report.json `field_cuts` (stage, field, original and kept length).
// Offline: an external alternative seat answers with a 6,704-character shape, and a loader hook logs every prompt the
// mock seats are sent (the same technique as test/prompt-pin.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

function promptLogger(work) {
  const real = pathToFileURL(join(root, 'src', 'providers.js')).href;
  const wrap = pathToFileURL(join(work, 'providers-wrap.mjs')).href;
  writeFileSync(join(work, 'providers-wrap.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    `import { call as realCall } from ${JSON.stringify(`${real}?real`)};`,
    `export * from ${JSON.stringify(`${real}?real`)};`,
    'export async function call(provider, opts) {',
    '  appendFileSync(process.env.THC_PROMPT_LOG, JSON.stringify({ model: opts.model, system: opts.system, messages: opts.messages }) + "\\n");',
    '  return realCall(provider, opts);',
    '}',
  ].join('\n'));
  writeFileSync(join(work, 'hooks.mjs'), [
    'export async function resolve(spec, ctx, next) {',
    '  const r = await next(spec, ctx);',
    `  return r.url === ${JSON.stringify(real)} ? { ...r, url: ${JSON.stringify(wrap)} } : r;`,
    '}',
  ].join('\n'));
  writeFileSync(join(work, 'register.mjs'), `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(work, 'hooks.mjs')).href)});\n`);
  return join(work, 'register.mjs');
}

test('FX-11: a 6,704-character architecture reaches the skeleton prompt whole', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx11-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-tiered.json'), 'utf8'));
  c.name = 'fx11';
  c.seats.alternatives = [{ provider: 'external', model: 'claude-code-session', lab: 'anchor-a' }, c.seats.alternatives[1]];
  delete c.deep_dive; delete c.seats.deep_dive;
  writeFileSync(join(dir, 'chains', 'fx11.json'), JSON.stringify(c, null, 2));
  const register = promptLogger(dir);
  const env = { PATH: process.env.PATH, HOME: dir, THC_PROMPT_LOG: join(dir, 'prompts.jsonl') };
  const cliRun = args => spawnSync(process.execPath, ['--import', pathToFileURL(register).href, cli, ...args], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  const first = cliRun(['--chain', 'fx11', '--task', 'tasks/t.md']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const id = readdirSync(join(dir, 'runs'))[0];
  const rd = join(dir, 'runs', id);
  const label = readdirSync(rd).find(f => f.startsWith('NEEDS-alternative')).slice('NEEDS-'.length, -'.md'.length);
  // 6,704 characters, the size the real run lost, ending in a sentence that only the whole text carries.
  const shape = `${'An append-only event log feeds every read model; each read model can be rebuilt from the log. '.repeat(80).slice(0, 6671)} THE LAST SENTENCE OF THE DESIGN.`;
  assert.equal(shape.length, 6_704);
  writeFileSync(join(rd, `${label}.md`), JSON.stringify({ name: 'Event log', shape, key_tradeoffs: 'Rebuilds cost time.', bad_at: 'Ad-hoc queries.' }));
  // The external seat also posts in the architecture debate and replies to it: empty answers, until the run moves on.
  let again;
  for (let i = 0; i < 6; i++) {
    again = cliRun(['--resume', join('runs', id)]);
    if (again.status !== 3) break;
    for (const f of readdirSync(rd).filter(n => n.startsWith('NEEDS-'))) {
      const l = f.slice('NEEDS-'.length, -'.md'.length);
      if (!existsSync(join(rd, `${l}.md`))) writeFileSync(join(rd, `${l}.md`), l.startsWith('alt-debate') ? '{"posts": []}' : l.startsWith('alt-reply') ? '{"replies": []}' : '{}');
    }
  }
  assert.notEqual(again.status, 3, again.stdout + again.stderr);
  const prompts = readFileSync(join(dir, 'prompts.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const skeleton = prompts.find(p => p.model === c.seats.skeleton.model);
  assert.ok(skeleton, 'the skeleton seat was called');
  const text = [skeleton.system, ...(skeleton.messages || []).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))].join('\n');
  assert.ok(text.includes(shape), 'the whole shape is in the skeleton prompt');
  assert.doesNotMatch(text, /\[truncated, \d+ chars total\]/);
});

test('FX-11: critic fields keep 8,000 characters; an over-limit field is cut and recorded with its stage and field', async () => {
  const { normaliseCritique, fieldCutsSoFar, resetFieldCuts } = await import('../src/chain.js');
  resetFieldCuts();
  const long = 'p'.repeat(7_000);
  const ok = normaliseCritique({ meets: false, criteria: [], failures: [{ criterion: 'C1', problem: long, fix: 'fix it' }] }, () => {}, { stage: 'panel-1-x' });
  assert.equal(ok.failures[0].problem, long, '7,000 characters pass whole');
  const runaway = 'r'.repeat(20_000);
  const cut = normaliseCritique({ meets: false, criteria: [], failures: [{ criterion: 'C1', problem: runaway, fix: 'fix it' }] }, () => {}, { stage: 'panel-1-x' });
  assert.ok(cut.failures[0].problem.length < 9_000 && cut.failures[0].problem.length >= 8_000, String(cut.failures[0].problem.length));
  const cuts = fieldCutsSoFar();
  assert.equal(cuts.length, 1);
  assert.deepEqual(cuts[0], { stage: 'panel-1-x', field: 'problem', original: 20_000, kept: 8_000 });
});

test('FX-11 (M2 review): report.json field_cuts validates against the schema (stage and field are strings)', async () => {
  const { reportJsonShape } = await import('../src/report-shape.js');
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r', chain: 'c', task: 't', result: { criteria: ['x'], stages: [], totals: { usd: 0 }, fieldCuts: [{ stage: 'advise', field: 'opinion', original: 9_000, kept: 8_000 }] } })));
  assert.deepEqual(report.field_cuts, [{ stage: 'advise', field: 'opinion', original: 9_000, kept: 8_000 }]);
  const sub = { type: 'object', properties: { field_cuts: JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')).properties.field_cuts } };
  const v = ajv.compile(sub);
  assert.equal(v({ field_cuts: report.field_cuts }), true, JSON.stringify(v.errors));
});
