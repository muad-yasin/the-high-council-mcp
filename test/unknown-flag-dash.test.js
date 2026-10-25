// T1-1 (13 Oct 2026): a dash-typed option passed the unknown-option guard and a paid run started. `---dry-run`, `—dry-run` (a pasted em dash), `–dry-run`, `−−dry-run`, `‐‐dry-run` (U+2010), a zero-width space before `--dry-run`,
// `—max-usd 0.5` (the flag and its value dropped under the default cap), `--max‑usd 0.5` (U+2011 inside the name), `--dry-run,`, `--label —dry-run` (a free-form value flag ate the option as its value): each is now refused, exit 2, nothing started.
// Every spawn runs in a fresh temp directory on the all-mock chain, so even a regression costs $0 and never touches the shared runs/ folder. The probe that found them: scratch/c/dash/probe-dash.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUnknownFlag, unknownFlagLine } from '../src/unknown-flag.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const VALUE = new Set(['chain', 'task', 'label', 'max-usd']);
const BOOL = new Set(['dry-run', 'json']);
function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dash-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/x.md', ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });

function mcpSession(cwd, calls, { timeoutMs = 60_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const want = new Set([1, ...calls.map((_, i) => i + 2)]);
    const byId = new Map();
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
      }
      if ([...want].every(id => byId.has(id))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(byId); }
    });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inputs', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);

// the thirteen shapes the probe found; `code` is the look-alike the sentence must name ('' for plain ASCII shapes)
const SHAPES = [
  [['---dry-run'], ''], [['—dry-run'], 'U+2014'], [['–dry-run'], 'U+2013'], [['—max-usd', '0.5'], 'U+2014'], [['−−dry-run'], 'U+2212'], [['‐‐dry-run'], 'U+2010'],
  [['​--dry-run'], 'U+200B'], [['---max-usd', '0.5'], ''], [['--max‑usd', '0.5'], 'U+2011'], [['--dry-run,'], ''], [['--max‑usd=0.5'], 'U+2011'],
  [['--label', '—dry-run'], 'U+2014'], [['--label', '---dry-run'], ''],
  // T1-1 fix-up: a leading SPACE of any kind (a no-break space skipped the guard and a paid run started at the default cap) and the superscript / subscript / heavy minus signs
  [['\u00a0--dry-run'], 'U+00A0'], [[' --dry-run'], 'U+0020'], [['\u3000--dry-run'], 'U+3000'], [['\u2007--max-usd', '0.5'], 'U+2007'],
  [['\u207b\u207bdry-run'], 'U+207B'], [['\u208b\u208bdry-run'], 'U+208B'], [['\u2796\u2796dry-run'], 'U+2796'], [['--label', '\u00a0--dry-run'], 'U+00A0'],
  [['\u{10D8F}\u{10D8F}dry-run'], 'U+10D8F'],
];

for (const [args, code] of SHAPES) {
  test(`T1-1 shape ${JSON.stringify(args)}: refused on the real CLI - exit 2, one line, nothing started, no run folder`, () => {
    const dir = workDir();
    try {
      const r = run(dir, args);
      assert.equal(r.status, 2, `${r.stderr}${r.stdout}`);
      assert.equal(existsSync(join(dir, 'runs')), false, 'a run folder was made');
      assert.equal(r.stdout, '');
      assert.equal(r.stderr.trim().split('\n').length, 1, 'one line');
      assert.match(r.stderr, /Nothing was run and nothing was spent\.$/m);
      if (code) assert.match(r.stderr, new RegExp(`this contains ${code.replace('+', '\\+')}`), 'the sentence names the character');
      else assert.match(r.stderr, /not an option of this command/);
      if (/dry-run/.test(args.join(' '))) assert.match(r.stderr, /did you mean --dry-run\?/);
      if (/max.usd/.test(args.join(' '))) assert.match(r.stderr, /did you mean --max-usd\?/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('T1-1 Q1, both sides: a value flag still takes `-x` (and a file-like `-notes.md`) as its value, but not a token that spells a KNOWN option once its look-alikes are folded', () => {
  const keep = workDir();
  try {
    for (const v of ['-x', '-notes.md', '-1']) {
      assert.equal(findUnknownFlag(['--label', v], VALUE, BOOL), null, `${v} is a value`);
    }
    const r = run(keep, ['--label', '-x']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(keep, 'runs')), true, 'the run started: -x was the label');
  } finally { rmSync(keep, { recursive: true, force: true }); }
  assert.equal(findUnknownFlag(['--label', '—dry-run'], VALUE, BOOL)?.token, '—dry-run');
  assert.equal(findUnknownFlag(['--label', '—dry-run is why'], VALUE, BOOL), null, 'free text with whitespace is a value, never an option');
  assert.equal(findUnknownFlag(['--label', '--not-an-option-name'], VALUE, BOOL)?.token, '--not-an-option-name', 'a `--` token was never a value (unchanged)');
});

test('T1-1 controls (green at the old code too): the real flag, -v first, a lone dash, a bare negative number and a plain unknown name keep their old behaviour and wording', () => {
  const dir = workDir();
  try {
    const ok = spawnSync(process.execPath, [cli, '--dry-run', '--json', '--chain', 'mock'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, timeout: 60_000 });
    assert.equal(ok.status, 0, ok.stderr); JSON.parse(ok.stdout);
    const bad = run(dir, ['--dry']);
    assert.equal(bad.status, 2);
    assert.equal(bad.stderr.trim(), '--dry: not an option of this command - did you mean --dry-run? Nothing was run and nothing was spent.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(findUnknownFlag(['-v'], VALUE, BOOL), null);
  assert.equal(findUnknownFlag(['-'], VALUE, BOOL), null, 'a lone dash is not an option');
  assert.equal(findUnknownFlag(['-1'], VALUE, BOOL), null, 'a bare negative number is not an option');
  assert.equal(findUnknownFlag(['--json', '--task', 'a.md'], VALUE, BOOL), null);
  assert.equal(unknownFlagLine({ token: '--dry', suggestion: 'dry-run' }), '--dry: not an option of this command - did you mean --dry-run? Nothing was run and nothing was spent.', 'the sentence of a plain unknown name is byte-identical');
});

test('T1-1 the new sentences: a look-alike hyphen is named by code point, an invisible character says so, and the plain spelling it suggests is shown', () => {
  assert.equal(unknownFlagLine({ token: '—dry-run', suggestion: 'dry-run', odd: { code: 'U+2014', invisible: false } }), '—dry-run: this contains U+2014, not the plain hyphen the options use - did you mean --dry-run? Nothing was run and nothing was spent.');
  assert.equal(unknownFlagLine({ token: '\u00a0--dry-run', suggestion: 'dry-run', odd: { code: 'U+00A0', invisible: true, space: true } }), '\u00a0--dry-run: this contains U+00A0, a space that is not part of an option - did you mean --dry-run? Nothing was run and nothing was spent.');
  assert.equal(unknownFlagLine({ token: '​--x', suggestion: null, odd: { code: 'U+200B', invisible: true } }), '​--x: this contains U+200B, an invisible character that is not part of an option. Nothing was run and nothing was spent.');
});

// The RULE, not a hand list (a hand list is how U+00A0 was missed): walk the whole code space and ask the guard about every character the rule names.
test('T1-1 the rule by category: every dash punctuation (Pd) character typed twice, every listed minus, and every space (Z) or format (Cf) character before --dry-run is refused', () => {
  const LISTED = [0x2212, 0x2043, 0x02D7, 0x207B, 0x208B, 0x2796, 0x10D8F];
  const missed = [];
  let dashes = 0; let lead = 0;
  for (let cp = 0; cp <= 0x10FFFF; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue;
    const ch = String.fromCodePoint(cp);
    const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    if (cp !== 0x2D && (LISTED.includes(cp) || /\p{Pd}/u.test(ch))) { dashes++; if (!findUnknownFlag([`${ch}${ch}dry-run`], VALUE, BOOL)) missed.push(`${hex} as a dash`); }
    if (/[\p{Z}\p{Cf}]/u.test(ch)) { lead++; if (!findUnknownFlag([`${ch}--dry-run`], VALUE, BOOL)) missed.push(`${hex} before the option`); }
  }
  assert.deepEqual(missed, []);
  assert.ok(dashes > 20 && lead > 150, `the walk covered ${dashes} dash-like and ${lead} space/format characters, not an empty set`);
});

test('T1-1 MCP: the guard runs on the argv the server builds: an allow_unfenced entry that is a dash-typed option is refused, nothing started', async () => {
  const dir = workDir();
  try {
    const res = await mcpSession(dir, [{ name: 'start_run', arguments: { chain: 'mock', task: 'tasks/x.md', allow_unfenced: ['—dry-run'], rounds: 1 } }]);
    const out = body(res.get(2));
    assert.equal(out.started, false, JSON.stringify(out));
    assert.match(JSON.stringify(out), /not the plain hyphen|not an option/);
    assert.deepEqual(existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')) : [], [], 'no run folder was made (the server makes the empty runs/ itself)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
