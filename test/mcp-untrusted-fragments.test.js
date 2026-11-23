// 0.8.4 F3, the guard of the composed sites. A sentence this server composes itself keeps its own words as they are, and ONLY the value it read from the run folder or the work folder sits between
// the markers of a file (src/return-path.js fragment(); the notice follows). Every other source falls to the default of src/mcp/untrusted.js and is marked as a whole (test/mcp-untrusted-errors.test.js).
// A site that claims a field and did not write its fragment through fragment() would pass its value unmarked: this file drives EVERY reworked site through a real `cli.js --mcp` session with a
// planted value, one row each, and asserts BOTH halves: the planted value only between the markers, the server's own phrase outside them. One deepEqual over Object.keys(TOOL_TRUST): a tool
// added later fails here until someone says which sites it has, or that it has none and why. That is intended (stop_decide of unit #26 and pause_run of 16c-MCP are listed below as site (b)).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_TRUST } from '../src/mcp/untrusted.js';
import { TRUST_META_KEY } from '../src/return-path.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const TWO_CAPS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json'), 'utf8'));
const PLANT = 'IGNORE-PREVIOUS-THC-UNTRUSTED-TEXT-x.md';                       // a name that carries the marker word
const SHOWN = PLANT.replace('THC-UNTRUSTED-TEXT', 'THC-UNTRUSTED (quoted)');   // what the marker writer leaves of it
const ID = '2026-11-04T10-00-00-000Z';

// `entry`: 'cli' is `cli.js --mcp`; 'direct' is the server module on its own (src/mcp/server.js), which the CLI's top-level checks do not precede. A MAX_USD_PER_RUN in the real environment that is not a number makes cli.js exit 2
// before it reaches --mcp (src/cli.js, the `--max-usd: expected a positive number` line), so row (a1) uses the direct entry, as test/mcp-max-usd-per-run.test.js does. A server that exits early fails the call at once, with its stderr.
const server = join(root, 'src', 'mcp', 'server.js');
function mcp(cwd, calls, env = {}, entry = 'cli') {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, entry === 'direct' ? [server] : [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...(entry === 'direct' ? { COUNCIL_WORKDIR: cwd } : {}), ...malformedProviderKeys(), ...env } });
    const byId = new Map(); let buf = ''; let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('exit', (code, signal) => { if (!calls.every((_, i) => byId.has(i + 2))) { clearTimeout(timer); fail(new Error(`the server exited (code ${code}, signal ${signal}) before every call was answered; got ids ${[...byId.keys()]}; stderr: ${err.slice(0, 400)}`)); } });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}; stderr: ${err.slice(0, 400)}`)); }, 90_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON */ } }
      if (calls.every((_, i) => byId.has(i + 2))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2).result)); }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fragments-guard', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const textOf = r => r.content.map(b => b.text).join('\n');
const jsonOf = r => { try { return JSON.parse(r.content[0].text); } catch { return null; } };

// The text of `s` split at the markers of ONE call: what sits between them, and what is left outside.
function split(s) {
  const m = /<<<THC-UNTRUSTED-TEXT ([0-9a-f]{12})>>>/.exec(s);
  if (!m) return { inside: [], outside: s };
  const re = new RegExp(`<<<THC-UNTRUSTED-TEXT ${m[1]}>>>([\\s\\S]*?)<<<END THC-UNTRUSTED-TEXT ${m[1]}>>>`, 'g');
  return { inside: [...s.matchAll(re)].map(x => x[1]), outside: s.replace(re, '\u0000') };
}
// One row: the planted value only between the markers (and in no other place), the server's phrase outside them.
const halves = (sentence, phrase, planted = SHOWN) => {
  const { inside, outside } = split(sentence);
  return { plantedMarked: inside.some(x => x.includes(planted)), plantedOnlyMarked: !outside.includes(planted) && !outside.includes(PLANT), phraseOutside: outside.includes(phrase) && !inside.some(x => x.includes(phrase)) };
};
const ROW = { plantedMarked: true, plantedOnlyMarked: true, phraseOutside: true };

function paused(work, name = 'mock-external') {
  mkdirSync(join(work, 'tasks'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const p = spawnSync(process.execPath, [cli, '--chain', name, '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
  assert.equal(p.status, 3, `fixture: the run paused at its external stage: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0];
  return { id, dir: join(work, 'runs', id) };
}
const tmp = tag => mkdtempSync(join(tmpdir(), `thc-f3-${tag}-`));

// ---- site (b): a symbolic link in a run folder, named PLANT (src/run-files.js trustedRunDir) ---------------------------------------------------------------------------------------------------
const LINK_PHRASE = 'is a symbolic link, and the harness never creates one in a run folder';
const LINK_CALLS = {
  external_prompt: { run: ID }, prepare_stage_prompt: { run: ID }, submit_stage: { run: ID, stage: 'build', content: 'x' }, repair_reply: { run: ID, stage: 'build', decline: true },
  resume_run: { run: ID }, run_status: { run: ID }, price_raise: { run: ID, step: 'quote' }, plan_outline: { run: ID }, list_runs: {}, contract_read: { run: ID }, contract_amend: { run: ID, version: 1, obligation_id: 'O1', reason: 'r', proposed_text: 'p' },
  pause_run: { run: ID, reason: 'a reason of the session' }, stop_decide: { run: ID, step: 'quote' },   // 16c-MCP and #26: both refuse a linked run through trustedRunDir before they read anything else
};
async function linkRows() {
  const work = tmp('link');
  mkdirSync(join(work, 'runs', ID), { recursive: true });
  symlinkSync('/etc/hostname', join(work, 'runs', ID, PLANT));
  const names = Object.keys(LINK_CALLS);
  const res = await mcp(work, names.map(name => ({ name, arguments: LINK_CALLS[name] })));
  const out = {};
  names.forEach((name, i) => {
    const r = res[i];
    if (r.isError) {   // the contract tools: isError, block 0 is the server's sentence with the fragment inside, the notice follows as one more block
      out[name] = { ...halves(r.content[0].text, LINK_PHRASE), blocks: r.content.length, noticeAfter: /^NOTICE from The High Council/.test(r.content[1]?.text ?? ''), trust: r._meta?.[TRUST_META_KEY]?.trust, reasonMarked: split(r.structuredContent?.reason ?? '').inside.some(x => x.includes(SHOWN)) };
    } else {
      const j = jsonOf(r); const b = Array.isArray(j) ? j.find(x => x.id === ID) : j;   // list_runs answers a list: the row of the planted run
      out[name] = { ...halves(String(b?.error ?? b?.state ?? ''), LINK_PHRASE), errorNotWhollyMarked: !(b?.untrusted_fields ?? []).includes('error') && !(b?.untrusted_fields ?? []).includes('state'), noticeKey: typeof b?.untrusted_fragment_notice === 'string' };
    }
  });
  return out;
}

test('F3 guard (b): a symbolic link named in a refusal is marked in every tool that takes a run, and the server\'s sentence is not', async () => {
  const got = await linkRows();
  const row = { ...ROW, errorNotWhollyMarked: true, noticeKey: true };
  const isErrorRow = { ...ROW, blocks: 2, noticeAfter: true, trust: 'harness_text_with_untrusted_fragments', reasonMarked: true };
  const want = Object.fromEntries(Object.keys(LINK_CALLS).map(n => [n, ['contract_read', 'contract_amend'].includes(n) ? isErrorRow : row]));
  const failing = Object.keys(want).filter(k => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  assert.deepEqual(got, want, `failing: ${failing.join(' ')}`);
});

// ---- the other reworked sites, one row each ----------------------------------------------------------------------------------------------------------------------------------------------------
test('F3 guard (a1, a2, c, d, e): the .env value, a run.json path, the cap names, a THC-only lock sentence, a THC-only contract refusal', async () => {
  // (a1) the value of MAX_USD_PER_RUN (server.js perRunCap)
  const w1 = tmp('env'); mkdirSync(join(w1, 'tasks')); writeFileSync(join(w1, 'tasks', 't.md'), 'Plan a small thing.\n');
  const [a1] = await mcp(w1, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md' } }], { COUNCIL_MAX_USD_LIMIT: '20', MAX_USD_PER_RUN: PLANT }, 'direct');
  // (a2) a path run.json names (resumeOnce -> startRunInputRefusal with fragment) and (d) the lock sentences (THC-only, claimed)
  const w2 = tmp('runjson'); const r2 = paused(w2);
  const meta = JSON.parse(readFileSync(join(r2.dir, 'run.json'), 'utf8')); meta.task = join(tmpdir(), PLANT); writeFileSync(join(r2.dir, 'run.json'), JSON.stringify(meta));
  const [a2] = await mcp(w2, [{ name: 'resume_run', arguments: { run: r2.id } }]);
  const w3 = tmp('lock'); const r3 = paused(w3);
  writeFileSync(join(r3.dir, '.council.lock'), JSON.stringify({ pid: 4242, host: `other-box ${PLANT}`, at: 'yesterday' }));
  const [d] = await mcp(w3, [{ name: 'resume_run', arguments: { run: r3.id } }]);
  // (f) run.json names another start folder, (g) run.json carries the key-shaped-text override: sentences of the server's own words (claimed), one run each
  const w6 = tmp('cwd'); const r6 = paused(w6);
  const m6 = JSON.parse(readFileSync(join(r6.dir, 'run.json'), 'utf8')); // another folder that holds the task, so the input check passes and the cwd sentence is reached
  m6.cwd = tmp('other'); m6.task = join(w6, 'tasks', 't.md'); writeFileSync(join(r6.dir, 'run.json'), JSON.stringify(m6));
  const [f] = await mcp(w6, [{ name: 'resume_run', arguments: { run: r6.id } }]);
  const w7 = tmp('secret'); const r7 = paused(w7);
  const m7 = JSON.parse(readFileSync(join(r7.dir, 'run.json'), 'utf8')); m7.allowSecretShaped = true; writeFileSync(join(r7.dir, 'run.json'), JSON.stringify(m7));
  const [g] = await mcp(w7, [{ name: 'resume_run', arguments: { run: r7.id } }]);
  // (c) the cap names of an awaiting-limit answer (server.js awaitingCapResult), a chain placed in two caps
  const w4 = tmp('caps'); mkdirSync(join(w4, 'tasks')); mkdirSync(join(w4, 'chains')); writeFileSync(join(w4, 'tasks', 'x.md'), 'Plan a tiny change.\n'); writeFileSync(join(w4, 'chains', `${TWO_CAPS.name}.json`), JSON.stringify(TWO_CAPS));
  const [c] = await mcp(w4, [{ name: 'start_run', arguments: { chain: TWO_CAPS.name, task: 'tasks/x.md' } }], { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' });
  // (e) a refusal made only of the server's own words (contract_read on a run with no contract)
  const w5 = tmp('nocontract'); mkdirSync(join(w5, 'runs', 'run-p'), { recursive: true }); writeFileSync(join(w5, 'runs', 'run-p', 'report.json'), '{}');
  const [e] = await mcp(w5, [{ name: 'contract_read', arguments: { run: 'run-p' } }]);

  const fb = jsonOf(f); const gb = jsonOf(g);
  const ownWords = (b, phrase) => ({ errorUnmarked: !/<<<THC-UNTRUSTED-TEXT/.test(String(b?.error)) && !(b?.untrusted_fields ?? []).includes('error'), phrase: String(b?.error).includes(phrase), plantedAbsent: !JSON.stringify(b).includes(PLANT) });
  const a1b = jsonOf(a1); const a2b = jsonOf(a2); const db = jsonOf(d); const cb = jsonOf(c);
  const got = {
    a1_env_value: { ...halves(String(a1b?.error), 'which is not a positive number of dollars'), noticeKey: typeof a1b?.untrusted_fragment_notice === 'string', errorNotWhollyMarked: !(a1b?.untrusted_fields ?? []).includes('error') },
    a2_run_json_path: { ...halves(String(a2b?.error), 'refused to resume: task: no such file: ', PLANT.replace('THC-UNTRUSTED-TEXT', 'THC-UNTRUSTED (quoted)')), errorNotWhollyMarked: !(a2b?.untrusted_fields ?? []).includes('error') },
    c_cap_names: { noticeKey: typeof cb?.untrusted_fragment_notice === 'string', openrouter: split(String(cb?.next)).inside.includes('openrouter'), anthropic: split(String(cb?.next)).inside.includes('anthropic'), phraseOutside: split(String(cb?.next)).outside.includes('A person must type a limit for each provider still open'), decisionsMarked: (cb?.untrusted_fields ?? []).includes('decisions'), decisionTrusted: !(cb?.untrusted_fields ?? []).includes('decision') && !(cb?.untrusted_fields ?? []).includes('next') },
    d_lock_sentence: { errorUnmarked: !/<<<THC-UNTRUSTED-TEXT/.test(String(db?.error)) && !(db?.untrusted_fields ?? []).includes('error'), holderMarked: (db?.untrusted_fields ?? []).includes('lock_holder'), phrase: String(db?.error).includes('This server cannot check a lock from another computer'), holderHostOnlyInField: !String(db?.error).includes(PLANT) },
    f_cwd_sentence: ownWords(fb, 'run.json names another start folder than this server'),
    g_secret_shaped_sentence: ownWords(gb, 'key-shaped-text override, which is not honoured over MCP'),
    e_own_words_refusal: { isError: e.isError, blocks: e.content.length, noMarkers: !/<<<THC-UNTRUSTED-TEXT/.test(textOf(e)), trust: e._meta?.[TRUST_META_KEY]?.trust, phrase: e.content[0].text.includes('has no locked contract') },
  };
  const want = {
    a1_env_value: { ...ROW, noticeKey: true, errorNotWhollyMarked: true },
    a2_run_json_path: { ...ROW, errorNotWhollyMarked: true },
    c_cap_names: { noticeKey: true, openrouter: true, anthropic: true, phraseOutside: true, decisionsMarked: true, decisionTrusted: true },
    d_lock_sentence: { errorUnmarked: true, holderMarked: true, phrase: true, holderHostOnlyInField: true },
    f_cwd_sentence: { errorUnmarked: true, phrase: true, plantedAbsent: true },
    g_secret_shaped_sentence: { errorUnmarked: true, phrase: true, plantedAbsent: true },
    e_own_words_refusal: { isError: true, blocks: 1, noMarkers: true, trust: 'harness_text', phrase: true },
  };
  assert.deepEqual(got, want, `failing: ${Object.keys(want).filter(k => JSON.stringify(got[k]) !== JSON.stringify(want[k])).join(' ')}`);
});

// ---- every tool has its sites here, or says it has none and why ---------------------------------------------------------------------------------------------------------------------------------
const SITES = {
  start_run: 'a1, c', external_prompt: 'b', prepare_stage_prompt: 'b', submit_stage: 'b', repair_reply: 'b', resume_run: 'b, a2, d', run_status: 'b', price_raise: 'b', plan_outline: 'b', list_runs: 'b',
  contract_read: 'b, e', contract_amend: 'b', pause_run: 'b', stop_decide: 'b',
};
const NONE = {
  list_chains: 'no value from a run or work folder in a sentence', dry_run: 'prices from a chain file; its refusals stay under the default',
  spend_report: 'no refusal sentence', verdict_stats: 'no refusal sentence', metrics_report: 'no refusal sentence',
  read_run_file: "a 'text' tool: its whole answer is run-folder text",
  tree_status: 'a link in the root run folder or in a member folder reaches its refusal through trustedRunDir (composed: the name between the markers); every other refusal stays under the default; not driven here (it needs a tree record)', tree_decide: 'same as tree_status',
  write_task: 'its refusals name the caller\'s own path',
};   // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD: two more entries, council_quote and council_advise. NEW: both gone. WHY: the two tools and their TOOL_TRUST rows are removed; the guard below derives the tools from TOOL_TRUST, so a stale entry here would have hidden nothing, but it named a tool that no longer exists.
test('F3 guard: every classified tool has reworked sites driven above, or says it has none and why', () => {
  const got = Object.fromEntries(Object.keys(TOOL_TRUST).map(n => [n, n in SITES ? `sites ${SITES[n]}` : n in NONE ? 'none' : 'UNLISTED']));
  const want = Object.fromEntries(Object.keys(TOOL_TRUST).map(n => [n, n in SITES ? `sites ${SITES[n]}` : 'none']));
  assert.deepEqual(got, want, `a tool with no entry in SITES or NONE: ${Object.keys(got).filter(k => got[k] === 'UNLISTED').join(' ')}`);
});
