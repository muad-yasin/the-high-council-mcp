// 0.8.3 cap wording (Builder C, 24 Okt 2026; C&C thcmcp-cd order; plan note Review/Build_0.8.3/m8/C_CapWords_Plan_2026-10-24.md; A-DRAFT words, D's definitions F1-F8 in Review/Build_0.8.3/m8/D_Unreleased_Sweep_List_2026-10-24.md): a PAID run's limit is the number a person types
// (src/cli.js capGateApplies); `--max-usd`, `max_usd` and MAX_USD_PER_RUN only set the figure the screen suggests; $7 is the default cap the dry run compares a chain with and the cap of a chain with no paid seat. Six sentences a person or a model reads said otherwise
// ("every run stops at its spend cap ($7 unless you set --max-usd)", "Defaults to MAX_USD_PER_RUN or $7", "Default 7"): each is read on its REAL surface (the CLI, the MCP tools/list, the registry file, the bundle manifest). The figure 7 is read from src/default-cap.js, never typed here. $0, no keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_USD } from '../src/default-cap.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'thc-capwords-'));
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }); } catch { /* a leftover is a nuisance, never a failure */ } });

/** A property's description wherever the schema converter put it (on the property, or on the union it holds). */
const descOf = p => p?.description ?? p?.anyOf?.find(x => typeof x.description === 'string')?.description;

/** The server's tool list over stdio (the minimal client of test/advice-tools.test.js). */
function toolList() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd: work, env: { PATH: process.env.PATH, HOME: work, COUNCIL_ADVISE_MOCK: '1', ...malformedProviderKeys() } });   // only tools/list is asked: no run starts, and no key a clone holds can reach a provider (test/no-paid-chain-spawn.test.js)
    let buf = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('tools/list timed out')); }, 30_000);
    const send = m => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/list', params: {} }); }
        else if (m.id === 2) { clearTimeout(timer); child.kill(); resolve(m.result.tools); }
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cap-wording-test', version: '0' } } });
  });
}

test('doctor\'s "before paying" line: a paid run stops at the limit the person types; $7 is only the yardstick of the dry run', () => {
  const r = spawnSync(process.execPath, [cli, 'doctor'], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work }, timeout: 120_000 });
  const line = r.stdout.split('\n').find(l => l.includes('before paying:'));
  assert.ok(line, `the Start here block is printed: ${r.stdout.slice(-400)}${r.stderr.slice(-200)}`);
  assert.match(line, new RegExp(`prices it; a paid run stops at the limit you type before it starts \\(\\$${DEFAULT_MAX_USD} is the default cap the dry run compares a chain with\\)\\.$`), line);
  assert.doesNotMatch(line, /unless you set --max-usd/, 'the old claim that $7 is the cap of every run is gone');
});

test('start_run and resume_run: max_usd is the figure suggested, never the limit of a paid run (the MCP tool text a model reads)', async () => {
  const tools = await toolList();
  const start = tools.find(t => t.name === 'start_run'); const resume = tools.find(t => t.name === 'resume_run');
  assert.ok(start?.inputSchema?.properties?.max_usd, 'start_run has a max_usd property');
  assert.ok(resume?.inputSchema?.properties?.max_usd, 'resume_run has a max_usd property');
  const a = descOf(start.inputSchema.properties.max_usd);
  assert.equal(typeof a, 'string', 'the description sits on the property');
  assert.ok(a.startsWith("the figure to suggest as the run's spending limit"), a);
  assert.ok(a.includes('For a paid chain the limit is the number the person types in the dialog; this figure is only the suggestion, and "none" is refused (nothing started).'), a);
  assert.ok(a.includes(`(a user who set COUNCIL_MAX_USD_LIMIT gets the lesser of the two, with $${DEFAULT_MAX_USD} for an unset MAX_USD_PER_RUN); with neither set it suggests nothing.`), a);
  assert.ok(a.includes('A figure above COUNCIL_MAX_USD_LIMIT is refused, and so is "none" on a chain with no paid seat where the user set that limit; 0 is refused.'), a);
  assert.doesNotMatch(a, /Defaults to MAX_USD_PER_RUN|per-run spend ceiling in USD/, 'the old claim of a default ceiling is gone');
  const b = descOf(resume.inputSchema.properties.max_usd);
  assert.equal(typeof b, 'string', 'the description sits on the property');
  assert.ok(b.startsWith("the figure to suggest as the run's new total"), b);
  assert.ok(b.includes('A paid run its limit stopped asks the person for the new total in the dialog; this figure is only the suggestion.'), b);
  assert.doesNotMatch(b, /raise the per-run ceiling for the rest of this run, a positive number/);
  assert.ok(resume.description.includes('or a run its spending limit stopped (a paid run asks the person for a new, higher total; max_usd is the figure suggested)'), resume.description);
});

test('the registry listing: MAX_USD_PER_RUN is the suggested figure (its 7 is DEFAULT_MAX_USD); COUNCIL_MAX_USD_LIMIT is the ceiling and no longer "locks the cap"', () => {
  const env = json('server.json').packages.flatMap(p => p.environmentVariables ?? []);
  const perRun = env.find(v => v.name === 'MAX_USD_PER_RUN'); const limit = env.find(v => v.name === 'COUNCIL_MAX_USD_LIMIT');
  assert.ok(perRun && limit, 'both settings are listed');
  assert.ok(perRun.description.startsWith('The figure the spending-limit screen suggests for a paid run; the limit is the number the person types.'), perRun.description);
  assert.ok(perRun.description.includes(`the lesser of ${DEFAULT_MAX_USD} and COUNCIL_MAX_USD_LIMIT where that is set`) && perRun.description.includes(`the run's ceiling (${DEFAULT_MAX_USD} when unset)`), `the figure in the text is DEFAULT_MAX_USD: ${perRun.description}`);
  assert.doesNotMatch(perRun.description, /Per-run spend ceiling in US dollars|Default 7\./);
  assert.equal(Number(perRun.default), DEFAULT_MAX_USD, 'the field default is untouched (test/default-cap-figures.test.js)');
  assert.ok(limit.description.endsWith('Set it to the same value as MAX_USD_PER_RUN so the suggested figure and the ceiling are the same.'), limit.description);
  assert.doesNotMatch(limit.description, /to lock the cap/);
});

test('the bundle manifest: the one setting is the ceiling AND the figure the limit dialog suggests (it is written to both MAX_USD_PER_RUN and COUNCIL_MAX_USD_LIMIT)', () => {
  const m = json('mcpb/manifest.json');
  assert.equal(m.server.mcp_config.env.MAX_USD_PER_RUN, '${user_config.max_usd}');
  assert.equal(m.server.mcp_config.env.COUNCIL_MAX_USD_LIMIT, '${user_config.max_usd}');
  const d = m.user_config.max_usd.description;
  assert.ok(d.includes('The limit dialog suggests this figure, or a lower one Claude asks for, before each paid run; you type your limit there, up to this figure,'), d);
  assert.ok(d.endsWith('Claude cannot raise or remove this ceiling from a chat; change it here.'), d);
  assert.equal(m.user_config.max_usd.title, 'Spend ceiling per run (USD)', 'the title is pinned by the limit-refusal tests and stays');
});

test('usage text: --max-usd is the suggestion of a paid chain and the ceiling of a chain with no paid seat', () => {
  const r = spawnSync(process.execPath, [cli, '--help'], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work }, timeout: 60_000 });
  const text = `${r.stdout}${r.stderr}`;
  assert.ok(text.includes('council --task tasks/x.md --max-usd 2'), `the usage text is printed: ${text.slice(0, 200)}`);
  const start = text.indexOf('council --task tasks/x.md --max-usd 2');
  const block = text.slice(start, text.indexOf('council init', start)).replace(/\s+/g, ' ');
  assert.ok(block.includes(`a paid chain asks you to type its limit and suggests $2; the run stops before any stage that could take it past that. A chain with no paid seat has no screen: $2 is its ceiling (default $${DEFAULT_MAX_USD}, or MAX_USD_PER_RUN; --max-usd none disables it). A stopped run resumes with --resume and a higher total;`), block);
  assert.doesNotMatch(block, /and a higher ceiling|Default \$7, or/);
});
