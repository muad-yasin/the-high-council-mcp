// 0.8.3 M6 unit 2b (gate page Restore_Gap_Gate_Page.md 12.5, C&C 14 Oct 2026): EVERY reader of a node's plan must be taught which body hash the RECORD accepts for it, or be on a reasoned allow list. The census is found BY IMPORT, not by recall: a reader
// that aliases, namespace-imports, re-exports or passes the function as a value is a new reader to enumerate, and the scan FAILS on it. Model: test/tree-readiness-codes-pin.test.js (its self-test feeds the scanner bad sources, so the scanner can fail).
// The tables below are written out by hand: a new file, a new call or a changed count fails here until someone decides it (and writes the reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
const filesUnder = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith('.js') ? [p] : []; });
/** Code without comments, by LINE (a tokenizer would be fooled by a quote inside a regex literal in the 3,500-line cli.js, and a block-comment regex eats whole regions at a '/*' inside a string): whole-line `//` and `*` comment lines and `/* ... */` lines go,
 *  and a trailing ` // ...` after whitespace. Strings are kept: none of the censused names appears inside one. */
const code = text => text.split('\n').map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\s\/\*[^\n]*?\*\//g, ' ').replace(/\s\/\/.*$/, ''))).join('\n');

/** The text of the call whose open paren is at `at` (balanced), without the parens. */
function argsAt(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') { depth -= 1; if (depth === 0) return text.slice(at + 1, i); }
  }
  return text.slice(at + 1);
}
/** Every CALL of `name` in `text` that is not its definition or an import: [{ args }]. */
function callsOf(text, name) {
  const out = [];
  const re = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g');
  for (let m; (m = re.exec(text));) {
    if (/function\s*$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;       // the definition
    out.push({ args: argsAt(text, m.index + m[0].length - 1) });
  }
  return out;
}

/** The structural findings for one source: how it imports tree-derive-load.js and any use of the names as a value. -> [string] */
export function structuralFindings(file, source) {
  const text = code(source); const found = [];
  const importRe = /import\s*([^;]*?)\s*from\s*['"]([^'"]*tree-derive-load(?:\.js)?)['"]/g;
  for (let m; (m = importRe.exec(text));) {
    const clause = m[1];
    if (/\*\s*as\b/.test(clause)) found.push(`${file}: a namespace import of tree-derive-load.js (every use of it is a reader the table cannot see)`);
    if (/\breadNodePlan\s+as\b/.test(clause) || /\breadPlanOf\s+as\b/.test(clause)) found.push(`${file}: readNodePlan/readPlanOf imported under another name`);
  }
  if (/import\s*\(\s*['"][^'"]*tree-derive-load/.test(text)) found.push(`${file}: a dynamic import of tree-derive-load.js`);
  if (/export\s*(\*|\{[^}]*\})\s*from\s*['"][^'"]*tree-derive-load/.test(text)) found.push(`${file}: re-exports from tree-derive-load.js (a new reader the table cannot see)`);
  for (const name of ['readNodePlan', 'readPlanOf']) {
    const re = new RegExp(`(?<![\\w.$])${name}\\b(?!\\s*\\()`, 'g');
    for (let m; (m = re.exec(text));) {
      const before = text.slice(0, m.index); const lineStart = before.lastIndexOf('\n') + 1;
      const line = text.slice(lineStart, text.indexOf('\n', m.index) < 0 ? undefined : text.indexOf('\n', m.index));
      if (/^\s*import\b|^\s*export\s+function\b|^\s*export\s*\{/.test(line) || /\bfunction\s+(readNodePlan|readPlanOf)\b/.test(line) || /^[^(]*\bimport\b[^;]*\bfrom\b/.test(line) || /^\s*[\w$,\s]*\}?\s*from\s*['"]/.test(line) || /^\s*(?:import\s*)?\{[^}]*\}\s*from/.test(line)) continue;
      if (/^\s*import\s*\{[\s\S]*$/.test(line)) continue;
      found.push(`${file}: ${name} used as a value, not called (an alias or a callback hides a reader)`);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------------------- the census, written by hand (graded at c3b9ffa, re-counted at d668ee8 by this test)
// callers of readPlanOf (the record-aware reader), per file
// 15 Okt 2026 (census update, A; C&C classified it: not a record-path hole): + 'tree-rebuild.js': 1 - the REBUILD unit (picked as 7f57d2d) reads the PARENT's split through readPlanOf (src/tree-rebuild.js, the record-aware reader: planAuthorityOf's accepted hash is passed), with no readNodePlan beside it. The other entries and every other assertion are unchanged.
// CHANGED ACCEPTED (19 Okt 2026, PII stop unit): OLD had no tree-member-cover.js. NEW: a member re-derives its own bundle to find the root-task stretches a root allowance covers (src/tree-member-cover.js, one readPlanOf, read-only; the child's plan authority is the same pinned body as at registration).
// 20 Okt 2026 (CHANGED ACCEPTED): + 'old-plan.js': 1 - oldPlanOf reads the earlier plan the way every plan reader does (readPlanOf, against the hash the record accepts), for the bundle unit's earlier-plan data (tree decide / the member / the slot route).
// PROPOSED, WAITING FOR C&C's CLASSIFICATION (23 Okt 2026, red-triage oversize unit; found by the box set of e69a2ed; the earlier entries above record who classified them): OLD had no tree-decide-size.js. NEW: + 'tree-decide-size.js': 1 - the what-if size check at decide reads the PARENT's split block through readPlanOf (the record-aware reader: it applies the hash the record accepts), the same read registration makes (loadDerivation, tree-loop.js); read-only, no readNodePlan beside it, nothing is written or recorded from it.
// tree-ready.js 1 -> 2 (lane T, G1, D2 F2(b)): the live re-derivation of a refused, unregistered child reads its parent's verified block through readPlanOf (the record-accepted body), like every other reader
const READPLANOF = { 'old-plan.js': 1, 'tree-affected.js': 1, 'tree-decide-size.js': 1, 'tree-check.js': 2, 'tree-decide.js': 1, 'tree-decide-stop.js': 1, 'tree-derive-load.js': 2, 'tree-frontier.js': 3, 'tree-loop.js': 3, 'tree-member-cover.js': 1, 'tree-obligation.js': 1, 'tree-ready.js': 2, 'tree-rebuild.js': 1, 'tree-reuse-load.js': 4, 'tree-stop-view.js': 1 };
// DIRECT calls of readNodePlan outside its own file: each must carry an `acceptedBodySha256` argument (the three functions that take only a run folder)
const READNODEPLAN_DIRECT = { 'tree-handoff.js': 1, 'tree-loop.js': 1, 'tree-ready.js': 1 };
// readNodePlan( inside tree-derive-load.js: the definition is not counted; readPlanOf's own call is the one
const READNODEPLAN_INSIDE = 1;
// the other readers of the same authority: call counts, and which files may call WITHOUT the accepted argument, each with its reason
const BODYOFDELIVERED = { 'tree-derive-load.js': 1, 'tree-expansion.js': 1, 'tree-member.js': 1, 'tree-restore.js': 1, 'cli.js': 1 };
const BODYOFDELIVERED_NO_ACCEPTED = { 'tree-member.js': 'closedFieldsOf runs at CLOSE, before any acceptance exists', 'cli.js': 'a live run: the plan is being written, nothing is accepted yet' };
const EXPANSIONCHECK = { 'tree-continuation.js': 1, 'tree-derive-load.js': 1, 'tree-expansion.js': 1, 'tree-frontier.js': 1, 'tree-loop.js': 1 };
const EXPANSIONCHECK_NO_ACCEPTED = { 'tree-expansion.js': 'verifySplit verifies a node\'s FIRST split at close; an accepted node always carries its verified split already (the table refuses a changed split)' };
const CONTRACTCHECKOF = { 'cli.js': 1, 'tree-expansion.js': 1, 'tree-ready.js': 1, 'tree-restore.js': 1 };
const CONTRACTCHECKOF_NO_ACCEPTED = { 'cli.js': 'the person\'s own `council contract check` keeps reporting an edited file as DRIFT (gate page Q-B7: true, and what a person running it should see)' };

const allSources = () => Object.fromEntries(filesUnder(SRC).map(f => [relative(SRC, f), readFileSync(f, 'utf8')]));
const base = f => f.split('/').pop();

function tableFor(sources, name, { skipDefinitionFile = null } = {}) {
  const out = {};
  for (const [file, src] of Object.entries(sources)) {
    const n = callsOf(code(src), name).length;
    if (n) out[base(file)] = n;
  }
  return out;
}

test('every file that imports tree-derive-load.js does so by a named import, with no alias, no namespace, no dynamic import, no re-export, and nobody uses readNodePlan or readPlanOf as a VALUE', () => {
  const problems = Object.entries(allSources()).flatMap(([file, src]) => structuralFindings(file, src));
  assert.deepEqual(problems, []);
});

test('CENSUS: readPlanOf has exactly the callers written down, and readNodePlan is called directly only where a run folder is all there is (each such call carries acceptedBodySha256)', () => {
  const sources = allSources();
  assert.deepEqual(tableFor(sources, 'readPlanOf'), READPLANOF);
  const direct = {}; let inside = 0;
  for (const [file, src] of Object.entries(sources)) {
    const calls = callsOf(code(src), 'readNodePlan');
    if (base(file) === 'tree-derive-load.js') { inside = calls.length; continue; }
    if (calls.length) direct[base(file)] = calls.length;
    for (const c of calls) assert.match(c.args, /acceptedBodySha256/, `${file}: a direct readNodePlan call without the accepted hash: ${c.args.slice(0, 80)}`);
  }
  assert.deepEqual(direct, READNODEPLAN_DIRECT);
  assert.equal(inside, READNODEPLAN_INSIDE);
  // every file that CALLS readPlanOf imports it from tree-derive-load.js (no local look-alike)
  for (const [file, src] of Object.entries(sources)) if (callsOf(code(src), 'readPlanOf').length && base(file) !== 'tree-derive-load.js') assert.match(code(src), /import\s*\{[^}]*\breadPlanOf\b[^}]*\}\s*from\s*'\.\/tree-derive-load\.js'/, `${file} imports readPlanOf from tree-derive-load.js`);
});

test('CENSUS: the other readers of the same authority (bodyOfDelivered, expansionCheck, contractCheckOf) have exactly the callers written down; each passes the accepted hash or is on the reasoned list', () => {
  const sources = allSources();
  for (const [name, table, reasons] of [['bodyOfDelivered', BODYOFDELIVERED, BODYOFDELIVERED_NO_ACCEPTED], ['expansionCheck', EXPANSIONCHECK, EXPANSIONCHECK_NO_ACCEPTED], ['contractCheckOf', CONTRACTCHECKOF, CONTRACTCHECKOF_NO_ACCEPTED]]) {
    const own = { bodyOfDelivered: 'tree-split.js', expansionCheck: null, contractCheckOf: 'run-contract-check.js' }[name];
    const got = {};
    for (const [file, src] of Object.entries(sources)) {
      if (base(file) === own) continue;
      const calls = callsOf(code(src), name);
      if (!calls.length) continue;
      got[base(file)] = calls.length;
      if (!reasons[base(file)]) for (const c of calls) assert.match(c.args, /accepted|planAuthorityOf/i, `${file}: ${name}( without the accepted hash and not on the reasoned list: ${c.args.slice(0, 80)}`);
    }
    assert.deepEqual(got, table, name);
    for (const [file, why] of Object.entries(reasons)) assert.ok(why.length > 20 && table[file], `${name}: the allow-list entry ${file} names its reason and is a real caller`);
  }
});

test('the readiness verdict has exactly ONE info reason (accepted_change): a note, never a blocker, never a code the restore table must decide', () => {
  const ready = code(readFileSync(join(SRC, 'tree-ready.js'), 'utf8'));
  const infos = [...ready.matchAll(/add\(\s*'info'\s*,\s*'([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual(infos, ['accepted_change']);
  assert.equal(/add\(\s*'info'\s*,\s*[^'\s]/.test(ready), false, 'an info reason names its code as a literal');
});

// 2c (C&C 14 Oct 2026: "candidatePlanAccept: the pin census counts its callers"): the ONE writer of plan_accepted and its view have exactly the callers written down. 2d adds the session channel's caller, and this table is where that is read.
const ACCEPT_WRITER_CALLERS = { candidatePlanAccept: { 'tree-accept.js': 1, 'tree-decide-accept.js': 1 }, acceptChangedPlan: { 'tree-decide-accept.js': 1 } };
test('CENSUS: acceptChangedPlan and candidatePlanAccept have exactly the callers written down (2c: the person\'s typed form); no MCP tool, no api.js and no sitting reaches the writer yet', () => {
  const sources = allSources();
  for (const [name, table] of Object.entries(ACCEPT_WRITER_CALLERS)) {
    const got = {};
    for (const [file, src] of Object.entries(sources)) { const n = callsOf(code(src), name).length; if (n) got[base(file)] = n; }
    assert.deepEqual(got, table, name);
  }
  for (const [file, src] of Object.entries(sources)) if (/^mcp\//.test(file) || file === 'api.js' || file === 'tree-run.js') for (const name of Object.keys(ACCEPT_WRITER_CALLERS)) assert.equal(callsOf(code(src), name).length, 0, `${file} calls ${name}`);
});

test('SELF-TEST: the scanner reports each shape it exists to catch (so it can fail)', () => {
  const alias = "import { readNodePlan as rnp } from './tree-derive-load.js';\nconst p = rnp(dir);";
  const ns = "import * as d from './tree-derive-load.js';\nd.readNodePlan(dir);";
  const value = "import { readNodePlan } from './tree-derive-load.js';\nconst fns = dirs.map(readNodePlan);";
  const reexport = "export { readNodePlan } from './tree-derive-load.js';";
  const dyn = "const m = await import('./tree-derive-load.js');";
  const clean = "import { readPlanOf } from './tree-derive-load.js';\nreadPlanOf(runsDir, n);";
  assert.match(structuralFindings('a.js', alias).join('\n'), /another name/);
  assert.match(structuralFindings('b.js', ns).join('\n'), /namespace import/);
  assert.match(structuralFindings('c.js', value).join('\n'), /used as a value/);
  assert.match(structuralFindings('d.js', reexport).join('\n'), /re-exports/);
  assert.match(structuralFindings('e.js', dyn).join('\n'), /dynamic import/);
  assert.deepEqual(structuralFindings('f.js', clean), []);
  // the call counter and the accepted-argument check: a call with no accepted argument is visible to the census
  const bare = callsOf(code("readNodePlan(join(runsDir, n.runId)).block; readNodePlan(dir, { acceptedBodySha256: x });"), 'readNodePlan');
  assert.deepEqual(bare.map(c => /acceptedBodySha256/.test(c.args)), [false, true]);
  assert.equal(callsOf(code('// readNodePlan(x)\nconst a = 1; /* readNodePlan(y) */'), 'readNodePlan').length, 0, 'a comment is not a call');
});
