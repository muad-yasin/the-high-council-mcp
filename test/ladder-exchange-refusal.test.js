// 0.8.4 S6 (M1), U6-6 (Q2; C&C: REFUSE, not ignore; the MCP surface): once the shortened exchange is in force (the pair W5 + W14 recorded), layers 2 and 3 have their own exchange round and `--ladder-exchange` (CLI) / `ladder_exchange` (start_run) is refused with ANY value
// before any call or run id; its descriptions say so. While the pair is held the flag works as it always did and every sentence is what it was. Offline, $0. WRITTEN WITHOUT A RUN (overnight, no box).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import * as SL from '../src/mcp/start-ladder.js';
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => setHeldForTest(null));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = join(root, 'test', 'helpers', 'short-exchange-preload.js');
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };
const CLI_SENTENCE = '--ladder-exchange is no longer used: layers 2 and 3 have their own exchange round. Leave the flag out. Nothing was run and nothing was spent.';
const WRITER = { provider: 'mock', model: 'mock-builder', lab: 'author' };
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ladx-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify({ name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: WRITER, reviser: WRITER, critics: [1, 2, 3].map(n => ({ provider: 'mock', model: `mock-critic-script-o-m${n}`, lab: `l${n}`, layer: n })) } }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = (args, preload = false) => spawnSync(process.execPath, [...(preload ? ['--import', PRELOAD] : []), join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};

test('Q2 (CLI): with the pair recorded `--ladder-exchange` is refused with any value, with or without --ladder, before any call: exit 2, the sentence, before any stage', () => {
  const p = project();
  try {
    for (const args of [['--ladder', '--ladder-exchange', '2'], ['--ladder', '--ladder-exchange', '0'], ['--ladder-exchange', '1'], ['--ladder', '--ladder-exchange', '9'], ['--ladder', '--ladder-exchange']]) {
      const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', ...args], true);
      assert.equal(r.status, 2, `${args.join(' ')}: exit 2 (${r.stderr})`);
      assert.ok(r.stderr.includes(CLI_SENTENCE), `${args.join(' ')}: the sentence (${r.stderr})`);
      assert.equal(/go with --ladder|needs a number of exchange rounds/.test(r.stderr), false, `${args.join(' ')}: neither older sentence: the refusal comes first`);
    }
    assert.equal(existsSync(join(p.dir, 'runs')) && readdirSync(join(p.dir, 'runs')).some(d => existsSync(join(p.dir, 'runs', d, 'criteria.md'))), false, 'refused before any stage ran');
  } finally { p.done(); }
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'PIN (held)' and 'PIN (held, MCP)' asserted that without the pair `--ladder-exchange` / `ladder_exchange` worked and every sentence of start-ladder.js was what it was. NEW: both held rows are removed (K7: after the recording no shipped run is held; SIBLINGS: 'Q2 (CLI)' and 'Q2 (MCP)', which assert the refusal as recorded). WHY: shortExchangeRule and signoffLineRule are recorded (shortExchangeOn()).

test('Q2 (MCP): with the pair recorded start_run refuses ladder_exchange with any value, with or without ladder: true, before a run id is taken; ladder and ladder_credit alone still work; the sentences that name the argument say so', () => {
  setHeldForTest(PAIR);
  for (const args of [{ ladder: true, ladder_exchange: 2 }, { ladder: true, ladder_exchange: 0 }, { ladder_exchange: 1 }, { ladder: true, ladder_exchange: 2, ladder_credit: 3 }]) assert.deepEqual(SL.ladderStartArgs(args), { refused: SL.LADDER_EXCHANGE_NOT_USED_SENTENCE }, JSON.stringify(args));
  assert.equal(SL.LADDER_EXCHANGE_NOT_USED_SENTENCE, 'ladder_exchange is no longer used: layers 2 and 3 have their own exchange round. Leave it out. Nothing was started and nothing was spent.');
  assert.deepEqual(SL.ladderStartArgs({ ladder: true, ladder_credit: 3 }), { args: ['--ladder', '--ladder-credit', '3'] });
  assert.deepEqual(SL.ladderStartArgs({ ladder: true }), { args: ['--ladder'] });
  assert.deepEqual(SL.ladderStartArgs({ ladder_credit: 3 }), { refused: 'ladder_credit goes with ladder: true. Nothing was started and nothing was spent.' });
  assert.match(SL.ladderExchangeDescription(), /^no longer used: layers 2 and 3 have their own exchange round/);
  assert.equal(/ladder_exchange|--ladder-exchange/.test(SL.ladderStartDescription()), false, 'the tool description no longer names the argument');
});


